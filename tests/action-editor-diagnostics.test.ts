import { afterEach, describe, expect, it } from "vitest";

/**
 * 诊断模块靠原型挂钩记录现场，这里验证「装一次、只记行动编辑器、能导出」这三件事。
 * 模块内部有 installed 单例标记，所以整个文件只安装一次，用例之间只清空缓冲。
 */
import {
    actionEditorDiagnostics,
    clearActionEditorDiagnostics,
    formatActionEditorDiagnostics,
    installActionEditorDiagnostics,
    recordActionEditorEvent,
} from "../src/action-editor-diagnostics";

function editor(): HTMLTextAreaElement {
    const node = document.createElement("textarea");
    node.className = "b3-text-field xz-action-editor";
    node.setAttribute("aria-label", "本次行动细则");
    document.body.append(node);
    return node;
}

describe("action-editor-diagnostics", () => {
    installActionEditorDiagnostics();

    afterEach(() => {
        clearActionEditorDiagnostics();
        document.body.replaceChildren();
    });

    it("记录编辑框的 value 写入与选区设置", () => {
        const node = editor();
        clearActionEditorDiagnostics();
        node.value = "第一段内容";
        node.setSelectionRange(2, 2);
        const events = actionEditorDiagnostics().map((entry) => entry.event);
        expect(events).toContain("value 写入");
        expect(events).toContain("选区被设置");
        const write = actionEditorDiagnostics().find((entry) => entry.event === "value 写入");
        expect(write?.detail).toContain("新长度=5");
    });

    it("不记录普通 textarea 的写入", () => {
        const other = document.createElement("textarea");
        document.body.append(other);
        clearActionEditorDiagnostics();
        other.value = "不该出现";
        other.setSelectionRange(1, 1);
        expect(actionEditorDiagnostics()).toHaveLength(0);
    });

    it("记录编辑框挂载与卸载（用于判断是否被重新挂载）", async () => {
        clearActionEditorDiagnostics();
        const node = editor();
        await Promise.resolve();
        node.remove();
        await Promise.resolve();
        const events = actionEditorDiagnostics().map((entry) => entry.event);
        expect(events).toContain("编辑框挂载");
        expect(events).toContain("编辑框卸载");
    });

    it("导出为可读文本，清空后回到空状态", () => {
        recordActionEditorEvent("测试事件", "细节");
        const text = formatActionEditorDiagnostics();
        expect(text).toContain("测试事件");
        expect(text).toContain("细节");
        clearActionEditorDiagnostics();
        expect(formatActionEditorDiagnostics()).toContain("暂无记录");
    });
});
