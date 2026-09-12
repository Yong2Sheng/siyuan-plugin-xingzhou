import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import XingzhouApp from "../src/XingzhouApp.svelte";
import type { ActionImageCopyTarget } from "../src/image-clipboard";
import type { WorkItem, WorkItemData } from "../src/work-items";

const IMAGE_FIELDS = {
    title: { id: "title", name: "工作项", type: "block", options: [] },
    currentAction: { id: "current", name: "本次行动细则", type: "text", options: [] },
    nextAction: { id: "next", name: "下一步行动", type: "text", options: [] },
};

const ASSET = "assets/xz-aaaa1111bbbb.png";

function transactionItem(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "tx", rowId: "tx", title: "输入框没对齐", documentId: null, detached: true,
        type: "事务", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        planDate: null, deadline: null, noDeadline: false, durationMinutes: null, energy: "", updatedAt: Date.now(),
        ...overrides,
    };
}

/** 真实环境由思源提供全局 Lute；这里用只处理图片语法的最小桩，用于验证阅读态正文图。 */
function stubLute() {
    (globalThis as unknown as { Lute?: unknown }).Lute = {
        New: () => ({
            SetBlockRef() {}, SetGFMStrikethrough() {}, SetInlineMath() {}, SetSoftBreak2HardBreak() {}, SetTag() {},
            Md2HTML: (markdown: string) => markdown
                .split("\n")
                .filter((line: string) => line.trim().length > 0)
                .map((line: string) => {
                    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim());
                    if (image) return `<p><img src="${image[2]}" alt="${image[1]}"></p>`;
                    return `<p>${line}</p>`;
                })
                .join(""),
        }),
        Sanitize: (html: string) => html,
    };
}

/** 按真实浏览器顺序派发一次右键。 */
function rightClick(element: Element, x = 120, y = 160): MouseEvent {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
    element.dispatchEvent(event);
    return event;
}

describe("细则图片的右键复制入口", () => {
    let component: XingzhouApp | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
        delete (globalThis as unknown as { Lute?: unknown }).Lute;
        vi.unstubAllGlobals();
    });

    function mount(items: WorkItem[]) {
        const calls: Array<{ event: MouseEvent; image: ActionImageCopyTarget }> = [];
        const openImageMenu = vi.fn((event: MouseEvent, image: ActionImageCopyTarget) => {
            calls.push({ event, image });
        });
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue({
                    attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
                    items, missingFields: [], fields: IMAGE_FIELDS,
                } as WorkItemData),
                captureInbox: vi.fn(), saveItem: vi.fn(), deleteItem: vi.fn(), openDocument: vi.fn(),
                openImageMenu,
            },
        });
        return { openImageMenu, calls };
    }

    async function enterEditing() {
        await vi.waitFor(() => expect(document.querySelector(".xz-action-card")).not.toBeNull(), { timeout: 4000 });
        (document.querySelector(".xz-action-card") as HTMLElement).click();
        await vi.waitFor(() => expect(document.querySelector(".xz-action-editor")).not.toBeNull(), { timeout: 4000 });
    }

    it("编辑态右键缩略图把真实地址与尺寸交给菜单，并阻止默认菜单", async () => {
        const { openImageMenu, calls } = mount([transactionItem({ currentAction: `看这张截图\n![](${ASSET})` })]);
        await enterEditing();
        await vi.waitFor(() => expect(document.querySelector(".xz-action-thumb")).not.toBeNull(), { timeout: 4000 });

        const event = rightClick(document.querySelector(".xz-action-thumb") as HTMLImageElement);

        expect(event.defaultPrevented).toBe(true);
        expect(openImageMenu).toHaveBeenCalledOnce();
        expect(calls[0].image.src).toBe((document.querySelector(".xz-action-thumb") as HTMLImageElement).src);
        expect(calls[0].image.src).toContain(ASSET);
        expect(typeof calls[0].image.width).toBe("number");
        expect(typeof calls[0].image.height).toBe("number");
    });

    it("右键移除按钮或体积角标不弹菜单（只有图片本身算命中区）", async () => {
        const { openImageMenu } = mount([transactionItem({ currentAction: `![](${ASSET})` })]);
        await enterEditing();
        await vi.waitFor(() => expect(document.querySelector(".xz-action-thumb")).not.toBeNull(), { timeout: 4000 });

        rightClick(document.querySelector(".xz-action-images__remove") as HTMLElement);
        rightClick(document.querySelector(".xz-action-images__item small") as HTMLElement);
        rightClick(document.querySelector(".xz-action-images__item") as HTMLElement);

        expect(openImageMenu).not.toHaveBeenCalled();
    });

    it("阅读态右键正文图也能弹菜单", async () => {
        stubLute();
        const { openImageMenu, calls } = mount([transactionItem({ currentAction: `看这张截图\n![](${ASSET})` })]);
        await vi.waitFor(() => expect(document.querySelector(".xz-markdown-preview img")).not.toBeNull(), { timeout: 4000 });

        const event = rightClick(document.querySelector(".xz-markdown-preview img") as HTMLImageElement);

        expect(event.defaultPrevented).toBe(true);
        expect(openImageMenu).toHaveBeenCalledOnce();
        expect(calls[0].image.src).toContain(ASSET);
    });

    it("放大弹窗里的原图同样可右键复制", async () => {
        stubLute();
        const { openImageMenu, calls } = mount([transactionItem({ currentAction: `![](${ASSET})` })]);
        await vi.waitFor(() => expect(document.querySelector(".xz-markdown-preview img")).not.toBeNull(), { timeout: 4000 });

        (document.querySelector(".xz-markdown-preview img") as HTMLImageElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await tick();
        const preview = document.querySelector(".xz-action-image-preview img") as HTMLImageElement | null;
        expect(preview?.getAttribute("src")).toContain(ASSET);

        const event = rightClick(preview as HTMLImageElement);

        expect(event.defaultPrevented).toBe(true);
        expect(openImageMenu).toHaveBeenCalledOnce();
        expect(calls[0].image.src).toBe(preview?.src);
    });

    it("没有图片的条目上右键不触发图片菜单", async () => {
        const { openImageMenu } = mount([transactionItem({ currentAction: "只有文字，没有截图" })]);
        await vi.waitFor(() => expect(document.querySelector(".xz-action-card")).not.toBeNull(), { timeout: 4000 });

        rightClick(document.querySelector(".xz-detail") as HTMLElement);

        expect(openImageMenu).not.toHaveBeenCalled();
    });
});
