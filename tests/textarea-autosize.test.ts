import { afterEach, describe, expect, it, vi } from "vitest";
import { autoResizeTextarea } from "../src/textarea-autosize";

describe("autoResizeTextarea", () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it("挂载时立即按完整内容高度展开", () => {
        const textarea = document.createElement("textarea");
        textarea.style.minHeight = "96px";
        Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => 238 });
        document.body.append(textarea);

        const action = autoResizeTextarea(textarea);
        expect(textarea.style.height).toBe("238px");
        action.destroy();
    });

    it("内容输入后重新测量并在销毁时解绑", () => {
        const textarea = document.createElement("textarea");
        textarea.style.minHeight = "96px";
        let scrollHeight = 120;
        Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => scrollHeight });
        document.body.append(textarea);
        const removeEventListener = vi.spyOn(textarea, "removeEventListener");

        const action = autoResizeTextarea(textarea);
        scrollHeight = 310;
        textarea.dispatchEvent(new Event("input"));
        expect(textarea.style.height).toBe("310px");

        action.destroy();
        expect(removeEventListener).toHaveBeenCalledWith("input", expect.any(Function));
    });
});
