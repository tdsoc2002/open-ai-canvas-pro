import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { reportStartupLoadFailure } from "@/lib/chunk-recovery";
import { bootstrapAppearance } from "@/services/appearance-bootstrap";
import { bootstrapLocale } from "@/services/locale-bootstrap";
import { isIsolatedPrevisRepro } from "@/lib/dev-repro";

const pathname = window.location.pathname;
if (!isIsolatedPrevisRepro(import.meta.env.DEV, pathname)) {
    void bootstrapAppearance().catch(() => undefined);
    // 部分模块在载入时翻译文案，因此先应用站点语言策略。
    void bootstrapLocale()
        .then(() => (/^\/welcome\/?$/.test(pathname) ? import("./welcome-application") : import("./application")))
        .catch(reportStartupLoadFailure);
} else {
    void import("./application").catch(reportStartupLoadFailure);
}
