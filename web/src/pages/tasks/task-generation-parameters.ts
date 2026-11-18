import { standardImageRatioForSize } from "@/lib/image-size-presets";
import { doubaoAudioDialectOptions, doubaoAudioLanguageOptions, doubaoAudioVoiceOptions, openAIAudioVoiceOptions } from "@/lib/audio-generation";

type MediaKind = "image" | "video";
export type TaskParameterKind = MediaKind | "audio" | "text";
type RecordedExtra = { key: ExtraKey; value: string | number | boolean };
type ExtraKey =
    | "quality"
    | "count"
    | "outputFormat"
    | "transparentBackground"
    | "background"
    | "outputCompression"
    | "moderation"
    | "responseFormat"
    | "googleSearch"
    | "googleImageSearch"
    | "includeThoughts"
    | "thinkingLevel"
    | "watermark"
    | "voice"
    | "audioFormat"
    | "audioSpeed"
    | "audioLanguage"
    | "audioDialect"
    | "thinking"
    | "referenceImages"
    | "referenceVideos"
    | "referenceAudios";
const audioVoiceOptions = [...doubaoAudioVoiceOptions, ...openAIAudioVoiceOptions];

type TaskGenerationParameters = {
    resolution?: string;
    ratio?: string;
    duration?: number | "auto";
    audio?: boolean;
    unavailable?: boolean;
    extras?: RecordedExtra[];
};

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function token(value: unknown) {
    if (typeof value !== "string" && typeof value !== "number") return "";
    const result = String(value).trim();
    return result.length <= 32 ? result : "";
}

function automatic(value: string) {
    return /^(auto|adaptive|any)$/i.test(value);
}

function booleanValue(value: unknown) {
    const flag = typeof value === "string" ? value.toLowerCase() : value;
    return flag === true || flag === "true" ? true : flag === false || flag === "false" ? false : undefined;
}

function recordedExtras(values: Record<string, unknown>, kind: TaskParameterKind): RecordedExtra[] {
    const rows: RecordedExtra[] = [];
    const add = (key: ExtraKey, value: RecordedExtra["value"] | undefined) => {
        if (value !== undefined && value !== "") rows.push({ key, value });
    };
    const choice = (key: string) => {
        const value = values[key];
        return typeof value === "string" && /^[a-z0-9][a-z0-9_.-]{0,95}$/i.test(value) ? value : "";
    };
    const count = (key: string, min: number, max: number) => {
        const value = token(values[key]);
        const number = /^\d+$/.test(value) ? Number(value) : NaN;
        return number >= min && number <= max ? number : undefined;
    };
    const option = (key: string, descriptors: readonly { value: string; label: string }[]) => {
        const value = choice(key);
        return value && (descriptors.find((entry) => entry.value === value)?.label ?? value);
    };
    const level = choice("thinkingLevel").toLowerCase();
    if (kind === "image") {
        const quality = choice("quality");
        if (!/^[1-9]\d?(?:\.\d)?k$/i.test(quality)) add("quality", quality);
        add("count", count("count", 1, 100));
        add("outputFormat", choice("outputFormat").toUpperCase());
        for (const key of ["transparentBackground", "googleSearch", "googleImageSearch", "includeThoughts"] as const) add(key, booleanValue(values[key]));
        for (const key of ["background", "moderation", "responseFormat"] as const) add(key, choice(key));
        add("outputCompression", count("outputCompression", 0, 100));
        add("thinkingLevel", level);
    } else if (kind === "video") {
        add("watermark", booleanValue(values.videoWatermark ?? values.watermark));
    } else if (kind === "audio") {
        add("voice", option("audioVoice", audioVoiceOptions));
        const format = choice("audioFormat");
        add("audioFormat", format.toLowerCase() === "ogg_opus" ? "OGG Opus" : format.toUpperCase());
        const speed = token(values.audioSpeed);
        const multiplier = /^\d+(?:\.\d+)?$/.test(speed) ? Number(speed) : 0;
        if (multiplier > 0 && multiplier <= 100) add("audioSpeed", multiplier);
        add("audioLanguage", option("audioLanguage", doubaoAudioLanguageOptions));
        add("audioDialect", option("audioDialect", doubaoAudioDialectOptions));
    } else {
        add("thinking", booleanValue(values.thinking) ?? (level || undefined));
    }
    for (const key of ["referenceImages", "referenceVideos", "referenceAudios"] as const) add(key, count(key, 1, 128));
    return rows;
}

function ratioLabel(value: string, kind: MediaKind) {
    if (automatic(value)) return "auto";
    const explicit = /^([1-9]\d{0,5})\s*:\s*([1-9]\d{0,5})$/.exec(value);
    if (explicit) return `${explicit[1]}:${explicit[2]}`;
    const pixels = /^([1-9]\d{0,5})\s*[x×]\s*([1-9]\d{0,5})$/i.exec(value);
    if (!pixels) return undefined;
    if (kind === "image") {
        const preset = standardImageRatioForSize(`${pixels[1]}x${pixels[2]}`);
        if (preset) return preset;
    }
    const width = Number(pixels[1]);
    const height = Number(pixels[2]);
    let a = width;
    let b = height;
    while (b) [a, b] = [b, a % b];
    return `${width / a}:${height / a}`;
}

function resolutionLabel(value: string, kind: MediaKind) {
    if (automatic(value)) return "auto";
    if (/^[1-9]\d?(?:\.\d)?k$/i.test(value)) return value.toUpperCase();
    if (/^[1-9]\d{0,5}\s*[x×]\s*[1-9]\d{0,5}$/i.test(value)) return value.replace(/\s*[x×]\s*/i, " × ");
    if (kind === "video" && /^[1-9]\d{0,4}(?:p[竖横]?)?$/i.test(value)) return /p/i.test(value) ? value.replace(/p/i, "p") : `${value}p`;
    return undefined;
}

// 按当次公开摘要展示。旧服务仍可读取工作台已脱敏的任务快照。
export function taskGenerationParameters(inputJson: string | undefined, kind: TaskParameterKind): TaskGenerationParameters {
    let input: Record<string, unknown>;
    try {
        input = record(JSON.parse(inputJson || "null"));
    } catch {
        return {};
    }
    const workbench = record(input.workbench);
    const compatible = workbench.kind === kind ? record(workbench.parameters) : {};
    const values = input.generationParameters !== undefined ? record(input.generationParameters) : compatible;
    const result: TaskGenerationParameters = {};
    if (input.generationParametersUnavailable === true) result.unavailable = true;
    const extras = recordedExtras(values, kind);
    if (extras.length) result.extras = extras;
    if ((kind !== "image" && kind !== "video") || (result.unavailable && !Object.keys(values).length)) return result;
    const size = token(values.size ?? values.ratio);
    const ratio = ratioLabel(token(values.aspect_ratio), kind) ?? ratioLabel(size, kind);
    const savedResolution = token(kind === "video" ? (values.vquality ?? values.resolution) : values.imageResolution);
    const imageTier = kind === "image" && /k$/i.test(token(values.quality)) ? token(values.quality) : "";
    const resolution = resolutionLabel(savedResolution || imageTier, kind) ?? (automatic(size) ? undefined : resolutionLabel(size, kind));
    if (kind === "image") return { ...result, ratio, resolution };
    const seconds = token(values.videoSeconds ?? values.seconds);
    const number = /^\d+(?:\.\d+)?$/.test(seconds) ? Number(seconds) : 0;
    const duration = automatic(seconds) || seconds === "0" || seconds === "-1" ? "auto" : number > 0 && number <= 86400 ? number : undefined;
    const audio = booleanValue(values.videoGenerateAudio ?? values.generateAudio);
    return { ...result, resolution, ratio, duration, audio };
}
