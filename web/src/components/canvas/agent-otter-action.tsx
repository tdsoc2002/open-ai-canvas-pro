import { useId, useState, type Ref } from "react";
import { DEFAULT_AGENT_AVATAR } from "@/lib/canvas/agent-appearance";
import { cn } from "@/lib/utils";

export const OTTER_RIG_SRC = "/doll/editor-otter-rig.webp";

export function AgentOtterAvatar({ avatarRef, collapsed }: { avatarRef: Ref<HTMLSpanElement>; collapsed: boolean }) {
    const id = useId();
    const [rigReady, setRigReady] = useState(false);
    const imageSize = { width: 1254, height: 1254 };

    return (
        <span ref={avatarRef} className={cn("canvas-agent-default-avatar", collapsed && "size-8")} data-otter-ready={rigReady || undefined}>
            <img {...DEFAULT_AGENT_AVATAR} alt="" draggable={false} />
            <svg className="canvas-agent-otter-rig" viewBox="0 0 1254 1254" aria-hidden="true">
                <defs>
                    <clipPath id={`${id}-body`}>
                        <path d="M0 614H330L344 548H783L810 582H1254V1254H0Z" />
                    </clipPath>
                    <linearGradient id={`${id}-neck`} x1="0" x2="0" y1="590" y2="657" gradientUnits="userSpaceOnUse">
                        <stop stopColor="white" />
                        <stop offset="1" stopColor="white" stopOpacity="0" />
                    </linearGradient>
                    <mask id={`${id}-head`} maskUnits="userSpaceOnUse" x="0" y="0" width="1254" height="657">
                        <rect width="1254" height="657" fill={`url(#${id}-neck)`} />
                    </mask>
                    <clipPath id={`${id}-slate`}>
                        <path d="M369 654Q369 639 388 630L637 562Q660 554 673 568Q687 583 690 606Q694 622 674 629L421 691Z" />
                    </clipPath>
                    <clipPath id={`${id}-hinge`}>
                        <ellipse cx="401" cy="684" rx="39" ry="40" />
                    </clipPath>
                </defs>
                <image href={OTTER_RIG_SRC} {...imageSize} clipPath={`url(#${id}-body)`} onLoad={() => setRigReady(true)} />
                <g data-otter-head style={{ transformBox: "view-box", transformOrigin: "48% 47%" }}>
                    <image href={OTTER_RIG_SRC} {...imageSize} mask={`url(#${id}-head)`} />
                </g>
                <g data-otter-slate style={{ transformBox: "view-box", transformOrigin: "32% 54.5%" }}>
                    <image href={DEFAULT_AGENT_AVATAR.src} {...imageSize} clipPath={`url(#${id}-slate)`} />
                </g>
                <image href={DEFAULT_AGENT_AVATAR.src} {...imageSize} clipPath={`url(#${id}-hinge)`} />
            </svg>
        </span>
    );
}

export function playAgentOtterAction(avatar: HTMLElement) {
    const slate = avatar.querySelector<SVGGElement>("[data-otter-slate]");
    const head = avatar.querySelector<SVGGElement>("[data-otter-head]");
    if (!avatar.dataset.otterReady || !slate?.animate || !head?.animate) return null;

    avatar.dataset.otterPlaying = "true";
    const snapDuration = 90;
    const animations = [
        slate.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(12deg)" }], {
            duration: snapDuration,
            easing: "cubic-bezier(0.32, 0.72, 0, 1)",
            fill: "forwards",
        }),
        head.animate([{ transform: "none" }, { transform: "translateY(1.1%) rotate(3deg) scaleY(0.94)" }, { transform: "none" }], {
            delay: snapDuration,
            duration: 180,
            easing: "ease-in-out",
        }),
    ];
    return {
        finished: Promise.all(animations.map((animation) => animation.finished)),
        cancel() {
            delete avatar.dataset.otterPlaying;
            for (const animation of animations) animation.cancel();
        },
    };
}
