import { describe, expect, it } from "vitest";
import { applyOrderedListNormalization, continueMarkdownList, normalizeMarkdownOrderedLists, planOrderedListNormalization } from "../src/markdown-editor";

describe("planOrderedListNormalization", () => {
    it("只给出需要改写的编号片段", () => {
        const value = "1. 第一项\n3. 第二项";
        expect(planOrderedListNormalization(value)).toEqual([
            { start: value.indexOf("3."), end: value.indexOf("3.") + 1, text: "2" },
        ]);
    });

    it("没有需要改写的编号时返回空列表", () => {
        expect(planOrderedListNormalization("1. 第一项\n2. 第二项")).toEqual([]);
    });
});

describe("applyOrderedListNormalization", () => {
    it("就地改写编号并保留光标位置", () => {
        const textarea = document.createElement("textarea");
        textarea.value = "1. 第一项\n1. 第二项\n1. 第三项";
        const caret = textarea.value.indexOf("第三项");
        textarea.setSelectionRange(caret, caret);

        expect(applyOrderedListNormalization(textarea)).toBe("1. 第一项\n2. 第二项\n3. 第三项");
        expect(textarea.value).toBe("1. 第一项\n2. 第二项\n3. 第三项");
        expect(textarea.selectionStart).toBe(caret);
    });

    it("编号位数变化后光标仍贴着原来的文字", () => {
        const textarea = document.createElement("textarea");
        textarea.value = "8. 第一项\n12. 第二项";
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);

        const result = applyOrderedListNormalization(textarea);
        expect(result).toBe("8. 第一项\n9. 第二项");
        expect(textarea.value.slice(0, textarea.selectionStart)).toBe("8. 第一项\n9. 第二项");
    });

    it("无需改写时不触碰 DOM 选区", () => {
        const textarea = document.createElement("textarea");
        textarea.value = "1. 第一项\n2. 第二项";
        textarea.setSelectionRange(3, 6);

        expect(applyOrderedListNormalization(textarea)).toBe("1. 第一项\n2. 第二项");
        expect(textarea.selectionStart).toBe(3);
        expect(textarea.selectionEnd).toBe(6);
    });
});

describe("continueMarkdownList", () => {
    it("按顺序续写编号列表", () => {
        expect(continueMarkdownList("1. 测试", 5, 5)).toEqual({
            value: "1. 测试\n2. ",
            cursor: 9,
        });
        expect(continueMarkdownList("  9) 测试", 7, 7)).toEqual({
            value: "  9) 测试\n  10) ",
            cursor: 14,
        });
    });

    it("在编号列表中间插入时立即顺延后续同级编号", () => {
        const value = "1. 6 点起床\n2. 6:30 出发\n3. 7:00 到健身房开始";
        const cursor = value.indexOf("\n3.");

        expect(continueMarkdownList(value, cursor, cursor)?.value).toBe(
            "1. 6 点起床\n2. 6:30 出发\n3. \n4. 7:00 到健身房开始",
        );
    });

    it("顺延同级编号时跳过嵌套内容并在列表结束处停止", () => {
        const value = "1. 第一项\n2. 第二项\n   - 子项\n3. 第三项\n说明 4. 不应修改";
        const cursor = value.indexOf("\n   -");

        expect(continueMarkdownList(value, cursor, cursor)?.value).toBe(
            "1. 第一项\n2. 第二项\n3. \n   - 子项\n4. 第三项\n说明 4. 不应修改",
        );
    });

    it("续写项目符号和未完成任务列表", () => {
        expect(continueMarkdownList("- 第一项", 5, 5)?.value).toBe("- 第一项\n- ");
        expect(continueMarkdownList("- [x] 已处理", 9, 9)?.value).toBe("- [x] 已处理\n- [ ] ");
    });

    it("在空列表项上回车时退出列表", () => {
        expect(continueMarkdownList("1. 第一项\n2. ", 10, 10)).toEqual({
            value: "1. 第一项\n",
            cursor: 7,
        });
        expect(continueMarkdownList("- [ ] ", 6, 6)).toEqual({ value: "", cursor: 0 });
    });

    it("普通文本和选区保持浏览器默认行为", () => {
        expect(continueMarkdownList("普通文本", 4, 4)).toBeNull();
        expect(continueMarkdownList("1. 测试", 3, 5)).toBeNull();
    });
});

describe("normalizeMarkdownOrderedLists", () => {
    it("删除中间项目后立即补齐后续编号", () => {
        const value = "1. 6 点起床\n2. 6:30 出发\n3. 6:45 停车\n5. 7:00 开始";
        const cursor = value.indexOf("5.");

        expect(normalizeMarkdownOrderedLists(value, cursor, cursor)).toEqual({
            value: "1. 6 点起床\n2. 6:30 出发\n3. 6:45 停车\n4. 7:00 开始",
            selectionStart: cursor,
            selectionEnd: cursor,
        });
    });

    it("分别维护嵌套列表编号并保留列表的起始编号", () => {
        const value = "3. 外层一\n   1. 内层一\n   7. 内层二\n9. 外层二";
        const normalized = normalizeMarkdownOrderedLists(value, value.length, value.length);

        expect(normalized.value).toBe("3. 外层一\n   1. 内层一\n   2. 内层二\n4. 外层二");
        expect(normalized.selectionStart).toBe(normalized.value.length);
        expect(normalized.selectionEnd).toBe(normalized.value.length);
    });

    it("不跨越普通段落或空行重排其他列表", () => {
        const value = "1. 第一项\n4. 第二项\n说明文字\n8. 新列表\n\n5. 又一个列表";

        expect(normalizeMarkdownOrderedLists(value, 0, 0).value).toBe(
            "1. 第一项\n2. 第二项\n说明文字\n8. 新列表\n\n5. 又一个列表",
        );
    });

    it("编号位数变化时保持选区对应原来的文本位置", () => {
        const value = "8. 第一项\n12. 第二项";
        const selectionStart = value.indexOf("第二项");
        const normalized = normalizeMarkdownOrderedLists(value, selectionStart, value.length);

        expect(normalized.value).toBe("8. 第一项\n9. 第二项");
        expect(normalized.value.slice(normalized.selectionStart, normalized.selectionEnd)).toBe("第二项");
    });
});
