import { ChevronDown } from "lucide-react";
import type { ClipboardEvent, ReactNode } from "react";
import type { WorkbenchKind } from "@/services/api/workbench";

/** 图片与视频工作台共用的乐见布局，只组合调用方提供的业务控件。 */
export function WorkbenchStudio({
    kind,
    parameters,
    scene,
    references,
    prompt,
    submit,
    onPaste,
}: {
    kind: WorkbenchKind;
    parameters: ReactNode;
    scene?: { name: string; onOpen: () => void };
    references: ReactNode;
    prompt: ReactNode;
    submit: ReactNode;
    onPaste: (event: ClipboardEvent<HTMLElement>) => void;
}) {
    const label = kind === "image" ? "图片" : "视频";
    return (
        <section className="wb-studio-layout" aria-label={`${label}生成工作区`} onPasteCapture={onPaste}>
            <h1 className="sr-only">{label}创作</h1>
            <aside className="wb-studio-parameters" aria-label={`${label}参数`}>
                <div className="wb-studio-parameter-scroll">{parameters}</div>
            </aside>
            <section className="wb-studio-writing" aria-label={`${label}提示词与参考素材`}>
                {scene ? (
                    <div className="wb-studio-scene">
                        <span aria-hidden="true">出品场景</span>
                        <button type="button" aria-label={`出品场景：${scene.name}`} aria-haspopup="dialog" onClick={scene.onOpen}>
                            <span>{scene.name}</span>
                            <ChevronDown aria-hidden="true" />
                        </button>
                    </div>
                ) : null}
                <div className="wb-studio-references">{references}</div>
                <div className="wb-studio-prompt">{prompt}</div>
            </section>
            <div className="wb-studio-dock">{submit}</div>
        </section>
    );
}
