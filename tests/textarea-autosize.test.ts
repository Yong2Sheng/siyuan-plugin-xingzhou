import { afterEach, describe, expect, it, vi } from "vitest";
import { autoResizeTextarea } from "../src/textarea-autosize";

describe("autoResizeTextarea", () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    // 说明：高度会额外 +2px 余量，避免 clientHeight 比 scrollHeight 少 1–2px，
    // 那会让浏览器每次输入都"跟随光标"滚一点点（用户看到的是被拉到可见区底部）。
    it("挂载时立即按完整内容高度展开", () => {
        const textarea = document.createElement("textarea");
        textarea.style.minHeight = "96px";
        Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => 238 });
        Object.defineProperty(textarea, "clientHeight", { configurable: true, get: () => 238 });
        document.body.append(textarea);

        const action = autoResizeTextarea(textarea);
        expect(textarea.style.height).toBe("242px");
        action.destroy();
    });

    it("内容输入后同步重新测量（不拖到下一帧），并在销毁时解绑", () => {
        const textarea = document.createElement("textarea");
        textarea.style.minHeight = "96px";
        let scrollHeight = 120;
        Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => scrollHeight });
        document.body.append(textarea);
        const removeEventListener = vi.spyOn(textarea, "removeEventListener");

        const action = autoResizeTextarea(textarea);
        scrollHeight = 310;
        textarea.dispatchEvent(new Event("input"));
        // 同步完成：测量若被推迟到下一帧，用户正好在这一帧点击就会点到塌陷后的位置
        expect(textarea.style.height).toBe("314px");

        action.destroy();
        expect(removeEventListener).toHaveBeenCalledWith("input", expect.any(Function));
    });

    it("测量会还原外层滚动容器位置（编辑框自身内部滚动一律归零）", () => {
        const panel = document.createElement("div");
        const textarea = document.createElement("textarea");
        textarea.style.minHeight = "96px";
        Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => 1200 });
        panel.append(textarea);
        document.body.append(panel);

        // 模拟浏览器行为：高度塌成 auto 时两处滚动都会被重置到 0，恢复高度后才不会自动复原
        let internalTop = 400;
        let panelTop = 900;
        Object.defineProperty(textarea, "scrollTop", {
            configurable: true,
            get: () => internalTop,
            set: (value: number) => { internalTop = textarea.style.height === "auto" ? 0 : value; },
        });
        Object.defineProperty(panel, "scrollTop", {
            configurable: true,
            get: () => panelTop,
            set: (value: number) => { panelTop = textarea.style.height === "auto" ? 0 : value; },
        });

        const action = autoResizeTextarea(textarea);
        expect(textarea.style.height).toBe("1204px");
        // 编辑框内部不允许滚动（高度已等于内容高度）
        expect(textarea.scrollTop).toBe(0);
        // 外层容器的位置必须原样保留
        expect(panel.scrollTop).toBe(900);
        action.destroy();
    });

    it("任何内部滚动都会被立即归零", () => {
        const textarea = document.createElement("textarea");
        textarea.style.minHeight = "96px";
        Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => 900 });
        document.body.append(textarea);

        const action = autoResizeTextarea(textarea);
        textarea.scrollTop = 120;
        textarea.dispatchEvent(new Event("scroll"));
        expect(textarea.scrollTop).toBe(0);
        action.destroy();
    });

    it("长文完整展开，不设高度上限（与阅读态一致，内部不滚动）", () => {
        const textarea = document.createElement("textarea");
        textarea.style.minHeight = "96px";
        // 即便样式里残留 max-height，也不能把内容截成内部滚动
        textarea.style.maxHeight = "560px";
        Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => 2400 });
        document.body.append(textarea);

        const action = autoResizeTextarea(textarea);
        expect(textarea.style.height).toBe("2404px");
        action.destroy();
    });
});
