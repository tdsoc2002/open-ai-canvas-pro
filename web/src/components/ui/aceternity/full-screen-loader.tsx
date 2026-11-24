import { useEffect, useState, type CSSProperties } from "react";

import { translate } from "@/i18n";
import { cn } from "@/lib/utils";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { LoadingClover } from "./loading-clover";

type PageLoaderProps = {
    label: string;
    detail?: string;
    className?: string;
};

export function FullScreenLoader({ label = translate("account.ui.loader.label"), detail = translate("account.ui.loader.detail"), className }: Partial<PageLoaderProps>) {
    return <PageLoader fullScreen label={label} detail={detail} className={className} />;
}

export function WorkspaceRouteLoader({ label = translate("account.ui.loader.route") }: { label?: string }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setVisible(true), 140);
        return () => window.clearTimeout(timer);
    }, []);

    return <PageLoader label={label} className={cn("workspace-route-loader", visible && "is-visible")} />;
}

function PageLoader({ fullScreen = false, label, detail, className }: PageLoaderProps & { fullScreen?: boolean }) {
    // 与 index.html 对齐相位，启动阶段接管时继续当前一轮叶片亮起的节奏。
    const [clock] = useState(() => ({ "--loader-clock": `${performance.now()}ms` }) as CSSProperties);
    const appearanceResolved = useAppearanceStore((state) => state.resolved);

    return (
        <div
            data-full-screen-loader={fullScreen || undefined}
            data-workspace-route-loader={!fullScreen || undefined}
            data-appearance-resolved={appearanceResolved}
            role="status"
            aria-live="polite"
            aria-label={detail ? translate("account.ui.loader.aria", { label, detail }) : label}
            className={cn("page-loader", fullScreen && "full-screen-loader", className)}
            style={clock}
        >
            <LoadingClover />
            <div className="page-loader-copy">
                <strong>{label}</strong>
                {detail ? <span>{detail}</span> : null}
            </div>
        </div>
    );
}
