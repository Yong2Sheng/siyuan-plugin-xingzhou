import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("siyuan", () => ({
    Dialog: class FakeDialog {
        element: HTMLElement;
        private readonly destroyCallback?: () => void;

        constructor(options: { content: string; destroyCallback?: () => void }) {
            this.element = document.createElement("div");
            this.element.innerHTML = options.content;
            this.destroyCallback = options.destroyCallback;
            document.body.append(this.element);
        }

        destroy(): void {
            this.element.remove();
            this.destroyCallback?.();
        }
    },
}));

import { showCaptureDialog } from "../src/capture-dialog";

describe("原生新增窗口", () => {
    afterEach(() => document.body.replaceChildren());

    it("把顶层项目显示为层级角色，而不是无意义的项目下拉框", async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        showCaptureDialog({
            mode: "topProject",
            areas: [{ id: "area", title: "写小说", type: "长期领域" }],
            onSubmit,
        });

        expect(document.body.textContent).toContain("顶层项目（数据库类型：项目）");
        expect(document.querySelector('[data-row="type"]')?.classList.contains("fn__none")).toBe(true);

        const title = document.querySelector<HTMLInputElement>('[data-field="title"]')!;
        const area = document.querySelector<HTMLSelectElement>('[data-field="area"]')!;
        title.value = "完成第一卷";
        area.value = "area";
        document.querySelector<HTMLFormElement>(".xz-native-capture-form")!
            .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

        await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
            title: "完成第一卷",
            type: undefined,
            areaId: "area",
        }));
    });
});
