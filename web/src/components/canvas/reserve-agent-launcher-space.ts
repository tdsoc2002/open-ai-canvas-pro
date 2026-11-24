import { AGENT_LAUNCHER_COMPACT_VIEWPORT_WIDTH } from "@/lib/canvas/agent-launcher-position";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";

/** 保留窄屏底栏所占的空间。工作台底栏会随工作区滚动。 */
export function reserveAgentLauncherSpace(node: HTMLElement | null) {
    if (!node) return;
    const workspace = node.closest(".app-user-workspace");
    let frame = 0;
    const measure = () => {
        frame = 0;
        const { top, bottom, height } = node.getBoundingClientRect();
        const launcherBottomInset = window.innerWidth < AGENT_LAUNCHER_COMPACT_VIEWPORT_WIDTH && height > 0 && bottom > 0 ? Math.max(0, Math.ceil(window.innerHeight - top)) : 0;
        useGlobalAgentStore.setState((state) => (state.launcherBottomInset === launcherBottomInset ? state : { launcherBottomInset }));
    };
    const scheduleMeasure = () => {
        if (!frame) frame = requestAnimationFrame(measure);
    };

    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(node, { box: "border-box" });
    workspace?.addEventListener("scroll", scheduleMeasure, { capture: true, passive: true });
    window.addEventListener("resize", scheduleMeasure);
    measure();

    return () => {
        observer.disconnect();
        workspace?.removeEventListener("scroll", scheduleMeasure, true);
        window.removeEventListener("resize", scheduleMeasure);
        cancelAnimationFrame(frame);
        useGlobalAgentStore.setState({ launcherBottomInset: 0 });
    };
}
