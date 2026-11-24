import { useState } from "react";
import { useOutletContext } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, Select, Table } from "antd";
import { ArrowDownLeft, ArrowUpRight, Layers, Lock, ReceiptText, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/workspace-page";
import { AppModal } from "@/components/ui/product/app-modal";
import { parseTeamCreditAmount, teamCredits, teamKeys } from "@/lib/team-query-keys";
import { cn } from "@/lib/utils";
import { getTeamLedger, getTeamWallet, listTeamMembers, transferTeamCredits, type TeamLedgerEntry, type TeamSummary } from "@/services/api/teams";
import { useUserStore } from "@/stores/use-user-store";
import { TeamManagementPage, TeamTableSection, TeamTableTabs } from "./team-management-page";

const actions = { fund: "转入团队", withdraw: "转回个人", allocate: "划拨额度", reclaim: "回收额度" };
type TransferAction = keyof typeof actions;
const transferDescriptions: Record<string, string> = { ...actions, group_fund: "公司划入小组", group_withdraw: "小组退回公司", member_leave: "离队回收", billing_release: "离队后退回余额" };
const billingDescriptions = { reserve: "任务冻结", consume: "任务结算", refund: "任务退回" };

export function TeamWalletPane() {
    const team = useOutletContext<TeamSummary>();
    const userId = useUserStore((state) => state.user?.id) || "";
    const prefix = teamKeys.space(userId, team.id);
    const owner = team.role === "owner";
    const captions = team.parentId ? { ...actions, fund: "从公司公共池转入", withdraw: "转回公司公共池" } : { ...actions, fund: "从个人钱包转入" };
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const wallet = useQuery({ queryKey: [...prefix, "wallet"], queryFn: ({ signal }) => getTeamWallet(team.id, signal) });
    const members = useQuery({ queryKey: [...prefix, "members"], queryFn: ({ signal }) => listTeamMembers(team.id, signal), enabled: owner });
    const [page, setPage] = useState(1);
    const ledger = useQuery({ queryKey: [...prefix, "ledger", page], queryFn: ({ signal }) => getTeamLedger(team.id, page, signal) });
    const [form, setForm] = useState<{ action: TransferAction; membershipId?: string; idempotencyKey: string }>();
    const [amount, setAmount] = useState("");
    const openTransfer = (action: TransferAction, membershipId?: string) => {
        setAmount("");
        setForm({ action, membershipId, idempotencyKey: crypto.randomUUID() });
    };
    const parsedAmount = parseTeamCreditAmount(amount);
    const transfer = useMutation({
        mutationFn: async () => {
            if (!form || parsedAmount === undefined) throw new Error("请输入大于零且最多六位小数的积分");
            if ((form.action === "allocate" || form.action === "reclaim") && !form.membershipId) throw new Error("请选择团队成员");
            return transferTeamCredits(team.id, { ...form, amountMicrocredits: parsedAmount });
        },
        onSuccess: async () => {
            setForm(undefined);
            await queryClient.invalidateQueries({ queryKey: prefix });
            if (team.parentId) await queryClient.invalidateQueries({ queryKey: teamKeys.space(userId, team.parentId) });
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            message.success("积分划转成功");
        },
        onError: (error) => message.error(error.message),
    });
    const account = wallet.data?.myAccount;
    const ledgerAccount = (entry: TeamLedgerEntry) => {
        if (entry.accountId === account?.id) return "我的团队额度";
        if (entry.accountId === wallet.data?.pool?.id) return "团队待分配";
        if (entry.membershipId) {
            const member = members.data?.find((candidate) => candidate.id === entry.membershipId);
            return member?.displayName || member?.username || "历史成员额度";
        }
        return "所有者个人钱包";
    };
    const memberQuotaTable = (
        <TeamTableSection emptyState={wallet.isSuccess && members.isSuccess && !wallet.data.members?.length ? { title: "暂无成员额度" } : undefined}>
            {members.isError ? <Alert className="mx-5 my-4" type="error" title={members.error.message} /> : null}
            <Table
                size="middle"
                rowKey="membershipId"
                loading={wallet.isPending || members.isPending}
                dataSource={wallet.data?.members}
                pagination={{ className: "px-4", pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
                scroll={{ x: 600 }}
                locale={{ emptyText: null }}
                columns={[
                    {
                        title: "成员",
                        key: "name",
                        render: (_, entry) => {
                            const member = members.data?.find((item) => item.id === entry.membershipId);
                            return <span className="font-medium">{member?.displayName || member?.username || entry.userId}</span>;
                        },
                    },
                    { title: "可用", key: "available", align: "right", className: "tabular-nums", render: (_, entry) => teamCredits(entry.account.availableMicrocredits) },
                    { title: "冻结", key: "reserved", align: "right", className: "tabular-nums", render: (_, entry) => teamCredits(entry.account.reservedMicrocredits) },
                    {
                        title: "操作",
                        key: "actions",
                        align: "right",
                        width: 156,
                        render: (_, entry) => (
                            <div className="flex justify-end gap-2">
                                <Button size="small" onClick={() => openTransfer("allocate", entry.membershipId)}>
                                    划拨
                                </Button>
                                <Button size="small" onClick={() => openTransfer("reclaim", entry.membershipId)}>
                                    回收
                                </Button>
                            </div>
                        ),
                    },
                ]}
            />
        </TeamTableSection>
    );
    const ledgerTable = (
        <TeamTableSection title={owner ? undefined : "我的团队流水"} className="grow" emptyState={ledger.isSuccess && !ledger.data.entries?.length ? { icon: ReceiptText, title: "暂无积分流水" } : undefined}>
            {ledger.isError ? <Alert className="mx-5 my-4" type="error" title={ledger.error.message} /> : null}
            <Table
                size="middle"
                rowKey="id"
                loading={ledger.isPending}
                dataSource={ledger.data?.entries}
                pagination={{ className: "px-4", current: page, pageSize: 20, total: ledger.data?.total, onChange: setPage, hideOnSinglePage: true, showSizeChanger: false }}
                scroll={{ x: 650 }}
                locale={{ emptyText: null }}
                columns={[
                    { title: "时间", dataIndex: "createdAt", className: "whitespace-nowrap tabular-nums", render: (value: string) => new Date(value).toLocaleString() },
                    { title: "账户", key: "account", render: (_, entry) => ledgerAccount(entry) },
                    { title: "说明", key: "description", render: (_, entry) => (entry.type === "team_transfer" ? transferDescriptions[entry.note || ""] || "团队划转" : billingDescriptions[entry.type]) },
                    { title: "可用变动", dataIndex: "availableDeltaMicrocredits", align: "right", className: "tabular-nums", render: (value: number) => teamCredits(value) },
                    { title: "冻结变动", dataIndex: "reservedDeltaMicrocredits", align: "right", className: "tabular-nums", render: (value: number) => teamCredits(value) },
                    { title: "变动后可用", dataIndex: "availableAfterMicrocredits", align: "right", className: "font-medium tabular-nums", render: (value: number) => teamCredits(value) },
                ]}
            />
        </TeamTableSection>
    );
    return (
        <TeamManagementPage fill>
            <PageHeader
                title={owner ? "团队积分" : "我的团队额度"}
                description="公共池中的积分由所有者划拨。分给你的额度只能在当前空间消费。"
                actions={
                    owner ? (
                        <>
                            <Button icon={<ArrowUpRight aria-hidden />} onClick={() => openTransfer("withdraw")}>
                                {captions.withdraw}
                            </Button>
                            <Button type="primary" icon={<ArrowDownLeft aria-hidden />} onClick={() => openTransfer("fund")}>
                                {captions.fund}
                            </Button>
                        </>
                    ) : (
                        <Button onClick={() => void wallet.refetch()}>刷新额度</Button>
                    )
                }
            />
            {wallet.isError ? <Alert type="error" title="额度读取失败" description={wallet.error.message} action={<Button onClick={() => void wallet.refetch()}>重试</Button>} /> : null}
            <dl className="grid gap-3 @2xl:grid-cols-[1.2fr_1fr_1fr]">
                {[
                    { label: "我的可用额度", value: account?.availableMicrocredits, icon: Wallet, primary: true },
                    { label: "公共待分配", value: wallet.data?.poolAvailableMicrocredits, icon: Layers },
                    { label: "我的任务冻结", value: account?.reservedMicrocredits, icon: Lock },
                ].map(({ label, value, icon: Icon, primary }) => (
                    <div key={label} className={cn("min-w-0 rounded-xl border border-border p-4 @2xl:p-5", primary ? "bg-[color-mix(in_srgb,var(--brand,var(--foreground))_7%,var(--card))]" : "bg-card")}>
                        <dt className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
                            <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", primary ? "bg-card text-[color:var(--brand,var(--foreground))]" : "bg-muted text-muted-foreground")}>
                                <Icon aria-hidden className="size-4" />
                            </span>
                            {label}
                        </dt>
                        <dd className="mt-3 flex flex-wrap items-baseline gap-x-2">
                            <span className="text-3xl font-semibold tracking-tight tabular-nums">{value === undefined ? "—" : teamCredits(value)}</span>
                            <span className="text-xs text-muted-foreground">积分</span>
                        </dd>
                    </div>
                ))}
            </dl>
            {owner ? (
                <TeamTableTabs
                    items={[
                        { key: "members", label: "成员额度", children: memberQuotaTable },
                        { key: "ledger", label: "团队资金流水", children: ledgerTable },
                    ]}
                />
            ) : (
                ledgerTable
            )}
            <AppModal
                centered
                title={form ? captions[form.action] : "积分划转"}
                open={Boolean(form)}
                onCancel={() => {
                    if (!transfer.isPending) setForm(undefined);
                }}
                onOk={() => transfer.mutate()}
                okText="确认划转"
                confirmLoading={transfer.isPending}
                okButtonProps={{ disabled: parsedAmount === undefined }}
            >
                <div className="workspace-toolbar space-y-4">
                    {form?.action === "allocate" || form?.action === "reclaim" ? (
                        <label className="block space-y-2">
                            <span>团队成员</span>
                            <Select
                                aria-label="团队成员"
                                className="w-full"
                                value={form.membershipId}
                                disabled={transfer.isPending}
                                options={members.data?.map((member) => ({ value: member.id, label: `${member.displayName || member.username} (@${member.username})` }))}
                                onChange={(membershipId) => setForm({ ...form, membershipId, idempotencyKey: crypto.randomUUID() })}
                            />
                        </label>
                    ) : null}
                    <label className="block space-y-2">
                        <span>积分数量</span>
                        <Input
                            value={amount}
                            disabled={transfer.isPending}
                            inputMode="decimal"
                            placeholder="例如 100"
                            onChange={(event) => {
                                setAmount(event.target.value);
                                if (form) setForm({ ...form, idempotencyKey: crypto.randomUUID() });
                            }}
                            suffix="积分"
                        />
                    </label>
                    <p className="text-sm text-foreground/60">
                        {form?.action === "fund"
                            ? team.parentId
                                ? `从「${team.parentName}」的公共池划入当前小组。分配给成员后即可使用。`
                                : "从你的个人可用余额转入公司公共池。分配给成员后即可使用。"
                            : form?.action === "withdraw"
                              ? team.parentId
                                  ? `小组尚未分配的积分将退回「${team.parentName}」的公共池。`
                                  : "将公司尚未分配的积分转回你的个人钱包。"
                              : form?.action === "allocate"
                                ? "从团队待分配余额划拨给所选成员，成员个人钱包不会增加。"
                                : "只回收所选成员尚未使用的可用额度，任务冻结额度保持不变。"}
                    </p>
                </div>
            </AppModal>
        </TeamManagementPage>
    );
}
