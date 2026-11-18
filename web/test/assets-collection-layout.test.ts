import { describe, expect, test } from "bun:test";
import { zhCN as libraryZh } from "../src/i18n/messages/areas/library/zh-CN";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { moduleGroupSource } from "./helpers/module-group-source";

describe("资产库全宽布局", () => {
    test("类型独立成行，业务分类与文件夹进入工具栏，移除左侧分类和独立容量条", () => {
        const page = moduleGroupSource("pages/assets/index.tsx");
        expect(page).toContain('className="collection-navigation-header assets-library-header"');
        expect(page).toContain('className="assets-type-filter"');
        const toolbar = page.slice(page.indexOf("<CollectionToolbar"), page.indexOf("</CollectionToolbar>"));
        expect(toolbar).toContain('ariaLabel={t("library.assets.batch.category")}');
        expect(toolbar).toContain("<AssetFolderFilter");
        expect(page).not.toContain("assets-collection-filters");
        expect(page).not.toContain("<AssetStorageUsage");
        expect(page).toContain("onClick: openStoragePurchase");
        expect(page).toMatch(/key: "trash"[^}]*onClick: openTrash/);
        const kindFilter = page.slice(page.indexOf("<AssetFilterGroup"), page.indexOf("/>", page.indexOf("<AssetFilterGroup")));
        expect(kindFilter).toContain("value={kindFilter}");
        expect(kindFilter).not.toContain("setViewMode");
        expect(libraryZh.assets.page).toMatchObject({ kindFilter: "素材类型", myFolders: "我的分类" });
    });
});

describe("wallet history pagination", () => {
    test("pins ledger pagination to the history panel footer", () => {
        const modal = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-wallet-modal.tsx"), "utf8");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        expect(modal).toContain("workspace-wallet-history-scroll");
        expect(modal).toContain("workspace-wallet-pagination");
        expect(modal).not.toContain("wallet.total > 20");
        expect(css).toMatch(/\.workspace-wallet-content\.is-history\s*\{[^}]*overflow:\s*hidden/s);
        expect(css).toMatch(/\.workspace-wallet-pagination\s*\{[^}]*margin-top:\s*auto/s);
    });
});
