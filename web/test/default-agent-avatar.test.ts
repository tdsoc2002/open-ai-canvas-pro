import { expect, test } from "bun:test";
import { DEFAULT_AGENT_AVATAR, DEFAULT_CANVAS_APPEARANCE, usesDefaultAgentAvatar } from "../src/lib/canvas/agent-appearance";
import { OTTER_RIG_SRC, playAgentOtterAction } from "../src/components/canvas/agent-otter-action";

test("只在使用内置形象时显示静态图片", () => {
    expect(usesDefaultAgentAvatar(DEFAULT_CANVAS_APPEARANCE)).toBe(true);
    expect(usesDefaultAgentAvatar({ ...DEFAULT_CANVAS_APPEARANCE, avatarBundleResourceId: "custom-bundle" })).toBe(false);
    expect(usesDefaultAgentAvatar({ ...DEFAULT_CANVAS_APPEARANCE, avatarType: "orb" })).toBe(false);
    expect(usesDefaultAgentAvatar({ ...DEFAULT_CANVAS_APPEARANCE, avatarType: "live2d", live2dResourceId: "custom-model" })).toBe(false);
});

test("内置静态图片随前端发布", async () => {
    for (const src of [DEFAULT_AGENT_AVATAR.src, OTTER_RIG_SRC]) {
        expect(await Bun.file(new URL(`../public${src}`, import.meta.url)).exists()).toBe(true);
    }
});

test("内置形象只在允许动态效果时播放待机动作", async () => {
    const css = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent.css", import.meta.url)).text();
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{\s*\.canvas-agent-launcher-media\s*>\s*\.canvas-agent-default-avatar\s*\{[^}]*animation:[^;]+;/);
});

test("场记板先合上，头部后点动，两段完成才结束反馈", async () => {
    const makeLayer = () => {
        const result = Promise.withResolvers<void>();
        const calls: { frames: Keyframe[]; timing: KeyframeAnimationOptions }[] = [];
        return {
            result,
            calls,
            animate(frames: Keyframe[], timing: KeyframeAnimationOptions) {
                calls.push({ frames, timing });
                return { finished: result.promise, cancel() {} };
            },
        };
    };
    const slate = makeLayer();
    const head = makeLayer();
    const avatar = { dataset: {}, querySelector: (selector: string) => (selector.includes("slate") ? slate : head) } as unknown as HTMLElement;
    expect(playAgentOtterAction(avatar)).toBeNull();
    avatar.dataset.otterReady = "true";
    const action = playAgentOtterAction(avatar);
    if (!action) throw new Error("场记板动效未开始");
    expect(head.calls[0].timing.delay).toBeGreaterThanOrEqual(Number(slate.calls[0].timing.duration));
    expect(avatar.dataset.otterPlaying).toBe("true");
    let finished = false;
    const completion = action.finished.then(() => {
        finished = true;
    });
    slate.result.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    head.result.resolve();
    await completion;
    expect(finished).toBe(true);
    action.cancel();
    expect(avatar.dataset.otterPlaying).toBeUndefined();
});
