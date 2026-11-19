import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const applicationPage = readFileSync(new URL("../src/pages/plugins/index.tsx", import.meta.url), "utf8");
const eaglePage = readFileSync(new URL("../src/pages/plugins/eagle.tsx", import.meta.url), "utf8");
const assetsPage = readFileSync(new URL("../src/pages/assets/index.tsx", import.meta.url), "utf8");

describe("插件管理入口分离", () => {
    test("工作区只合并可个人启用的应用，并不链接后台插件管理", () => {
        expect(applicationPage).toContain('plugin.management.activationScope === "user"');
        expect(applicationPage).not.toContain('"/admin/plugins"');
        expect(applicationPage).not.toContain("支付协议");
    });

    test("从资产打开 Eagle，并在 Eagle 页进入个人设置", () => {
        expect(assetsPage).toContain('navigate("/plugins/eagle")');
        expect(eaglePage).toContain('navigate("/plugins?search=Eagle")');
        expect(applicationPage).toContain('searchParams.get("search")');
    });
});
