import { workspacePath } from "@/lib/workspace-routes";
import { useTranslation } from "react-i18next";
import { useRef, useState, type ReactNode } from "react";
import { App, Button } from "antd";
import { ArrowRight, FolderOpen } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuthEntry } from "@/hooks/use-auth-entry";
import { AgentOrb } from "@/components/ui/agent-orb";
import { canvasDraftNavigationState, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { selectAgentName, useAppearanceStore } from "@/stores/use-appearance-store";
import { hasRemoteUserDataSyncSession } from "@/services/user-data-sync";
import storyboardArtwork from "./assets/creation-agent-storyboard.webp";

/** 进入时只分配草稿 ID；明确提交创作时再建立同一画布的服务端记录。 */
export function CreationAgentEntry({ modeControl }: { modeControl?: ReactNode }) {
    const { t } = useTranslation();
    const agentName = useAppearanceStore(selectAgentName);
    const navigate = useNavigate();
    const { openAuth } = useAuthEntry();
    const { message } = App.useApp();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const lock = useRef(false);
    const created = useRef<{ id: string; userId: string } | null>(null);
    const start = async () => {
        if (lock.current) return;
        if (!useUserStore.getState().user) {
            openAuth({ preferDialog: true });
            return;
        }
        lock.current = true;
        setBusy(true);
        setError("");
        const userId = useUserStore.getState().user?.id;
        try {
            if (!userId || !hasRemoteUserDataSyncSession()) throw new Error(t("create.agentEntry.sessionNotReady"));
            if (!hydrated) throw new Error(t("create.agentEntry.canvasRestoring"));
            if (created.current?.userId !== userId) created.current = null;
            if (!created.current) {
                const id = useCanvasStore.getState().createDraftProject(t("create.agentEntry.canvasTitle"));
                created.current = { id, userId };
            }
            if (useUserStore.getState().user?.id !== userId) return;
            navigate(workspacePath(`/canvas/${encodeURIComponent(created.current.id)}?agent=1`), { state: canvasDraftNavigationState(created.current.id) });
        } catch (cause) {
            if (useUserStore.getState().user?.id === userId) {
                const detail = cause instanceof Error ? cause.message : t("create.agentEntry.startFailed");
                setError(detail);
                message.error(detail);
            }
        } finally {
            lock.current = false;
            setBusy(false);
        }
    };
    return (
        <section className="creation-agent-entry" aria-label={t("create.agentEntry.region", { agentName })}>
            {modeControl ? (
                <div className="creation-agent-mode-control">{modeControl}</div>
            ) : (
                <div className="creation-agent-orb" aria-hidden="true">
                    <AgentOrb size={88} />
                </div>
            )}
            <div className="creation-agent-copy">
                {modeControl ? null : <span className="creation-agent-eyebrow">{agentName}</span>}
                <h2>{t(modeControl ? "create.agentEntry.compactTitle" : "create.agentEntry.title")}</h2>
                <p>{t("create.agentEntry.description", { agentName })}</p>
            </div>
            <div className="creation-agent-actions">
                <Button type="primary" loading={busy} disabled={!hydrated} onClick={() => void start()}>
                    {created.current ? t("create.agentEntry.retryEnter") : t(modeControl ? "create.agentEntry.compactNewCanvas" : "create.agentEntry.newCanvas", { agentName })}
                    <ArrowRight aria-hidden="true" />
                </Button>
                <Button type={modeControl ? "text" : "default"} icon={<FolderOpen aria-hidden="true" />} disabled={busy} onClick={() => navigate(workspacePath("/canvas?agent=1"))}>
                    {t("create.agentEntry.continueExisting")}
                </Button>
            </div>
            {modeControl ? <img className="creation-agent-storyboard" src={storyboardArtwork} alt="" width={720} height={480} decoding="async" /> : null}
            {error ? (
                <p className="creation-agent-error" role="alert">
                    {error}
                </p>
            ) : null}
        </section>
    );
}
