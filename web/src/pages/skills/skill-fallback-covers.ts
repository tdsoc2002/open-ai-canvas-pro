import type { Skill } from "@/services/api/skills";

const coverRoot = "/images/skill-covers";
const atlasCovers = [
    {
        file: "cinema.png",
        width: 1366,
        height: 1152,
        columns: [0, 684, 1366],
        rows: [0, 385, 740, 1152],
        skillIds: ["14811816970508", "14811816981772", "14811816970252", "14889899552012", "14811816960524", "14811816981260"],
    },
    {
        file: "commerce.png",
        width: 1365,
        height: 1152,
        columns: [0, 683, 1365],
        rows: [0, 384, 752, 1152],
        skillIds: ["14811816961036", "14519800321292", "14811816962316", "14811816969740", "14811816961804", "14811816962060"],
    },
    {
        file: "creative.png",
        width: 1182,
        height: 1330,
        columns: [0, 591, 1182],
        rows: [0, 333, 665, 997, 1330],
        skillIds: ["15215320902412", "14811816980748", "14811816961292", "14889292802060", "14811816969996", "14889292801804", "14811816960780", "14811816981004"],
    },
];

const individualCovers = new Set(["16000000000107", "doubao-audio-prompt", "yingce-image-annotation", "yingce-image-editing", "yingce-image-layer-split", "yingce-short-drama-workflow", "yingshi-drama-workshop"]);
const categoryCovers = new Map([
    ["drama", "storyboard"],
    ["ecommerce", "productvideo"],
    ["creative", "design"],
    ["social", "social"],
]);

type SkillFallbackCover = { src: string; crop?: { width: number; height: number; viewBox: string } };

export function getSkillFallbackCover({ skillId, sourceType, source, tag }: Pick<Skill, "skillId" | "sourceType" | "source" | "tag">): SkillFallbackCover | undefined {
    if (sourceType !== "builtin" && source !== 3) return;

    for (const atlas of atlasCovers) {
        const cell = atlas.skillIds.indexOf(skillId);
        if (cell < 0) continue;
        // 用 LJCanvas 的原始单元边界避开拼合线，不裁改已生成的图片文件。
        const column = cell % 2;
        const row = Math.floor(cell / 2);
        const x = atlas.columns[column] + 2;
        const y = atlas.rows[row] + 2;
        const width = atlas.columns[column + 1] - x - 2;
        const height = atlas.rows[row + 1] - y - 2;
        return { src: `${coverRoot}/${atlas.file}`, crop: { width: atlas.width, height: atlas.height, viewBox: `${x} ${y} ${width} ${height}` } };
    }

    const name = individualCovers.has(skillId) ? skillId : (categoryCovers.get(tag) ?? "workflow");
    return { src: `${coverRoot}/${name}.webp` };
}
