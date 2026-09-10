import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import XingzhouApp from "../src/XingzhouApp.svelte";
import type { WorkItem, WorkItemChanges, WorkItemData } from "../src/work-items";

type SaveFn = (currentData: WorkItemData, currentItem: WorkItem, changes: WorkItemChanges) => Promise<WorkItemData>;
type SaveCall = [WorkItemData, WorkItem, WorkItemChanges];
type UploadCall = { url: string; body: unknown };

function jsonResponse(payload: unknown, status = 200): Response {
    return { status, ok: status >= 200 && status < 300, json: async () => payload } as unknown as Response;
}

/** 保留 saveItem mock 的完整入参类型，便于断言写入的字段与目标条目。 */
function createSaveItem(): { fn: ReturnType<typeof vi.fn<SaveFn>>; calls: () => SaveCall[] } {
    const fn = vi.fn<SaveFn>(async (currentData, currentItem, changes) => ({
        ...currentData,
        items: currentData.items.map((entry) => (entry.id === currentItem.id ? { ...entry, ...changes } : entry)),
    }) as WorkItemData);
    return { fn, calls: () => fn.mock.calls as unknown as SaveCall[] };
}

const IMAGE_FIELDS = {
    title: { id: "title", name: "工作项", type: "block", options: [] },
    currentAction: { id: "current", name: "本次行动细则", type: "text", options: [] },
    nextAction: { id: "next", name: "下一步行动", type: "text", options: [] },
};

function transactionItem(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "tx", rowId: "tx", title: "上传按钮无反馈", documentId: null, detached: true,
        type: "事务", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        planDate: null, deadline: null, noDeadline: false, durationMinutes: null, energy: "", updatedAt: Date.now(),
        ...overrides,
    };
}

function imageFile(name = "截图.png", content = "clipboard-image-bytes"): File {
    return new File([new TextEncoder().encode(content)], name, { type: "image/png" });
}

/** 模拟浏览器粘贴：ClipboardEvent 在 jsdom 中不可构造，这里补上 clipboardData。 */
function pasteInto(target: HTMLElement, files: File[], text = ""): Event {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
        value: {
            items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
            files,
            types: files.length > 0 ? ["Files"] : ["text/plain"],
            getData: () => text,
        },
    });
    target.dispatchEvent(event);
    if (files.length === 0 && text) {
        const editor = target as HTMLTextAreaElement;
        editor.value = `${editor.value}${text}`;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return event;
}

function dragEvent(type: string, data: Record<string, unknown>): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: data });
    return event;
}

/** 按真实浏览器顺序派发一次按下+点击（mousedown → mouseup → click）。 */
function pressMouse(element: HTMLElement) {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function isEditing(): boolean {
    return document.querySelector(".xz-action-editor") !== null;
}

function snackbarTexts(): string[] {
    return [...document.querySelectorAll<HTMLElement>(".b3-snackbar")].map((node) => node.dataset.message ?? "");
}

function stubUpload(handler?: (call: UploadCall) => Response | Promise<Response>) {
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
        const call: UploadCall = { url: String(url), body: init.body };
        if (handler) return await handler(call);
        if (call.url.includes("/api/asset/statAsset")) return jsonResponse({ code: 0, msg: "", data: { size: 4096 } });
        const uploaded = (call.body as FormData).get("file[]") as File;
        return jsonResponse({ code: 0, msg: "", data: { succMap: { [uploaded.name]: `assets/${uploaded.name}` }, succFiles: [] } });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

/** 真实环境由思源提供全局 Lute；测试里提供只处理图片语法的最小桩，用于验证渲染态。 */
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
                    return `<p>${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</p>`;
                })
                .join(""),
        }),
        Sanitize: (html: string) => html,
    };
}

/** 让上传挂起，由测试决定何时完成，用于覆盖"上传中"与条目切换的时序。 */
function deferredUpload() {
    const state: { file: File | null; resolve: (() => void) | null } = { file: null, resolve: null };
    const promise = new Promise<Response>((resolve) => {
        state.resolve = () => {
            const uploaded = state.file;
            if (!uploaded) throw new Error("上传请求尚未发出");
            resolve(jsonResponse({ code: 0, msg: "", data: { succMap: { [uploaded.name]: `assets/${uploaded.name}` }, succFiles: [] } }));
        };
    });
    const handler = (call: UploadCall): Response | Promise<Response> => {
        if (call.url.includes("/api/asset/statAsset")) return jsonResponse({ code: 0, msg: "", data: { size: 1024 } });
        state.file = (call.body as FormData).get("file[]") as File;
        return promise;
    };
    return { state, handler, release: () => state.resolve?.() };
}

function savedAction(call: SaveCall | undefined): string {
    const value = call?.[2].currentAction;
    return typeof value === "string" ? value : "";
}

describe("行动细则的图片支持", () => {
    let component: XingzhouApp | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
        delete (globalThis as unknown as { Lute?: unknown }).Lute;
        vi.unstubAllGlobals();
    });

    function mount(items: WorkItem[], saveItem: ReturnType<typeof createSaveItem>["fn"]) {
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue({
                    attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
                    items, missingFields: [], fields: IMAGE_FIELDS,
                }),
                captureInbox: vi.fn(), saveItem, deleteItem: vi.fn(), openDocument: vi.fn(),
            },
        });
    }

    async function enterEditing() {
        await vi.waitFor(() => expect(document.querySelector(".xz-action-card")).not.toBeNull(), { timeout: 4000 });
        (document.querySelector(".xz-action-card") as HTMLElement).click();
        await vi.waitFor(() => expect(document.querySelector(".xz-action-editor")).not.toBeNull(), { timeout: 4000 });
        return document.querySelector(".xz-action-editor") as HTMLTextAreaElement;
    }

    async function selectTreeItem(title: string) {
        await vi.waitFor(() => expect(document.querySelectorAll(".xz-tree-row").length).toBeGreaterThan(0), { timeout: 4000 });
        [...document.querySelectorAll<HTMLElement>(".xz-tree-row")]
            .find((row) => row.textContent?.includes(title))
            ?.querySelector<HTMLElement>(".xz-tree-main")
            ?.click();
        await vi.waitFor(() => expect((document.querySelector('.xz-detail input[aria-label="名称"]') as HTMLInputElement)?.value).toBe(title), { timeout: 4000 });
    }

    it("粘贴截图后上传到资源库、插入 Markdown 并保存到条目", async () => {
        const save = createSaveItem();
        const fetchMock = stubUpload();
        mount([transactionItem()], save.fn);
        const editor = await enterEditing();

        const event = pasteInto(editor, [imageFile()]);
        expect(event.defaultPrevented).toBe(true);

        await vi.waitFor(() => expect(save.fn).toHaveBeenCalled(), { timeout: 4000 });
        const stored = savedAction(save.calls().at(-1));
        expect(stored).toMatch(/^!\[\]\(assets\/xz-[0-9a-f]{12}\.png\)$/);
        expect(stored).not.toContain("xz-upload://");

        const uploadCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/asset/upload"));
        expect(uploadCall).toBeTruthy();
        const form = uploadCall?.[1]?.body as FormData;
        expect(form.get("assetsDirPath")).toBe("assets");
        expect((form.get("file[]") as File).name).toBe(stored.replace(/^!\[\]\(assets\//, "").replace(/\)$/, ""));
    });

    it("一次粘贴多张图片时按顺序各占一行", async () => {
        const save = createSaveItem();
        stubUpload();
        mount([transactionItem()], save.fn);
        const editor = await enterEditing();

        pasteInto(editor, [imageFile("a.png", "bytes-a"), imageFile("b.png", "bytes-b")]);

        await vi.waitFor(() => expect(save.fn).toHaveBeenCalled(), { timeout: 4000 });
        const stored = savedAction(save.calls().at(-1));
        const lines = stored.split("\n");
        expect(lines).toHaveLength(2);
        expect(lines.every((line: string) => /^!\[\]\(assets\/xz-[0-9a-f]{12}\.png\)$/.test(line))).toBe(true);
        expect(new Set(lines).size).toBe(2);
    });

    it("上传失败时移除占位符、提示错误，且不会把占位符写进条目", async () => {
        stubUpload((call) => {
            if (call.url.includes("/api/asset/statAsset")) return jsonResponse({ code: 0, msg: "", data: { size: 1 } });
            return jsonResponse({ code: -1, msg: "Path is not in workspace", data: null });
        });
        const save = createSaveItem();
        mount([transactionItem()], save.fn);
        const editor = await enterEditing();

        pasteInto(editor, [imageFile("bad.png", "bad-bytes")]);

        await vi.waitFor(() => expect(document.querySelector(".xz-action-error")?.textContent).toContain("Path is not in workspace"), { timeout: 4000 });
        expect((document.querySelector(".xz-action-editor") as HTMLTextAreaElement).value).toBe("");
        expect(document.querySelectorAll(".xz-action-images__item")).toHaveLength(0);
        for (const call of save.calls()) {
            expect(savedAction(call)).not.toContain("xz-upload://");
        }
    });

    it("纯文字粘贴不拦截，仍按普通输入处理", async () => {
        stubUpload();
        mount([transactionItem()], createSaveItem().fn);
        const editor = await enterEditing();

        const text = "上传按钮点完之后没有任何反馈。";
        const event = pasteInto(editor, [], text);
        expect(event.defaultPrevented).toBe(false);
        await vi.waitFor(() => expect((document.querySelector(".xz-action-editor") as HTMLTextAreaElement).value).toBe(text), { timeout: 4000 });
    });

    it("拖入图片文件即可插入，拖拽结束后移除高亮", async () => {
        const save = createSaveItem();
        stubUpload();
        mount([transactionItem()], save.fn);
        await enterEditing();

        const card = document.querySelector(".xz-action-card") as HTMLElement;
        const image = imageFile("drop.png", "dropped-bytes");
        card.dispatchEvent(dragEvent("dragover", { types: ["Files"], dropEffect: "" }));
        await tick();
        expect(document.querySelector(".xz-action-card--drop")).not.toBeNull();
        expect(document.querySelector(".xz-action-hint--drop")).not.toBeNull();

        card.dispatchEvent(dragEvent("drop", { types: ["Files"], files: [image], items: [{ kind: "file", type: image.type, getAsFile: () => image }] }));
        await vi.waitFor(() => expect(save.fn).toHaveBeenCalled(), { timeout: 4000 });
        expect(savedAction(save.calls().at(-1))).toMatch(/^!\[\]\(assets\/xz-/);
        expect(document.querySelector(".xz-action-card--drop")).toBeNull();
    });

    it("上传完成前不写入条目，完成后才落到内容里", async () => {
        const deferred = deferredUpload();
        stubUpload(deferred.handler);
        const save = createSaveItem();
        mount([transactionItem()], save.fn);
        const editor = await enterEditing();

        pasteInto(editor, [imageFile("pending.png", "pending-bytes")]);
        await vi.waitFor(() => expect(deferred.state.file).not.toBeNull(), { timeout: 4000 });
        await vi.waitFor(() => expect((document.querySelector(".xz-action-editor") as HTMLTextAreaElement).value).toContain("xz-upload://"), { timeout: 4000 });
        for (const call of save.calls()) {
            expect(savedAction(call)).not.toContain("xz-upload://");
        }

        deferred.release();
        await vi.waitFor(() => expect(save.fn).toHaveBeenCalled(), { timeout: 4000 });
        expect(savedAction(save.calls().at(-1))).toMatch(/^!\[\]\(assets\/xz-[0-9a-f]{12}\.png\)$/);
    });

    it("编辑态里的辅助按钮不会因为失焦而退出编辑", async () => {
        stubUpload();
        mount([transactionItem({ currentAction: "先写下这一条\n![](assets/xz-aaaa1111bbbb.png)" })], createSaveItem().fn);
        const editor = await enterEditing();

        const help = [...document.querySelectorAll<HTMLButtonElement>(".xz-action-summary button")]
            .find((button) => button.textContent?.includes("如何插入图片"));
        expect(help, "编辑态应显示插入提示按钮").toBeTruthy();
        pressMouse(help!);

        await tick();
        expect(isEditing()).toBe(true);
        expect((document.querySelector(".xz-action-editor") as HTMLTextAreaElement).value).toBe(editor.value);
        expect(snackbarTexts().some((message) => message.includes("粘贴截图"))).toBe(true);
    });

    it("移除缩略图后仍停留在编辑态", async () => {
        const save = createSaveItem();
        stubUpload();
        mount([transactionItem()], save.fn);
        await enterEditing();

        pasteInto(document.querySelector(".xz-action-editor") as HTMLTextAreaElement, [imageFile("keep.png", "keep-bytes")]);
        await vi.waitFor(() => expect(save.fn).toHaveBeenCalled(), { timeout: 4000 });

        (document.querySelector(".xz-action-card") as HTMLElement).click();
        await vi.waitFor(() => expect(document.querySelector(".xz-action-thumb")).not.toBeNull(), { timeout: 4000 });

        pressMouse(document.querySelector(".xz-action-images__remove") as HTMLElement);
        await tick();
        expect(isEditing()).toBe(true);
        expect(document.querySelector(".xz-action-thumb")).toBeNull();
    });

    it("阅读态点击图片可打开原图预览", async () => {        stubLute();
        mount([transactionItem({ currentAction: "看这张截图\n![](assets/xz-aaaa1111bbbb.png)" })], createSaveItem().fn);
        await vi.waitFor(() => expect(document.querySelector(".xz-markdown-preview img")).not.toBeNull(), { timeout: 4000 });

        (document.querySelector(".xz-markdown-preview img") as HTMLImageElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await tick();
        const preview = document.querySelector(".xz-action-image-preview img") as HTMLImageElement | null;
        expect(preview?.getAttribute("src")).toContain("assets/xz-aaaa1111bbbb.png");
    });

    it("上传未完成时切换条目：结果不会写进切换后的条目", async () => {
        const deferred = deferredUpload();
        stubUpload(deferred.handler);
        const save = createSaveItem();
        const first = transactionItem({ id: "tx-1", rowId: "tx-1", title: "第一条" });
        const second = transactionItem({ id: "tx-2", rowId: "tx-2", title: "第二条" });
        mount([first, second], save.fn);

        await selectTreeItem("第一条");
        (document.querySelector(".xz-action-card") as HTMLElement).click();
        await vi.waitFor(() => expect(document.querySelector(".xz-action-editor")).not.toBeNull(), { timeout: 4000 });

        pasteInto(document.querySelector(".xz-action-editor") as HTMLTextAreaElement, [imageFile("late.png", "late-bytes")]);
        await vi.waitFor(() => expect(deferred.state.file).not.toBeNull(), { timeout: 4000 });

        await selectTreeItem("第二条");
        deferred.release();
        await new Promise((resolve) => setTimeout(resolve, 80));

        expect(document.querySelectorAll(".xz-action-thumb")).toHaveLength(0);
        const wrongTarget = save.calls().filter((call) => call[1].id === "tx-2" && savedAction(call).includes("assets/"));
        expect(wrongTarget).toHaveLength(0);
    });
});

/** 未引用资源接口的替身：只有列在 unused 里的图片才允许删除。 */
function stubUnusedAssets(unused: string[], failures: Record<string, string> = {}) {
    const removed: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
        const target = String(url);
        if (target.includes("/api/asset/getUnusedAssets")) {
            return jsonResponse({ code: 0, msg: "", data: unused.map((item) => ({ item })) });
        }
        if (target.includes("/api/asset/removeUnusedAsset")) {
            const path = JSON.parse(String(init.body)).path as string;
            const failure = failures[path];
            if (failure) return jsonResponse({ code: -1, msg: failure, data: null });
            removed.push(path);
            return jsonResponse({ code: 0, msg: "", data: { path } });
        }
        return jsonResponse({ code: -1, msg: `unexpected ${target}`, data: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    return { removed };
}

describe("图片待清理与确认删除", () => {
    let component: XingzhouApp | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
        vi.unstubAllGlobals();
    });

    function mount(items: WorkItem[], saveItem: ReturnType<typeof createSaveItem>["fn"], selectedId?: string) {
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue({
                    attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
                    items, missingFields: [], fields: IMAGE_FIELDS,
                }),
                captureInbox: vi.fn(), saveItem, deleteItem: vi.fn(), openDocument: vi.fn(),
                initialViewState: {
                    page: "all", filter: "all", includeClosed: true, scope: "all",
                    selectedId: selectedId ?? items[0]?.id ?? null,
                    expandedIds: [], weekStart: Date.now(), sidebarScrollTop: 0, treeScrollTop: 0, detailScrollTop: 0,
                },
            },
        });
    }

    async function openCleanupPage() {
        // 已在清理页时不要重复点击（该页没有工具栏入口，只有"返回"）
        if (document.querySelector(".xz-cleanup-page")) return;
        await vi.waitFor(() => expect(document.querySelector(".xz-cleanup-entry")).not.toBeNull(), { timeout: 4000 });
        (document.querySelector(".xz-cleanup-entry") as HTMLButtonElement).click();
        await vi.waitFor(() => expect(document.querySelector(".xz-cleanup-page")).not.toBeNull(), { timeout: 4000 });
    }

    /** 清理页 → 点该条目的「现在清理」→ 进入页内确认步骤（第 2 步） */
    async function openManagerAndConfirmFirstEntry() {
        await openCleanupPage();
        const first = [...document.querySelectorAll<HTMLButtonElement>(".xz-cleanup-page__item button")]
            .find((button) => button.textContent?.includes("清理"));
        expect(first, "清理页应有该条目的清理按钮").toBeTruthy();
        first!.click();
        await vi.waitFor(() => expect(document.querySelector(".xz-cleanup-confirm-list")).not.toBeNull(), { timeout: 4000 });
    }

    function confirmButton(): HTMLButtonElement {
        return [...document.querySelectorAll<HTMLButtonElement>(".xz-cleanup-page__actions button")]
            .find((button) => button.textContent?.includes("确认删除")) as HTMLButtonElement;
    }

    it("取消勾选后可以再勾上；点图片本身也能切换勾选", async () => {
        const save = createSaveItem();
        const done = transactionItem({
            id: "tx-toggle", status: "已完成", currentAction: "两张\n![](assets/xz-a.png)\n![](assets/xz-b.png)",
            imageCleanup: { startedAt: Date.now(), paths: ["assets/xz-a.png", "assets/xz-b.png"] },
        });
        mount([done], save.fn);
        await openManagerAndConfirmFirstEntry();

        const firstBox = () => document.querySelector<HTMLInputElement>(".xz-cleanup-pick input")!;
        expect(firstBox().checked).toBe(true);
        expect(confirmButton().textContent).toContain("确认删除 2 张");

        // 取消勾选 → 计数减少，且复选框确实处于未选状态
        firstBox().checked = false;
        firstBox().dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(firstBox().checked).toBe(false);
        expect(confirmButton().textContent).toContain("确认删除 1 张");

        // 再次勾上 → 应能恢复（这是之前取消后无法再选中的 bug）
        firstBox().checked = true;
        firstBox().dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(firstBox().checked).toBe(true);
        expect(confirmButton().textContent).toContain("确认删除 2 张");

        // 点图片本身也能取消
        (document.querySelector(".xz-cleanup-pick__image") as HTMLButtonElement).click();
        await tick();
        expect(firstBox().checked).toBe(false);
        expect(confirmButton().textContent).toContain("确认删除 1 张");

        // 取消后复选框必须仍然可用（之前会被误标成"不可删除"而禁用）
        expect(firstBox().disabled).toBe(false);
        (document.querySelector(".xz-cleanup-pick__image") as HTMLButtonElement).click();
        await tick();
        expect(firstBox().checked).toBe(true);
        expect(confirmButton().textContent).toContain("确认删除 2 张");

        // 勾选框独立在图片上方（不是叠在图上）
        const check = document.querySelector(".xz-cleanup-pick__check") as HTMLElement;
        const image = document.querySelector(".xz-cleanup-pick__image") as HTMLElement;
        expect(check).not.toBeNull();
        expect(image).not.toBeNull();
        expect(check.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("取消勾选某张图后，它不进入删除范围", async () => {
        const save = createSaveItem();
        const done = transactionItem({
            id: "tx-skip", status: "已完成", currentAction: "两张\n![](assets/xz-a.png)\n![](assets/xz-b.png)",
            imageCleanup: { startedAt: Date.now(), paths: ["assets/xz-a.png", "assets/xz-b.png"] },
        });
        const { removed } = stubUnusedAssets(["assets/xz-a.png", "assets/xz-b.png"]);
        mount([done], save.fn);
        await openManagerAndConfirmFirstEntry();

        const boxes = [...document.querySelectorAll<HTMLInputElement>(".xz-cleanup-pick input")];
        expect(boxes).toHaveLength(2);
        boxes[1].checked = false;
        boxes[1].dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(confirmButton().textContent).toContain("确认删除 1 张");

        confirmButton().click();
        await vi.waitFor(() => expect(removed).toEqual(["assets/xz-a.png"]), { timeout: 4000 });
        const lastAction = savedAction(save.calls().at(-1));
        expect(lastAction).toContain("xz-b.png");
        expect(lastAction).not.toContain("xz-a.png");
    });

    it("工具栏入口显示待清理数量，点开列出条目与倒计时", async () => {
        const done = transactionItem({
            id: "tx-3", status: "已完成", currentAction: "看这张\n![](assets/xz-a.png)",
            imageCleanup: { startedAt: Date.now() - 2 * 24 * 60 * 60 * 1000, paths: ["assets/xz-a.png"] },
        });
        mount([done], createSaveItem().fn);

        await vi.waitFor(() => expect(document.querySelector(".xz-cleanup-badge")).not.toBeNull(), { timeout: 4000 });
        expect(document.querySelector(".xz-cleanup-badge")?.textContent).toContain("图片待清理 · 还剩 5 天");

        const entry = document.querySelector(".xz-cleanup-entry") as HTMLButtonElement;
        expect(entry).not.toBeNull();
        expect(entry.querySelector(".xz-cleanup-entry__label")?.textContent).toContain("清理图片");
        expect(entry.querySelector(".xz-cleanup-entry__count")?.textContent).toBe("1");
        expect(entry.classList.contains("xz-cleanup-entry--idle")).toBe(false);

        entry.click();
        await vi.waitFor(() => expect(document.querySelector(".xz-cleanup-page")).not.toBeNull(), { timeout: 4000 });
        const page = document.querySelector(".xz-cleanup-page")!;
        expect(page.textContent).toContain("上传按钮无反馈");
        expect(page.textContent).toContain("还剩 5 天");
        expect(page.textContent).toContain("1 张图片");
        expect(page.querySelector(".xz-cleanup-page__item")).not.toBeNull();
        expect(page.querySelector(".xz-cleanup-page__thumb img")).not.toBeNull();
        expect(page.querySelector(".xz-cleanup-page__item button")).not.toBeNull();
        expect(page.querySelector(".xz-cleanup-page__summary")?.textContent).toContain("1");
    });

    it("图片仍被未结束条目引用时：列出来并标注原因、不可勾选", async () => {
        const save = createSaveItem();
        const done = transactionItem({
            id: "tx-done", rowId: "tx-done", title: "已完成的那条", status: "已完成",
            currentAction: "看这张\n![](assets/xz-shared.png)",
            imageCleanup: { startedAt: Date.now(), paths: ["assets/xz-shared.png"] },
        });
        const active = transactionItem({
            id: "tx-active", rowId: "tx-active", title: "还在做的那条", status: "待开始",
            currentAction: "同一个图\n![](assets/xz-shared.png)",
        });
        mount([done, active], save.fn);
        await openCleanupPage();
        await openManagerAndConfirmFirstEntry();

        expect(document.querySelectorAll(".xz-cleanup-pick")).toHaveLength(1);
        const pick = document.querySelector(".xz-cleanup-pick") as HTMLElement;
        expect(pick.classList.contains("xz-cleanup-pick--kept")).toBe(true);
        expect(pick.textContent).toContain("还在做的那条");
        expect((pick.querySelector("input") as HTMLInputElement).disabled).toBe(true);
        // 没有可删图片 → 确认按钮禁用并提示
        expect(confirmButton().disabled).toBe(true);
        expect(document.querySelector(".xz-cleanup-confirm-item__meta")?.textContent).toContain("0 / 1 张可删除");
    });

    it("没有待清理图片时入口显示 0，点开是空状态说明", async () => {
        mount([transactionItem({ id: "tx-idle", status: "已完成", currentAction: "只有文字" })], createSaveItem().fn);
        await vi.waitFor(() => expect(document.querySelector(".xz-cleanup-entry")).not.toBeNull(), { timeout: 4000 });

        const entry = document.querySelector(".xz-cleanup-entry") as HTMLButtonElement;
        expect(entry.querySelector(".xz-cleanup-entry__count")?.textContent).toBe("0");
        expect(entry.classList.contains("xz-cleanup-entry--idle")).toBe(true);

        entry.click();
        await vi.waitFor(() => expect(document.querySelector(".xz-cleanup-page")).not.toBeNull(), { timeout: 4000 });
        expect(document.querySelector(".xz-cleanup-page__empty")?.textContent).toContain("当前没有需要清理的图片");
        expect(document.querySelector(".xz-cleanup-page__list")).toBeNull();
        expect(document.querySelector(".xz-cleanup-page__empty-icon")).not.toBeNull();
    });

    it("页内确认并清理：摘掉引用、删除未引用图片、登记清除", async () => {
        const save = createSaveItem();
        const done = transactionItem({
            id: "tx-4", status: "已完成", currentAction: "看这张\n![](assets/xz-a.png)",
            imageCleanup: { startedAt: Date.now(), paths: ["assets/xz-a.png"] },
        });
        const { removed } = stubUnusedAssets(["assets/xz-a.png"]);
        mount([done], save.fn);

        await openManagerAndConfirmFirstEntry();
        const confirm = confirmButton();
        expect(confirm.textContent).toContain("确认删除 1 张");
        expect(document.querySelector(".xz-cleanup-page__note")?.textContent).toContain("本次将删除");
        confirm.click();

        await vi.waitFor(() => expect(removed).toEqual(["assets/xz-a.png"]), { timeout: 4000 });
        const savedActions = save.calls().map((call) => savedAction(call));
        expect(savedActions).toContain("看这张");
        expect(savedActions.some((value) => value.includes("![](assets/xz-a.png)"))).toBe(false);
        expect(save.calls().some((call) => (call[2] as WorkItemChanges).imageCleanup === null)).toBe(true);
        await vi.waitFor(() => expect(document.querySelector(".xz-cleanup-page__done")).not.toBeNull(), { timeout: 4000 });
        expect(document.querySelector(".xz-cleanup-page__done")?.textContent).toContain("清理完成");
    });

    it("思源认为仍被引用的图片不会被删除，只摘掉行舟的引用", async () => {
        const save = createSaveItem();
        const done = transactionItem({
            id: "tx-5", status: "已完成", currentAction: "看这张\n![](assets/xz-a.png)",
            imageCleanup: { startedAt: Date.now(), paths: ["assets/xz-a.png"] },
        });
        const { removed } = stubUnusedAssets([]);
        mount([done], save.fn);

        await openManagerAndConfirmFirstEntry();
        // 思源认为这张仍被引用：可以勾选、可以点确认，但真正删除时会被跳过
        expect(document.querySelectorAll(".xz-cleanup-pick")).toHaveLength(1);
        expect(confirmButton().disabled).toBe(false);
        confirmButton().click();

        await vi.waitFor(() => expect(document.querySelector(".xz-cleanup-page__done")).not.toBeNull(), { timeout: 4000 });
        expect(removed).toEqual([]);
        expect(document.querySelector(".xz-cleanup-page__done")?.textContent).toContain("保留 1 张");
        expect(savedAction(save.calls().at(-1))).not.toContain("xz-a.png");
    });

    it("把条目从终态改回进行中：登记自动清除，角标与入口计数归零", async () => {
        const save = createSaveItem();
        const done = transactionItem({
            id: "tx-6", status: "已完成", currentAction: "看这张\n![](assets/xz-a.png)",
            imageCleanup: { startedAt: Date.now(), paths: ["assets/xz-a.png"] },
        });
        mount([done], save.fn);

        await vi.waitFor(() => expect(document.querySelector(".xz-meta-status-select")).not.toBeNull(), { timeout: 4000 });
        const statusSelect = document.querySelector(".xz-meta-status-select") as HTMLSelectElement;
        statusSelect.value = "进行中";
        statusSelect.dispatchEvent(new Event("change", { bubbles: true }));

        await vi.waitFor(() => expect(save.fn).toHaveBeenCalled(), { timeout: 4000 });
        expect((save.calls().at(-1)?.[2] as WorkItemChanges).imageCleanup).toBeNull();
        await vi.waitFor(() => expect(document.querySelector(".xz-cleanup-badge")).toBeNull(), { timeout: 4000 });
        expect(document.querySelector(".xz-cleanup-entry__count")?.textContent).toBe("0");
    });

    it("未登记的已结束条目不显示任何清理入口", async () => {
        const done = transactionItem({ id: "tx-7", status: "已完成", currentAction: "只有文字" });
        mount([done], createSaveItem().fn);
        await vi.waitFor(() => expect(document.querySelector(".xz-action-card")).not.toBeNull(), { timeout: 4000 });
        expect(document.querySelector(".xz-cleanup-badge")).toBeNull();
        expect(document.querySelector(".xz-cleanup-panel")).toBeNull();
    });
});
