import { afterEach, describe, expect, it, vi } from "vitest";
import { renderActionMarkdown } from "../src/markdown-renderer";

const luteHost = globalThis as typeof globalThis & { Lute?: unknown };
const originalLute = luteHost.Lute;

afterEach(() => {
    luteHost.Lute = originalLute;
});

describe("renderActionMarkdown", () => {
    it("使用思源 Lute 转换并净化行动内容", () => {
        const instance = {
            SetBlockRef: vi.fn(),
            SetGFMStrikethrough: vi.fn(),
            SetInlineMath: vi.fn(),
            SetSoftBreak2HardBreak: vi.fn(),
            SetTag: vi.fn(),
            Md2HTML: vi.fn(() => "<p><strong>重点</strong></p>"),
        };
        const sanitize = vi.fn(() => "<p><strong>重点</strong></p>");
        luteHost.Lute = { New: () => instance, Sanitize: sanitize };

        expect(renderActionMarkdown("**重点**")).toBe("<p><strong>重点</strong></p>");
        expect(instance.Md2HTML).toHaveBeenCalledWith("**重点**");
        expect(instance.SetGFMStrikethrough).toHaveBeenCalledWith(true);
        expect(instance.SetSoftBreak2HardBreak).toHaveBeenCalledWith(true);
        expect(sanitize).toHaveBeenCalledWith("<p><strong>重点</strong></p>");
    });

    it("普通多行文本不会泄漏思源内部块属性", () => {
        const instance = {
            Md2HTML: vi.fn(() => "<p>第一行<br>\n第二行</p>"),
        };
        luteHost.Lute = { New: () => instance, Sanitize: (html: string) => html };

        const rendered = renderActionMarkdown("第一行\n第二行");
        expect(rendered).toBe("<p>第一行<br>\n第二行</p>");
        expect(rendered).not.toContain("{: id=");
    });

    it("Lute 不可用时安全显示原文并保留换行", () => {
        luteHost.Lute = undefined;

        expect(renderActionMarkdown("第一行\n<script>alert(1)</script>"))
            .toBe("<p>第一行<br>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    });
});
