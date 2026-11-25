import type { AppLocale } from "./locales";

type Messages = { avatar: string; site: string; whale: string; orb: string };

export const personalAppearanceMessages: Record<AppLocale, Messages> = {
    "zh-CN": { avatar: "助手形象", site: "跟随站点", whale: "鲸鱼娘", orb: "动态球" },
    "en-US": { avatar: "Assistant appearance", site: "Site default", whale: "Whale girl", orb: "Animated orb" },
    "fr-FR": { avatar: "Apparence de l’assistant", site: "Réglage du site", whale: "Fille baleine", orb: "Orbe animé" },
    "de-DE": { avatar: "Aussehen des Assistenten", site: "Website-Standard", whale: "Walmädchen", orb: "Animierte Kugel" },
    "ja-JP": { avatar: "アシスタントの外見", site: "サイトの設定に従う", whale: "クジラ娘", orb: "アニメーション球体" },
    "ko-KR": { avatar: "도우미 외형", site: "사이트 기본값", whale: "고래 소녀", orb: "움직이는 구체" },
};
