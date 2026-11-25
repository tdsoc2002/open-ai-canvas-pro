import { registerThemePack } from "../registry";
import type { ThemePack } from "../types";
import { JOYSEE_CANVAS_PRESETS, JOYSEE_CANVAS_THEMES } from "./canvas";
import { JoyseeAgentOrb, JoyseeCreditMark } from "./marks";
import { JOYSEE_MINIMAL_SKIN, JOYSEE_MINIMAL_SKIN_ID } from "./skin";
import "./theme.css";
import "./workspace.css";
import "./workbench.css";
import "./canvas-editor.css";

export const joyseeMinimalTheme: ThemePack = {
    id: JOYSEE_MINIMAL_SKIN_ID,
    name: JOYSEE_MINIMAL_SKIN.name,
    skin: JOYSEE_MINIMAL_SKIN,
    creationLayout: "compact",
    workspaceStyle: "joysee",
    copy: { homeHeading: "今天，想创作什么？" },
    agentOrb: JoyseeAgentOrb,
    creditMark: JoyseeCreditMark,
    canvas: { themes: JOYSEE_CANVAS_THEMES, presets: JOYSEE_CANVAS_PRESETS },
};

registerThemePack(joyseeMinimalTheme);

export default joyseeMinimalTheme;
