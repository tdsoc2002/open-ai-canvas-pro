import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { declaredInspirationSources } from "@/lib/inspirations/catalog";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { useUserStore } from "@/stores/use-user-store";
import { InspirationHall } from "./index";

export default function InspirationsPage() {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const showSources = useUserStore((state) => state.features.inspirationSourcesVisible);

    return (
        <WorkspacePage className="inspirations-page">
            <InspirationHall onUse={(item) => navigate("/", { state: { inspiration: { mode: item.mode, prompt: fillablePrompt(item) } } })} />
            {showSources ? (
                <div className="inspiration-source-notice">
                    <details>
                        <summary>{t("create.page.sourcesSummary")}</summary>
                        {declaredInspirationSources().map((source) => (
                            <p key={source.name ?? source.label}>
                                {source.notice}
                                {source.repository ? (
                                    <>
                                        {" "}
                                        <a href={source.repository} target="_blank" rel="noreferrer">
                                            {source.name} · {source.license}
                                        </a>
                                    </>
                                ) : null}
                            </p>
                        ))}
                    </details>
                </div>
            ) : null}
        </WorkspacePage>
    );
}
