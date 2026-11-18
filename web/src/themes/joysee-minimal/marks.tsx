import { cn } from "@/lib/utils";
import type { ThemeAgentOrbProps } from "../types";

/** 取景环：待命时静止，仅真实工作状态提示运动；减少动态效果下仍保留状态图形。 */
export function JoyseeAgentOrb({ size, state, className }: ThemeAgentOrbProps) {
    return (
        <svg className={cn("joysee-agent-orb", className)} data-state={state} width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <circle className="joysee-agent-orb-surface" cx="24" cy="24" r="22" />
            <circle className="joysee-agent-orb-ring" cx="24" cy="24" r="17" stroke="currentColor" strokeWidth="1.5" strokeDasharray={state === "work" ? "68 40" : undefined} />
            {state === "done" ? <path d="m17 24 5 5 9-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M19 19h10v10H19z" stroke="currentColor" strokeWidth="1.5" />}
        </svg>
    );
}

export function JoyseeCreditMark({ className }: { className?: string }) {
    return (
        <span className={cn("joysee-credit-mark", className)} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
                <path
                    d="M13.2 1.8C14.4 7 7.5 8.4 9 13.2C6.5 12.8 5.6 10.9 5.5 9C.4 14.5 3.5 22 11.8 22C19.8 22 23.2 13.3 18.5 7.8C18.8 11.3 17.2 12.3 15.9 12.5C17.8 7.7 14.9 3 13.2 1.8Z M12.4 12.6C12.6 15.3 9.5 15.5 9.5 18.1C9.5 20.4 14.8 21.5 15.1 17.8C15.2 15.9 13.5 13.8 12.4 12.6Z"
                    fill="currentColor"
                    fillRule="evenodd"
                    stroke="none"
                />
            </svg>
        </span>
    );
}
