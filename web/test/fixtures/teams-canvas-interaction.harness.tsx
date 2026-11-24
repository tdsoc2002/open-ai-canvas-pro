import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { TeamInvitation, TeamLedgerEntry, TeamMember, TeamSummary, TeamWallet } from "@/services/api/teams";

const dom = new Window({ url: "http://localhost/teams/team-a/canvas/canvas-a" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    Document: dom.Document,
    DocumentFragment: dom.DocumentFragment,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
    Element: dom.Element,
    Node: dom.Node,
    ShadowRoot: dom.ShadowRoot,
    SVGElement: dom.SVGElement,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { createMemoryRouter, Outlet, RouterProvider } = await import("react-router");
const { apiClient } = await import("@/services/api/request");
const { AssetsBatchBar } = await import("@/pages/assets/asset-library-panels");
const { TeamMembersPane } = await import("@/pages/teams/members");
const { TeamWalletPane } = await import("@/pages/teams/wallet");
const { teamKeys } = await import("@/lib/team-query-keys");
const { PersonalSpaceCreditOverview, TeamSpaceDirectoryHost, openSpaceDirectory } = await import("@/components/layout/team-space-directory");
const { useUserStore, defaultFeatureAvailability } = await import("@/stores/use-user-store");
const originalAdapter = apiClient.defaults.adapter;
afterAll(() => {
    apiClient.defaults.adapter = originalAdapter;
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("personal overview distinguishes assigned and pooled funds, filters same-name groups and switches by ID", async () => {
    const original = useUserStore.getState();
    const user = { id: "viewer", username: "viewer", displayName: "成员", role: "user" as const, status: "active" as const };
    useUserStore.setState({ user, features: defaultFeatureAvailability });
    const requests: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        requests.push(config.url!);
        const spaces = [
            { teamId: "a", name: "星河" },
            { teamId: "b", name: "南岸" },
            { teamId: "ag", name: "剪辑组", parentId: "a", parentName: "星河" },
            { teamId: "bg", name: "剪辑组", parentId: "b", parentName: "南岸" },
        ].map((space) => ({ ...space, role: "member", availableMicrocredits: space.teamId === "ag" ? 300_000_000 : 0, reservedMicrocredits: 20_000_000, poolAvailableMicrocredits: 70_000_000 }));
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { personal: { availableMicrocredits: 0, reservedMicrocredits: 80_000_000 }, spaces } } };
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Home() {
        const enabled = useUserStore((state) => state.features.teamsEnabled);
        return (
            <>
                <PersonalSpaceCreditOverview />
                {enabled && <TeamSpaceDirectoryHost userId={user.id} />}
            </>
        );
    }
    const router = createMemoryRouter([
        { path: "/", element: <Home /> },
        { path: "/teams/:id", element: <div>当前小组</div> },
    ]);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const settle = () =>
        act(async () => {
            await Bun.sleep(35);
        });
    try {
        await act(async () =>
            root.render(
                <QueryClientProvider client={client}>
                    <App>
                        <RouterProvider router={router} />
                    </App>
                </QueryClientProvider>,
            ),
        );
        expect(requests).toEqual([]);
        expect(host.querySelector("section")).toBeNull();
        await act(async () => useUserStore.getState().setFeatures({ ...defaultFeatureAvailability, teamsEnabled: true }));
        await settle();
        const rows = host.querySelectorAll("li button");
        expect(rows).toHaveLength(5);
        expect(rows[0]?.textContent).toContain("0.00 积分");
        expect(rows[2]?.textContent).toContain("星河 · 小组300.00 积分公共待分配 70.00");
        await act(async () => {
            openSpaceDirectory();
        });
        await settle();
        const dialog = document.querySelector('[role="dialog"]')!;
        expect(dialog.querySelector('[aria-current="location"]')?.textContent).toContain("个人空间");
        const search = dialog.querySelector<HTMLInputElement>('input[aria-label="搜索空间"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(search, "星河");
            search.dispatchEvent(new dom.Event("input", { bubbles: true }));
        });
        const filtered = dialog.querySelectorAll<HTMLButtonElement>("li button");
        expect(filtered).toHaveLength(2);
        expect(filtered[1]?.textContent).toContain("剪辑组");
        await act(async () => filtered[1]!.click());
        expect(router.state.location.pathname).toBe("/teams/ag");
        expect(new Set(requests)).toEqual(new Set(["/teams/credit-overview"]));
    } finally {
        await act(async () => root.unmount());
        router.dispose();
        client.clear();
        host.remove();
        useUserStore.setState(original);
    }
});

test("the actual personal asset batch toolbar exposes sharing for all selected items and disables it when busy", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let clicked = 0;
    const render = (busy: boolean) => (
        <AssetsBatchBar
            count={43}
            allSelected={false}
            busy={busy}
            onSelectAll={() => {}}
            onClear={() => {}}
            onExport={() => {}}
            onDelete={() => {}}
            onShareTeam={() => {
                clicked++;
            }}
        />
    );
    try {
        await act(async () => root.render(render(false)));
        expect(host.textContent).toContain("43");
        let button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "共享到团队");
        expect(button).toBeDefined();
        await act(async () => button!.click());
        expect(clicked).toBe(1);
        await act(async () => root.render(render(true)));
        button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "共享到团队");
        expect(button?.disabled).toBe(true);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("team owners can switch lists without sharing or resetting the current page", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    const team: TeamSummary = { id: "team-a", name: "星河", role: "owner", ownerUserId: "owner", membershipId: "member-1" };
    const prefix = teamKeys.space(useUserStore.getState().user?.id || "", team.id);
    client.setQueryData<TeamMember[]>(
        [...prefix, "members"],
        Array.from({ length: 11 }, (_, index) => ({
            id: `member-${index + 1}`,
            userId: `user-${index + 1}`,
            teamId: team.id,
            username: `user-${index + 1}`,
            displayName: `成员 ${index + 1}`,
            role: index === 0 ? "owner" : "member",
        })),
    );
    client.setQueryData<TeamInvitation[]>(
        [...prefix, "invitations"],
        Array.from({ length: 11 }, (_, index) => ({
            id: `invite-${index + 1}`,
            teamId: team.id,
            teamName: team.name,
            inviterName: "成员 1",
            inviteeUserId: `invitee-${index + 1}`,
            inviteeName: `受邀人 ${index + 1}`,
            status: "pending",
            expiresAt: "2026-12-01T00:00:00Z",
        })),
    );
    const router = createMemoryRouter([{ path: "/", element: <Outlet context={team} />, children: [{ index: true, element: <TeamMembersPane /> }] }]);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const activePanel = () => host.querySelector('[role="tabpanel"][aria-hidden="false"]')!;
    const rows = () => activePanel().querySelectorAll("tbody tr[data-row-key]");
    const goToSecondPage = () => act(async () => activePanel().querySelector<HTMLElement>('li[title="2"]')!.click());
    try {
        await act(async () =>
            root.render(
                <QueryClientProvider client={client}>
                    <App>
                        <RouterProvider router={router} />
                    </App>
                </QueryClientProvider>,
            ),
        );
        const [membersTab, invitationsTab] = host.querySelectorAll<HTMLElement>('[role="tab"]');
        expect(membersTab?.getAttribute("aria-selected")).toBe("true");
        expect(rows()).toHaveLength(10);
        await goToSecondPage();
        expect(rows()[0]?.textContent).toContain("成员 11");

        await act(async () => invitationsTab!.click());
        expect(rows()).toHaveLength(10);
        expect(rows()[0]?.textContent).toContain("受邀人 1");
        await goToSecondPage();
        expect(rows()[0]?.textContent).toContain("受邀人 11");

        await act(async () => membersTab!.click());
        expect(rows()[0]?.textContent).toContain("成员 11");
        await act(async () => invitationsTab!.click());
        expect(rows()[0]?.textContent).toContain("受邀人 11");
    } finally {
        await act(async () => root.unmount());
        router.dispose();
        client.clear();
        host.remove();
    }
});

test("team wallet keeps member pagination independent from the server ledger page", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    const team: TeamSummary = { id: "team-a", name: "星河", role: "owner", ownerUserId: "owner", membershipId: "owner-membership" };
    const prefix = teamKeys.space(useUserStore.getState().user?.id || "", team.id);
    const account = { id: "owner-account", kind: "member", availableMicrocredits: 0, reservedMicrocredits: 0, version: 1 };
    client.setQueryData<TeamWallet>([...prefix, "wallet"], {
        myAccount: account,
        poolAvailableMicrocredits: 0,
        members: Array.from({ length: 11 }, (_, index) => ({ membershipId: `membership-${index + 1}`, userId: `user-${index + 1}`, account })),
    });
    client.setQueryData<TeamMember[]>([...prefix, "members"], []);
    const ledgerEntry: TeamLedgerEntry = {
        id: "ledger-first",
        type: "reserve",
        userId: "owner",
        accountId: account.id,
        amountMicrocredits: 0,
        availableDeltaMicrocredits: 0,
        reservedDeltaMicrocredits: 0,
        availableAfterMicrocredits: 0,
        reservedAfterMicrocredits: 0,
        createdAt: "2026-11-24T00:00:00Z",
    };
    client.setQueryData([...prefix, "ledger", 1], { entries: Array.from({ length: 20 }, (_, index) => ({ ...ledgerEntry, id: `ledger-${index + 1}` })), total: 21, page: 1, limit: 20 });
    client.setQueryData([...prefix, "ledger", 2], { entries: [{ ...ledgerEntry, id: "ledger-21", type: "refund" }], total: 21, page: 2, limit: 20 });
    const router = createMemoryRouter([{ path: "/", element: <Outlet context={team} />, children: [{ index: true, element: <TeamWalletPane /> }] }]);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const activePanel = () => host.querySelector('[role="tabpanel"][aria-hidden="false"]')!;
    const rows = () => activePanel().querySelectorAll("tbody tr[data-row-key]");
    const goToSecondPage = () => act(async () => activePanel().querySelector<HTMLElement>('li[title="2"]')!.click());
    try {
        await act(async () =>
            root.render(
                <QueryClientProvider client={client}>
                    <App>
                        <RouterProvider router={router} />
                    </App>
                </QueryClientProvider>,
            ),
        );
        const [membersTab, ledgerTab] = host.querySelectorAll<HTMLElement>('[role="tab"]');
        expect(membersTab?.getAttribute("aria-selected")).toBe("true");
        expect(rows()).toHaveLength(10);
        await goToSecondPage();
        expect(rows()[0]?.textContent).toContain("user-11");

        await act(async () => ledgerTab!.click());
        expect(rows()).toHaveLength(20);
        await goToSecondPage();
        expect(rows()[0]?.textContent).toContain("任务退回");

        await act(async () => membersTab!.click());
        expect(rows()[0]?.textContent).toContain("user-11");
        await act(async () => ledgerTab!.click());
        expect(rows()[0]?.textContent).toContain("任务退回");
    } finally {
        await act(async () => root.unmount());
        router.dispose();
        client.clear();
        host.remove();
    }
});
