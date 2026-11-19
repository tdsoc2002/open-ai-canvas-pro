import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { AgentWelcome } from "@/components/canvas/canvas-agent-welcome";
import { AgentChatComposer } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { AgentContextRing, AgentConversation, AgentHeader, AgentLauncher, ComposerControls, ComposerModelPicker } from "@/components/canvas/canvas-cloud-agent-panel-parts";
import { agentPermissionVisual } from "@/components/canvas/canvas-cloud-agent-settings";
import { canvasThemes } from "@/lib/canvas-theme";
import { DEFAULT_AGENT_AVATAR, DEFAULT_CANVAS_APPEARANCE, agentComposerPlaceholder, agentCopy, agentPanelTitle } from "@/lib/canvas/agent-appearance";
import { selectAgentName, useAppearanceStore } from "@/stores/use-appearance-store";
import { catalog as createCatalog } from "@/i18n/messages/areas/create";
import { emptyAgentContextUsage, presentAgentContextUsage } from "@/lib/canvas/agent-context-usage";
import { AGENT_LAUNCHER_POSITION_KEY } from "@/lib/canvas/agent-launcher-position";
import { defaultConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

const noop = () => {};

test("技能页双击默认水獭立即按入口当前位置打开对话", async () => {
    const dom = new Window({ url: "http://fixture.invalid/skills", settings: { disableJavaScriptEvaluation: true } });
    dom.happyDOM.setViewport({ width: 1280, height: 800 });
    dom.localStorage.setItem(AGENT_LAUNCHER_POSITION_KEY, JSON.stringify({ right: 240, bottom: 100 }));
    const globals = { window: dom, document: dom.document, localStorage: dom.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
    const original = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host as unknown as Element);
    const onOpen = mock(noop);

    try {
        await act(() =>
            root.render(
                <MemoryRouter initialEntries={["/skills"]}>
                    <AgentLauncher theme={canvasThemes.dark} statusColor="green" approvalPending={false} reducedMotion={false} status="idle" onOpen={onOpen} />
                </MemoryRouter>,
            ),
        );
        // 如果入口仍有开场动画，模拟素材已加载，但动作尚未完成。
        const rig = host.querySelector(".canvas-agent-otter-rig");
        if (rig) {
            for (const layer of rig.querySelectorAll("g")) {
                Object.defineProperty(layer, "animate", { value: () => ({ finished: new Promise(() => {}), cancel: noop }) });
            }
            await act(() => {
                rig.querySelector("image")!.dispatchEvent(new dom.Event("load"));
            });
        }
        const launcher = host.querySelector(".canvas-agent-launcher-hit")!;
        const click = (detail: number) => launcher.dispatchEvent(new dom.MouseEvent("click", { bubbles: true, detail }));
        await act(() => {
            click(1);
        });
        expect(onOpen).not.toHaveBeenCalled();
        await act(() => {
            click(2);
        });
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(onOpen).toHaveBeenCalledWith({ right: 240, bottom: 100 });
    } finally {
        await act(() => root.unmount());
        await dom.happyDOM.abort();
        for (const [key, descriptor] of original) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});

test.each([
    ["/canvas/mascot-size", false, 120],
    ["/create", false, 120],
    ["/canvas/mascot-size", true, 48],
] as const)("默认水獭入口尺寸符合当前页面和折叠状态（%s，%s）", (path, collapsed, size) => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { innerWidth: 1920, innerHeight: 900 }) });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => (collapsed && key === "canvas:agent-launcher-collapsed:v1" ? "1" : null) } });
    try {
        const html = renderToStaticMarkup(
            <MemoryRouter initialEntries={[path]}>
                <AgentLauncher theme={canvasThemes.dark} statusColor="green" approvalPending={false} reducedMotion status="idle" onOpen={noop} />
            </MemoryRouter>,
        );
        const launcher = html.match(/<button\b[^>]*class="canvas-agent-launcher [^"]*"[^>]*>/)?.[0];
        expect(launcher).toContain(`width:${size}px;height:${size}px`);
        expect(html).toContain(DEFAULT_AGENT_AVATAR.src);
    } finally {
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
        else Reflect.deleteProperty(globalThis, "window");
        if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
        else Reflect.deleteProperty(globalThis, "localStorage");
    }
});

const conversationProps = { theme: canvasThemes.light, references: [], approval: null, approvalSubmitting: false, onApprovalReasonChange: noop, onApprove: noop, onReject: noop };

test("empty Agent conversation keeps ordinary actions but hides skill actions before an eligible session loads", () => {
    for (const onChooseSkill of [undefined, noop]) {
        const html = renderToStaticMarkup(<AgentConversation {...conversationProps} messages={[]} busy={false} nodeCount={0} onChooseSkill={onChooseSkill} onDraftPrompt={noop} />);
        expect(html).toContain("agent-welcome-orb");
        expect(html).toContain("让灵感，慢慢成形");
        expect(html.match(/type="button"/g)).toHaveLength(2);
        expect(html).not.toContain("选择技能，开始创作");
        expect(html.match(/disabled=""/g)).toHaveLength(1);
        expect(html).not.toContain("agent-conversation-starter");
        expect(html).not.toContain("agent-scene-capsules");
    }
});

test("original welcome uses configured names and escapes them as text", () => {
    const html = renderToStaticMarkup(<AgentWelcome appearance={{ ...DEFAULT_CANVAS_APPEARANCE, agentName: "我的<工作室>" }} nodeCount={2} onChooseSkill={noop} onDraftPrompt={noop} />);
    expect(html).toContain("在这里，和我的&lt;工作室&gt;让灵感，慢慢成形");
    expect(html).toContain("2 个节点");
    expect(html).not.toContain('disabled=""');
});

test("submission state is explicit instead of claiming the model is thinking", () => {
    const html = renderToStaticMarkup(<AgentConversation {...conversationProps} messages={[]} busy activity="submitting" />);
    expect(html).toContain("正在发送…");
    expect(html).not.toContain("正在思考");
    expect(html).not.toContain("实时处理中");
});

test("Joysee welcome shows the mascot and a single heading without shortcuts or subtitle", () => {
    const html = renderToStaticMarkup(<AgentWelcome compact appearance={DEFAULT_CANVAS_APPEARANCE} nodeCount={null} onDraftPrompt={noop} />);
    expect(html).toContain("<h2>今天想创作什么？</h2>");
    expect(html).toContain("/doll/editor-otter.webp");
    expect(html).not.toContain('type="button"');
    expect(html).not.toContain("<p>");
});

test("canvas welcome retains the canvas review shortcut and custom copy", () => {
    const appearance = { ...DEFAULT_CANVAS_APPEARANCE, agentName: "我的<工作室>", welcomeTitle: "你好，{agentName}", welcomeDescription: "准备拍摄。" };
    const html = renderToStaticMarkup(<AgentWelcome compact appearance={appearance} nodeCount={2} onDraftPrompt={noop} />);
    expect(html).toContain("<h2>你好，我的&lt;工作室&gt;</h2>");
    expect(html).toContain("准备拍摄。");
    expect(html).toContain("2 个节点");
    expect(html.match(/type="button"/g)).toHaveLength(1);
});

test("built-in panel title follows the global assistant name without discarding custom titles", () => {
    const appearance = { ...DEFAULT_CANVAS_APPEARANCE, agentName: "小鱼" };
    expect(agentPanelTitle(appearance)).toBe("小鱼");
    expect(agentPanelTitle({ ...appearance, panelTitle: "和{agentName}一起工作" })).toBe("和小鱼一起工作");
});

test.each([
    [null, "未关联画布"],
    [3, "画布 · 3 个节点"],
] as const)("the chat header shows only canvas context on the left (%s)", (nodeCount, context) => {
    const html = renderToStaticMarkup(<AgentHeader theme={canvasThemes.light} compact statusLabel="待命" nodeCount={nodeCount} onNew={noop} onHistory={noop} onSettings={noop} onResetLayout={noop} onCollapse={noop} onExport={noop} exporting={false} />);
    expect(html).toContain('<h2 class="sr-only"');
    expect(html).toContain('<span class="sr-only" role="status">待命</span>');
    expect(html).toContain(`>${context}</div>`);
    expect(html).toContain('aria-label="历史对话"');
});

test("assistant name and input copy are independent of the site brand", () => {
    const state = useAppearanceStore.getState();
    const canvas = { ...DEFAULT_CANVAS_APPEARANCE, agentName: "小鱼", inputPlaceholder: "对{agentName}说点什么" };
    expect(selectAgentName({ ...state, appearance: { ...state.appearance, brandName: "站点品牌", canvas } })).toBe("小鱼");
    expect(agentComposerPlaceholder(canvas, true)).toBe("对小鱼说点什么");
    expect(agentComposerPlaceholder(canvas, false)).toBe("对小鱼说点什么");
});

test("the creation entry resolves the configured assistant name in every locale", () => {
    for (const { agentEntry } of Object.values(createCatalog)) {
        for (const key of ["canvasTitle", "syncPending", "region", "description", "newCanvas"] as const) {
            expect(agentEntry[key]).toContain("{{agentName}}");
        }
    }
});

test("assistant template replacement treats names literally", () => {
    expect(agentCopy("{agentName} / {agentName}", "$&小鱼")).toBe("$&小鱼 / $&小鱼");
});

test("permission modes have distinct icons, not just distinct colors", () => {
    const icons = (["read_only", "request_approval", "auto"] as const).map((mode) => {
        const Icon = agentPermissionVisual(mode).icon;
        return renderToStaticMarkup(<Icon />);
    });
    expect(new Set(icons).size).toBe(3);
    expect(icons[0]).toContain("lucide-lock-keyhole");
    expect(icons[1]).toContain("lucide-shield-check");
    expect(icons[2]).toContain("lucide-circle-play");
});

test("compact send button preserves empty-draft and sending guards", () => {
    for (const [prompt, sending, disabled] of [
        ["", false, true],
        ["故事灵感", false, false],
        ["故事灵感", true, true],
    ] as const) {
        const html = renderToStaticMarkup(<AgentChatComposer prompt={prompt} sending={sending} placeholder="聊聊想法" theme={canvasThemes.dark} onPromptChange={noop} onSubmit={noop} />);
        const button = html.match(/<button\b[^>]*class="agent-composer-send [^"]*"[^>]*>/)?.[0];
        expect(button).toBeDefined();
        expect(button).toContain("h-7");
        expect(button?.includes('disabled=""')).toBe(disabled);
        expect(button).not.toContain("box-shadow:");
    }
});

test("only the model stays above the draft; reasoning, skills and context have separate lower controls", () => {
    const contextUsage = { ...presentAgentContextUsage(emptyAgentContextUsage("")), phase: "watch" as const, ratio: 0.75, compactionError: "压缩失败" };
    const shared = { config: defaultConfig, selectedModel: "", theme: canvasThemes.dark, reasoningMode: "auto" as const, onReasoningModeChange: noop, selectedSkillCount: 0 };
    const render = () =>
        renderToStaticMarkup(
            <AgentChatComposer
                prompt=""
                placeholder="聊聊想法"
                theme={canvasThemes.dark}
                onPromptChange={noop}
                onSubmit={noop}
                topActions={<ComposerModelPicker config={defaultConfig} selectedModel="" onModelChange={noop} />}
                left={<ComposerControls {...shared} permissionMode="request_approval" onPermissionChange={noop} skillsOpen={false} onSkillsOpenChange={noop} />}
                submitAccessory={<AgentContextRing view={contextUsage} theme={canvasThemes.dark} />}
            />,
        );
    const initial = useUserStore.getInitialState();
    const previous = { user: initial.user, hydrated: initial.hydrated };
    expect(render()).not.toContain('aria-label="打开 Skills 技能库"');
    let html: string;
    try {
        initial.user = { id: "agent-presentation-user", username: "member", displayName: "测试会员", role: "user", status: "active" };
        initial.hydrated = true;
        html = render();
    } finally {
        Object.assign(initial, previous);
    }
    const model = html.indexOf('aria-label="选择文本模型"');
    const draft = html.indexOf("<textarea");
    expect(model).toBeGreaterThanOrEqual(0);
    expect(draft).toBeGreaterThan(model);
    for (const control of ['aria-label="选择推理强度：默认"', 'aria-label="打开 Skills 技能库"', 'aria-label="上下文已用 75%，上下文压缩异常。点击查看明细"', 'class="agent-permission-label">审批<']) {
        expect(html.indexOf(control)).toBeGreaterThan(draft);
    }
    expect(html).not.toContain('aria-label="工具');
});
