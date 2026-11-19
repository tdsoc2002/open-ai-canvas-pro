import { expect, test } from "bun:test";

async function pickerSources() {
    const [component, styles] = await Promise.all([Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text(), Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text()]);
    return { component, styles };
}

test("共享模型菜单不渲染调用成功率、调用详情或圆点", async () => {
    const { component, styles } = await pickerSources();
    expect(component).not.toMatch(/recentResults|rate24h|ModelAvailabilityBadge/);
    expect(styles).not.toContain(".model-picker-availability");
});
