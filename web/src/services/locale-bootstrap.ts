import { configureMultilingual, currentLocale } from "@/i18n";
import { http } from "@/services/api/request";

export async function bootstrapLocale() {
    // 只在服务端明确开放时启用；无法读取配置时仍能用中文打开页面。
    const settings = await http.get<{ multilingualEnabled: boolean }>("/public/ui-language", { timeout: 4_000 }).catch(() => undefined);
    await configureMultilingual(settings?.multilingualEnabled === true);
    document.documentElement.lang = currentLocale();
}
