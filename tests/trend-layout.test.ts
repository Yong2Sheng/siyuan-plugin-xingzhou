import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 趋势视图的布局不变量守卫。
 *
 * `.xz-daily-module` 本身是 `overflow: hidden` 的 flex 列，每个视图自己负责滚动
 * （`.xz-daily-layout` / `.xz-checklist-page` / `.xz-daily-list-view` 都是 `flex: 1; overflow: auto`）。
 * 趋势视图第一版漏了这条：白天精力那张卡片被直接裁掉，而且没有滚动条。
 * jsdom 量不出滚动条，所以这里对样式表断言。
 */
const scss = readFileSync("src/index.scss", "utf8");

function ruleBody(selector: string): string {
    const index = scss.indexOf(selector);
    if (index < 0) throw new Error(`样式表里找不到规则：${selector}`);
    const start = scss.indexOf("{", index);
    const end = scss.indexOf("}", start);
    return scss.slice(start, end);
}

describe("趋势视图的布局不变量", () => {
    it("趋势视图自己是滚动容器，内容超出一屏时可以滚动", () => {
        const body = ruleBody(".xz-trend-view {");
        expect(body).toContain("flex: 1");
        expect(body).toContain("min-height: 0");
        expect(body).toContain("overflow: auto");
    });

    it("卡片按内容高度排布，不裁切图表", () => {
        const card = ruleBody(".xz-trend-card {");
        expect(card).not.toContain("overflow: hidden");
        expect(card).not.toContain("height: 100%");
        expect(card).toContain("min-width: 0");
    });

    it("窄屏仍然保留内边距，卡片不贴边", () => {
        const narrow = scss.slice(scss.indexOf("@media (max-width: 620px)", scss.indexOf("趋势视图")));
        expect(narrow).toContain(".xz-trend-view { padding: 10px 12px 18px; }");
    });
});
