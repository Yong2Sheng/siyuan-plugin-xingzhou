import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 布局不变量守卫。
 *
 * jsdom 没有排版引擎，量不出「控件是否比栅格列宽」，所以这里直接对样式表断言：
 * 每日记录的 input / select / textarea 必须使用 border-box。否则 width:100% 之外还会再加上
 * 10px×2 padding + 1px×2 border，任何控件都会比自己的列宽出 22px
 * （1440px 窗口下「今天最重要的工作内容」与右列「调整内容」相交 12×94px；1100px 窗口下「手表睡眠评分」顶进邻列）。
 */
const scss = readFileSync("src/index.scss", "utf8");

function ruleBody(selector: string): string {
    const index = scss.indexOf(selector);
    if (index < 0) throw new Error(`样式表里找不到规则：${selector}`);
    const start = scss.indexOf("{", index);
    const end = scss.indexOf("}", start);
    return scss.slice(start, end);
}

describe("每日期表单的布局不变量", () => {
    it("控件按 border-box 计算，不会比自己的栅格列宽出内边距与边框", () => {
        const body = ruleBody(".xz-daily-fields input, .xz-daily-fields select, .xz-daily-fields textarea, .xz-daily-fields output");
        expect(body).toContain("box-sizing: border-box");
        expect(body).toContain("width: 100%");
        // padding 与 border 仍然存在：修复方式是改盒模型，而不是把内边距删掉换宽度
        expect(body).toContain("padding: 8px 10px");
        expect(body).toContain("border: 1px solid var(--xingzhou-border)");
    });

    it("不再依赖单个控件的临时补丁，避免回到「只有数字框修好、其它控件照旧溢出」", () => {
        expect(scss).not.toContain(".xz-daily-fields .xz-daily-compact-number { box-sizing: border-box");
    });
});
