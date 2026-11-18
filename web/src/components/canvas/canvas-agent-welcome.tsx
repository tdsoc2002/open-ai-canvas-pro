import { ArrowUpRight, Clapperboard, Layers3, Orbit, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { agentCopy, agentWelcomeCopy, DEFAULT_AGENT_AVATAR, usesDefaultAgentAvatar, type CanvasAppearance } from "@/lib/canvas/agent-appearance";

const reviewPrompt = "请先阅读当前画布，梳理素材与节点之间的关系，给出接下来的创作建议。先不要修改节点或提交生成任务。";

type AgentWelcomeProps = {
    appearance: CanvasAppearance;
    /** null 表示当前不在画布中。 */
    nodeCount: number | null;
    compact?: boolean;
    onChooseSkill?: () => void;
    onDraftPrompt: (prompt: string) => void;
};

export function AgentWelcome({ appearance, nodeCount, compact = false, onChooseSkill, onDraftPrompt }: AgentWelcomeProps) {
    const { t } = useTranslation();
    if (compact) {
        const { title, description } = agentWelcomeCopy(appearance);
        return (
            <section className="agent-welcome is-compact" aria-label={title}>
                <div className="agent-welcome-intro">
                    <div className="agent-welcome-visual" aria-hidden="true">
                        {usesDefaultAgentAvatar(appearance) ? <img {...DEFAULT_AGENT_AVATAR} alt="" /> : <Sparkles className="agent-welcome-icon" />}
                    </div>
                    <div className="min-w-0">
                        <h2>{title}</h2>
                        {description ? <p>{description}</p> : null}
                    </div>
                </div>
                {nodeCount ? (
                    <button className="agent-welcome-review" type="button" title={t("canvasA.welcome.reviewNodes", { count: nodeCount })} onClick={() => onDraftPrompt(reviewPrompt)}>
                        <Layers3 aria-hidden="true" />
                        <span>{t("canvasA.welcome.reviewTitle")}</span>
                    </button>
                ) : null}
            </section>
        );
    }
    return (
        <section className="agent-welcome" aria-label={t("canvasA.welcome.label")}>
            <div className="agent-welcome-intro">
                <span className="agent-welcome-orb" aria-hidden="true" />
                <h2>{agentCopy(appearance.welcomeTitle, appearance.agentName)}</h2>
                <p>{agentCopy(appearance.welcomeDescription, appearance.agentName)}</p>
            </div>
            <div className="agent-welcome-actions">
                {onChooseSkill ? (
                    <button type="button" onClick={onChooseSkill}>
                        <Orbit aria-hidden="true" />
                        <span>
                            <strong>{t("canvasA.welcome.chooseSkillTitle")}</strong>
                            <small>{t("canvasA.welcome.chooseSkillHint")}</small>
                        </span>
                        <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                    </button>
                ) : null}
                <button type="button" onClick={() => onDraftPrompt("我想创作一段短片，请先和我一起梳理故事方向。先询问我的想法，不要直接生成。")}>
                    <Clapperboard aria-hidden="true" />
                    <span>
                        <strong>{t("canvasA.welcome.storyTitle")}</strong>
                        <small>{t("canvasA.welcome.storyHint")}</small>
                    </span>
                    <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                </button>
                <button type="button" disabled={!nodeCount} onClick={() => onDraftPrompt(reviewPrompt)}>
                    <Layers3 aria-hidden="true" />
                    <span>
                        <strong>{t("canvasA.welcome.reviewTitle")}</strong>
                        <small>{nodeCount === null ? t("canvasA.welcome.reviewNoCanvas") : nodeCount > 0 ? t("canvasA.welcome.reviewNodes", { count: nodeCount }) : t("canvasA.welcome.reviewEmpty")}</small>
                    </span>
                    <ArrowUpRight className="agent-welcome-arrow" aria-hidden="true" />
                </button>
            </div>
            <p className="agent-welcome-footnote">{t("canvasA.welcome.footnote")}</p>
        </section>
    );
}
