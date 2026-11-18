import { useNavigate } from "react-router";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { InspirationHall } from "./index";

export default function InspirationsPage() {
    const navigate = useNavigate();

    return (
        <WorkspacePage className="inspirations-page">
            <InspirationHall onUse={(item) => navigate("/", { state: { inspiration: { mode: item.mode, prompt: fillablePrompt(item) } } })} />
        </WorkspacePage>
    );
}
