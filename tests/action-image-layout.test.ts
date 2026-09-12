import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 细则缩略图行的布局不变量守卫。
 *
 * jsdom 没有排版引擎，量不出「两张缩略图是否同行」，所以直接对样式表断言。
 * 实测证据（design/probe-thumb-wrap.html，真 CSS + 真 DOM，浏览器实测）：
 * 详情栏内容盒 ≤620px 时命中 `@container (max-width: 620px)` 的 `width: calc(50% - 4px)`；
 * 该元素有 1px 边框，若按 content-box 计算，实际外框是 `50% - 2px`，
 * 两张 + 8px 间隙 = 100% + 4px，于是永远被挤到下一行：
 *   容器内容盒 616px → 缩略图行 534px → 单张 265 + 265 + 间隙 8 = 538 > 534 → 换行。
 * 1440px 面板下详情栏内容盒就是 568px，属于命中区间，所以这是用户日常可见的路径。
 */
const scss = readFileSync("src/index.scss", "utf8");

function ruleBody(selector: string): string {
    const index = scss.indexOf(selector);
    if (index < 0) throw new Error(`样式表里找不到规则：${selector}`);
    const start = scss.indexOf("{", index);
    const end = scss.indexOf("}", start);
    return scss.slice(start, end);
}

describe("细则缩略图行的布局不变量", () => {
    it("缩略图按 border-box 计算，声明宽度就是外框宽度", () => {
        const body = ruleBody(".xz-action-images__item {");
        expect(body).toContain("box-sizing: border-box");
        // 声明尺寸与边框都保留：修复方式是改盒模型，而不是把边框删掉充宽度
        expect(body).toContain("width: 132px");
        expect(body).toContain("height: 96px");
        expect(body).toContain("border: 1px solid var(--xingzhou-border)");
    });

    it("窄容器下的两张一行仍按 calc(50% - 4px) 与 8px 间隙推算", () => {
        const row = ruleBody(".xz-action-images {");
        expect(row).toContain("flex-wrap: wrap");
        expect(row).toContain("gap: 8px");
        // 2 × calc(50% - 4px) + 8px = 100%：只有 border-box 时才成立
        expect(scss).toContain(".xz-action-images__item { width: calc(50% - 4px); height: 88px; }");
    });
});
