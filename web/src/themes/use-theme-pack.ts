import { useEffectiveSkin } from "@/stores/use-appearance-preferences-store";

import { themePackFor } from "./registry";

/** 从站点皮肤读取主题包的界面组件与预设。 */
export function useThemePack() {
    return themePackFor(useEffectiveSkin().id);
}
