export type TaskResultMedia = { url: string; kind: "image" | "video" | "audio"; resourceId?: string };

export function taskResultResourceId({ url, resourceId }: TaskResultMedia): string {
    return /\/resources\/([a-z0-9_-]{1,80})\/file$/i.exec(url.split(/[?#]/, 1)[0])?.[1] || resourceId || "";
}

function parseResult(value?: string, fallback: string | null | undefined = value): unknown {
    try {
        return JSON.parse(value || "null");
    } catch {
        return fallback;
    }
}

function readTextBody(value: unknown): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(readTextBody).join("");
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    if (typeof record.type === "string" && /reasoning|thinking|prompt/i.test(record.type)) return "";
    for (const key of ["text", "content", "output_text", "value"]) {
        const text = readTextBody(record[key]);
        if (text.trim()) return text;
    }
    // 分镜正文有已定义的结构化 text 对象，只展示其正文结构。
    if (Array.isArray(record.rows)) {
        return JSON.stringify({ title: typeof record.title === "string" ? record.title : undefined, rows: record.rows }, (key, item) => (/^(?:reasoning|thinking|prompt)$/i.test(key) ? undefined : item), 2);
    }
    return "";
}

export function taskResultText(value?: string, draft?: string) {
    // 损坏的结构化结果不能当裸文本，否则可能把推理或提示词放进正文区。
    const looksStructured = /^\s*(?:\{\s*["}]|\[\s*[\[{"\]])/.test(value || "");
    const result = parseResult(value, looksStructured ? null : value);
    if (typeof result === "string" && result.trim()) return result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
        const record = result as Record<string, unknown>;
        for (const key of ["text", "content", "output"]) {
            const text = key === "text" ? readTextBody(record[key]) : record[key];
            if (typeof text === "string" && text.trim()) return text;
        }
    }
    return draft?.trim() ? draft : "";
}

export function taskResultMedia(value: string | undefined, kind: TaskResultMedia["kind"], fallback?: TaskResultMedia) {
    const audioTask = kind === "audio";
    const items = new Map<string, TaskResultMedia>();
    const visit = (item: unknown, hint: TaskResultMedia["kind"], field: string, resourceId?: string) => {
        if (items.size >= 12) return;
        if (typeof item === "string") {
            const url = item.trim();
            if (audioTask ? !/^(?:url|data_?url|audio_?url|result_?url|output_?url|audio|audios|output|outputs|result|media)$/i.test(field) : !/(url|image|video|result|output|media)/i.test(field)) return;
            if (!/^(https?:\/\/|blob:|data:(?:image|video|audio)\/|\/api\/resources\/[a-z0-9_-]{1,80}\/file(?:$|[?#]))/i.test(url) || items.has(url)) return;
            const path = url.split(/[?#]/, 1)[0];
            const isAudio = /^data:audio\//i.test(url) || /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|pcm)$/i.test(path);
            const isVideo = /^data:video\//i.test(url) || /\.(mp4|webm|mov)$/i.test(path);
            const isImage = /^data:image\//i.test(url) || /\.(png|jpe?g|webp|gif|avif)$/i.test(path);
            if (audioTask ? !isAudio && (isImage || isVideo || hint !== "audio") : isAudio) return;
            items.set(url, { url, kind: audioTask ? "audio" : isVideo ? "video" : isImage ? "image" : hint, ...(resourceId ? { resourceId } : {}) });
        } else if (Array.isArray(item)) {
            for (const child of item) visit(child, hint, field);
        } else if (item && typeof item === "object") {
            const record = item as Record<string, unknown>;
            const rawResourceId = typeof record.resourceId === "string" ? record.resourceId : typeof record.storageKey === "string" ? /^resource:(.+)$/.exec(record.storageKey)?.[1] : undefined;
            const ownResourceId = rawResourceId && /^[a-z0-9_-]{1,80}$/i.test(rawResourceId) ? rawResourceId : undefined;
            const mime = typeof record.mimeType === "string" ? record.mimeType : "";
            if (!audioTask && mime.startsWith("audio/")) return;
            const mediaKind = mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : hint;
            for (const [key, child] of Object.entries(record)) {
                if (/poster|thumbnail|cover|reference|input|config/i.test(key) || (audioTask ? /metadata/i.test(key) : /audio/i.test(key))) continue;
                const isMediaUrl = /^(?:url|data_?url|image_?url|video_?url|audio_?url|result_?url|output_?url)$/i.test(key);
                visit(child, /image/i.test(key) ? "image" : /video/i.test(key) ? "video" : /audio/i.test(key) ? "audio" : mediaKind, key, isMediaUrl ? ownResourceId : undefined);
            }
        }
    };
    visit(parseResult(value), kind, "result");
    if (items.size === 0 && fallback) visit(fallback.url, fallback.kind, "result", fallback.resourceId);
    return [...items.values()];
}
