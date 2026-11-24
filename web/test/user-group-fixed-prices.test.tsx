import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("分组专属单价在独立 DOM 中支持录入、回读及移除", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/user-group-fixed-prices.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
}, 35000);
