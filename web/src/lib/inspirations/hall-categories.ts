import type { CreationInspiration } from "./catalog";

export const INSPIRATION_HALL_CATEGORIES = [
    { value: "all", label: "全部灵感" },
    { value: "film", label: "影视短片" },
    { value: "animation", label: "动画动漫" },
    { value: "commercial", label: "广告电商" },
    { value: "design", label: "平面设计" },
    { value: "portrait", label: "人像时尚" },
    { value: "lifestyle", label: "生活方式" },
    { value: "writing", label: "故事文案" },
] as const;

export type InspirationHallFilter = (typeof INSPIRATION_HALL_CATEGORIES)[number]["value"];
type InspirationHallCategory = Exclude<InspirationHallFilter, "all">;

const contentRules: ReadonlyArray<{ value: InspirationHallCategory; keywords: RegExp }> = [
    { value: "commercial", keywords: /广告|电商|营销|带货|促销|产品|商品|主图|品牌宣传|\b(?:advertis\w*|commercial|ecommerce|product|marketing)\b/i },
    { value: "design", keywords: /海报|图标|字体|排版|信息图|视觉识别|标志设计|品牌设计|网页|界面|封面设计|封面插画|书籍封面|\b(?:poster|logo|typography|infographic|flyer|thumbnail|web design|app design)\b/i },
    { value: "animation", keywords: /动画|动漫|漫画|卡通|二次元|角色设定|角色概念|角色转面|吉卜力|皮克斯|黏土|粘土|定格|Q\s*版|Q\s*萌|\b(?:anime|manga|comic|cartoon|chibi|stop.motion)\b/i },
    { value: "portrait", keywords: /人像|肖像|写真|头像|自拍|时尚|造型|模特|服装|高定|礼服|汉服|\b(?:portrait|selfie|avatar|fashion|lookbook|influencer)\b/i },
    { value: "lifestyle", keywords: /旅行|旅拍|日记|日常|生活|美食|食谱|烹饪|咖啡|宠物|动物|运动|单板|滑雪|健身|风景|自然|建筑|室内|花房|\b(?:vlog|travel|food|drink|pet|animal|sports|landscape|nature|architecture|interior)\b/i },
    { value: "film", keywords: /电影|影视|剧照|悬疑|武侠|科幻|奇幻|\b(?:cinematic|film.still|sci.fi)\b/i },
    { value: "design", keywords: /插画|草图|线稿|水墨|油画|水彩|像素|极简|\b(?:illustration|sketch|line.art|painting|watercolor|pixel|minimalism|brand|social.media|diagram|chart)\b/i },
    { value: "animation", keywords: /三维|3D|3d.render|isometric/i },
];

export function inspirationHallCategoryOf(item: CreationInspiration): InspirationHallCategory {
    if (item.mode === "text") return "writing";
    // 部分上游分类（如电商主图）混有人像和动漫，优先用标题和标签判断。
    const content = [item.title, ...(item.tags ?? [])].join(" ");
    return contentRules.find((rule) => rule.keywords.test(content))?.value ?? contentRules.find((rule) => rule.keywords.test(item.category ?? ""))?.value ?? (item.mode === "video" ? "film" : "lifestyle");
}
