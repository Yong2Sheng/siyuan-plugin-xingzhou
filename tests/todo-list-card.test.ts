import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import TodoListCard from "../src/TodoListCard.svelte";
import { createEmptyActionDetail } from "../src/action-detail";
import { createTodo, type Todo } from "../src/todos";

const NOW = new Date("2026-09-21T10:00:00").getTime();

function buildTodos(): Todo[] {
    return [
        createTodo("整理 3.8.3 的变更清单", NOW, "todo-1"),
        { ...createTodo("把结构化字段接进解析器", NOW + 1, "todo-2"), status: "done", completedOn: "2026-09-21" },
        { ...createTodo("给待办做拖拽排序", NOW + 2, "todo-3"), status: "dropped", droppedReason: "用不到" },
    ];
}

describe("待办清单卡", () => {
    let component: TodoListCard | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    function mount(todos: Todo[] = buildTodos()) {
        const handlers = {
            add: vi.fn(),
            text: vi.fn(),
            detail: vi.fn(),
            done: vi.fn(),
            dropped: vi.fn(),
            restore: vi.fn(),
            remove: vi.fn(),
            today: vi.fn(),
        };
        component = new TodoListCard({ target: document.body, props: { todos } });
        component.$on("add", (event) => handlers.add(event.detail));
        component.$on("text", (event) => handlers.text(event.detail));
        component.$on("detail", (event) => handlers.detail(event.detail));
        component.$on("done", (event) => handlers.done(event.detail));
        component.$on("dropped", (event) => handlers.dropped(event.detail));
        component.$on("restore", (event) => handlers.restore(event.detail));
        component.$on("remove", (event) => handlers.remove(event.detail));
        component.$on("today", (event) => handlers.today(event.detail));
        return handlers;
    }

    it("进度分母不含放弃项，并显示三条状态各自的计数", async () => {
        mount();
        await tick();
        expect(document.querySelector(".xz-todo-card__count")?.textContent).toContain("3 条");
        expect(document.querySelector(".xz-todo-card__count")?.textContent).toContain("未完成 1");
        expect(document.querySelector(".xz-todo-progress")?.textContent).toContain("已完成 1/2");
        expect(document.querySelector(".xz-todo-progress")?.textContent).toContain("（放弃项不计入分母）");
    });

    it("勾选＝完成、打叉＝放弃、恢复保留在同一行", async () => {
        const handlers = mount();
        await tick();

        const box = document.querySelector<HTMLButtonElement>('[aria-label^="标记完成"]')!;
        box.click();
        expect(handlers.done).toHaveBeenCalledWith({ id: "todo-1" });

        const drop = document.querySelector<HTMLButtonElement>('[aria-label^="放弃："]')!;
        drop.click();
        expect(handlers.dropped).toHaveBeenCalledWith({ id: "todo-1" });

        // 已放弃的条目默认隐藏，点「显示已放弃」后才出现，且带「恢复」
        clickByText(".xz-todo-card__link", "显示已放弃");
        await tick();
        const restore = [...document.querySelectorAll<HTMLButtonElement>(".xz-todo__link")].find((button) => button.textContent?.trim() === "恢复")!;
        restore.click();
        expect(handlers.restore).toHaveBeenCalledWith({ id: "todo-3" });
    });

    it("追加待办：回车提交，粘贴多行一次生成多条", async () => {
        const handlers = mount();
        await tick();
        const draft = document.querySelector<HTMLInputElement>("#xz-todo-draft")!;
        draft.value = "第一条";
        draft.dispatchEvent(new Event("input", { bubbles: true }));
        draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(handlers.add).toHaveBeenCalledWith({ text: "第一条" });

        // 粘贴多行：jsdom 的 input 不接受换行，直接按用户粘贴的结果触发 input 事件
        draft.value = "第二条\n第三条";
        draft.dispatchEvent(new InputEvent("input", { bubbles: true, data: "第二条\n第三条", inputType: "insertFromPaste" }));
        draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(handlers.add).toHaveBeenNthCalledWith(2, { text: "第二条" });
        expect(handlers.add).toHaveBeenNthCalledWith(3, { text: "第三条" });
    });

    it("展开详情后可保存备注与链接，也能删除该条", async () => {
        const handlers = mount();
        await tick();
        document.querySelector<HTMLButtonElement>('[aria-label^="展开待办 整理"]')!.click();
        await tick();

        const note = document.querySelector<HTMLTextAreaElement>(".xz-todo__drawer textarea")!;
        note.value = "已看完差异表";
        note.dispatchEvent(new Event("input", { bubbles: true }));
        note.dispatchEvent(new Event("blur", { bubbles: true }));
        expect(handlers.detail).toHaveBeenCalledWith({ id: "todo-1", note: "已看完差异表", links: [] });

        const remove = [...document.querySelectorAll<HTMLButtonElement>(".xz-todo__drawer button")].find((button) => button.textContent?.includes("删除"))!;
        remove.click();
        expect(handlers.remove).toHaveBeenCalledWith({ id: "todo-1" });
    });

    it("「放进今天」把单条或多选交给父组件", async () => {
        const handlers = mount();
        await tick();
        const today = [...document.querySelectorAll<HTMLButtonElement>(".xz-todo__link")].find((button) => button.textContent?.trim() === "放进今天")!;
        today.click();
        expect(handlers.today).toHaveBeenCalledWith({ ids: ["todo-1"] });

        clickByText(".xz-todo-card__link", "多选");
        await tick();
        const picks = [...document.querySelectorAll<HTMLInputElement>(".xz-todo__pick")];
        expect(picks).toHaveLength(2);
        picks[0].checked = true;
        picks[0].dispatchEvent(new Event("change", { bubbles: true }));
        picks[1].checked = true;
        picks[1].dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        clickByText(".xz-todo-card__mini", "放进今天");
        expect(handlers.today).toHaveBeenLastCalledWith({ ids: ["todo-1", "todo-2"] });
    });

    it("空清单给出起步提示", async () => {
        mount([]);
        await tick();
        expect(document.querySelector(".xz-todo-empty")?.textContent).toContain("还没有待办");
        expect(document.querySelector(".xz-todo-progress")).toBeNull();
    });

    function clickByText(selector: string, text: string) {
        const target = [...document.querySelectorAll<HTMLButtonElement>(selector)].find((button) => button.textContent?.includes(text));
        if (!target) throw new Error(`没有找到包含「${text}」的 ${selector}`);
        target.click();
    }
});

describe("结构化细则卡（领域层契约）", () => {
    it("空细则的默认值不产生内容，迁移标记默认不存在", () => {
        expect(createEmptyActionDetail()).toMatchObject({
            currentState: "",
            background: "",
            prompt: "",
            guidance: "",
            definition: "",
            outcomes: [],
            migratedFromCurrentActionAt: null,
        });
    });
});
