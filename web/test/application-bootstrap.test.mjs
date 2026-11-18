import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

import { isIsolatedPrevisRepro } from "../src/lib/dev-repro";

// Execute the real entry point; replace only its font, network and UI side effects.
async function prepareEntry(dev, pathname) {
    const build = await Bun.build({
        entrypoints: [fileURLToPath(new URL("../src/main.tsx", import.meta.url))],
        target: "browser",
        format: "iife",
        define: { "import.meta.env.DEV": JSON.stringify(dev) },
        plugins: [
            {
                name: "entry-side-effects",
                setup(builder) {
                    builder.onResolve({ filter: /^(@fontsource-variable\/|@\/services\/(appearance|locale)-bootstrap$|\.\/(welcome-)?application$)/ }, ({ path }) => ({ path, namespace: "entry-test" }));
                    builder.onLoad({ filter: /.*/, namespace: "entry-test" }, ({ path }) => {
                        if (path.startsWith("@fontsource-variable/")) return { contents: "", loader: "js" };
                        if (path === "@/services/appearance-bootstrap") {
                            return { contents: 'export function bootstrapAppearance() { events.push("appearance"); return appearanceReady; }', loader: "js" };
                        }
                        if (path === "@/services/locale-bootstrap") {
                            return { contents: 'export function bootstrapLocale() { events.push("locale"); return localeReady; }', loader: "js" };
                        }
                        return { contents: `events.push(${JSON.stringify(path)}); entryLoaded();`, loader: "js" };
                    });
                },
            },
        ],
    });
    expect(build.success).toBe(true);

    const events = [];
    let resolveAppearance;
    let resolveLocale;
    let entryLoaded;
    const appearanceReady = new Promise((resolve) => (resolveAppearance = resolve));
    const localeReady = new Promise((resolve) => (resolveLocale = resolve));
    const loaded = new Promise((resolve) => (entryLoaded = resolve));
    const listeners = new Map();
    runInNewContext(await build.outputs[0].text(), { window: { location: { pathname }, addEventListener: (name, listener) => listeners.set(name, listener) }, events, appearanceReady, localeReady, entryLoaded });
    expect(typeof listeners.get("vite:preloadError")).toBe("function");
    return { events, resolveAppearance, resolveLocale, loaded };
}

test("DEV previs lab loads without calling the appearance or locale backend", async () => {
    const entry = await prepareEntry(true, "/dev/previs-repro");
    await entry.loaded;
    expect(entry.events).toEqual(["./application"]);
});

for (const [dev, pathname] of [
    [false, "/dev/previs-repro"],
    [true, "/login"],
    [false, "/login"],
    [true, "/dev/previs-repro/"],
    [true, "/dev/previs-repro-other"],
]) {
    test(`normal startup waits for the locale but not the appearance: dev=${dev} path=${pathname}`, async () => {
        const entry = await prepareEntry(dev, pathname);
        expect(entry.events).toEqual(["appearance", "locale"]);
        entry.resolveLocale();
        await entry.loaded;
        expect(entry.events).toEqual(["appearance", "locale", "./application"]);
        entry.resolveAppearance();
    });
}

for (const pathname of ["/welcome", "/welcome/"]) {
    test(`public film entry remains independent: ${pathname}`, async () => {
        const entry = await prepareEntry(false, pathname);
        expect(entry.events).toEqual(["appearance", "locale"]);
        entry.resolveLocale();
        await entry.loaded;
        // 欢迎页沿用站点外观（#683），但外观请求不阻塞欢迎页入口加载。
        expect(entry.events).toEqual(["appearance", "locale", "./welcome-application"]);
        entry.resolveAppearance();
    });
}

test("provider isolation shares the exact DEV-only route boundary", () => {
    expect(isIsolatedPrevisRepro(true, "/dev/previs-repro")).toBe(true);
    expect(isIsolatedPrevisRepro(false, "/dev/previs-repro")).toBe(false);
    for (const path of ["/", "/login", "/dev/previs-repro/", "/dev/previs-repro-other"]) {
        expect(isIsolatedPrevisRepro(true, path)).toBe(false);
    }
});
