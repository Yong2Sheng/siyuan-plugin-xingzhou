import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import XingzhouApp from "../src/XingzhouApp.svelte";
import { createEmptyActionDetail } from "../src/action-detail";
import { createTodo } from "../src/todos";
import type { WorkItem, WorkItemChanges, WorkItemData } from "../src/work-items";

const NOW = new Date("2026-09-21T10:00:00").getTime();
const TODAY = "2026-09-21";

const STATUS_FIELD = { id: "status", name: "状态", type: "select", options: [{ name: "进行中" }, { name: "已完成" }] };

function transaction(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "tx", rowId: "tx", title: "行动细则 2.0 结构化", documentId: null, detached: true,
        type: "事务", status: "进行中", currentAction: "", nextAction: "写 normalizeTodo 的单元测试",
        actionDetail: createEmptyActionDetail(),
        todos: [],
        parentIds: [], topProjectIds: [], hardPrerequisiteIds: [], softPrerequisiteIds: [],
        planDate: null, deadline: null, noDeadline: false, durationMinutes: null, energy: "", updatedAt: NOW,
        sliceTargetCount: 2,
        executionSlices: [
            { id: "slice-done", scheduledDate: "2026-09-18", status: "completed", completedAt: NOW, updatedAt: NOW },
            { id: "slice-missed", scheduledDate: "2026-09-15", status: "missed", completedAt: null, updatedAt: NOW },
        ],
        ...overrides,
    };
}

describe("完成事务的强制处置", () => {
    let component: XingzhouApp | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    function mount(item: WorkItem) {
        const buildData = (items: WorkItem[]): WorkItemData => ({
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items, missingFields: [],
            fields: {
                title: { id: "title", name: "工作项", type: "block", options: [] },
                type: { id: "type", name: "工作项类型", type: "select", options: [{ name: "事务" }] },
                status: STATUS_FIELD,
                currentAction: { id: "current", name: "本次行动细则", type: "text", options: [] },
                nextAction: { id: "next", name: "下一步行动", type: "text", options: [] },
            },
        });
        const saveItem = vi.fn(async (current: WorkItemData, currentItem: WorkItem, changes: WorkItemChanges) => buildData(
            current.items.map((entry): WorkItem => entry.id === currentItem.id ? { ...entry, ...changes } as WorkItem : entry),
        ));
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue(buildData([item])),
                captureInbox: vi.fn(), saveItem, deleteItem: vi.fn(), openDocument: vi.fn(),
                initialWorkItemId: item.id,
            },
        });
        return saveItem;
    }

    async function clickComplete() {
        await vi.waitFor(() => expect(document.querySelector(".xz-complete-button")).not.toBeNull());
        document.querySelector<HTMLButtonElement>(".xz-complete-button")!.click();
        await tick();
    }

    it("还有未完成切片与待办时：先弹处置层，不直接完成", async () => {
        const saveItem = mount(transaction({ todos: [createTodo("整理 3.8.3 变更清单", NOW, "todo-1")] }));
        await clickComplete();

        const dialog = document.querySelector(".xz-complete-dialog");
        expect(dialog).not.toBeNull();
        expect(dialog?.textContent).toContain("1 片切片");
        expect(dialog?.textContent).toContain("1 条待办");
        expect(dialog?.textContent).toContain("整理 3.8.3 变更清单");
        // 切片按状态与日期分列显示：状态用 chip 标注，日期单独一列
        expect(dialog?.textContent).toContain("错过");
        expect(dialog?.textContent).toContain("2026-09-15");
        // 处置前不得写入"已完成"
        expect(saveItem).not.toHaveBeenCalled();
    });

    it("选「全部标为放弃后完成」：切片记放弃、待办打叉，然后完成", async () => {
        const saveItem = mount(transaction({ todos: [createTodo("整理 3.8.3 变更清单", NOW, "todo-1")] }));
        await clickComplete();
        clickByText(".xz-complete-actions button", "处置并完成事务");
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));

        const changes = saveItem.mock.calls[0][2];
        expect(changes.status).toBe("已完成");
        expect(changes.todos?.[0]).toMatchObject({ id: "todo-1", status: "dropped", completedOn: null });
        expect(changes.executionSlices?.find((slice) => slice.id === "slice-missed")?.status).toBe("abandoned");
        expect(changes.executionSlices?.find((slice) => slice.id === "slice-done")?.status).toBe("completed");
    });

    it("选「保留为未完成收尾」：不动切片与待办，只在当前状态记一条遗留说明", async () => {
        const saveItem = mount(transaction({ todos: [createTodo("整理 3.8.3 变更清单", NOW, "todo-1")] }));
        await clickComplete();
        clickByText(".xz-complete-actions button", "先保留，直接完成");
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));

        const changes = saveItem.mock.calls[0][2];
        expect(changes.status).toBe("已完成");
        expect(changes.todos).toBeUndefined();
        expect(changes.executionSlices).toBeUndefined();
        expect(changes.actionDetail?.currentState).toContain("遗留");
    });

    it("选「记录原因后完成」：把原因写进当前状态", async () => {
        const saveItem = mount(transaction({ todos: [createTodo("整理 3.8.3 变更清单", NOW, "todo-1")] }));
        await clickComplete();
        const reasonRadio = [...document.querySelectorAll<HTMLInputElement>(".xz-complete-option input")][2];
        reasonRadio.click();
        await tick();
        const reason = document.querySelector<HTMLInputElement>(".xz-complete-reason")!;
        reason.value = "项目取消";
        reason.dispatchEvent(new Event("input", { bubbles: true }));
        clickByText(".xz-complete-actions button", "处置并完成事务");
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));

        const changes = saveItem.mock.calls[0][2];
        expect(changes.status).toBe("已完成");
        expect(changes.actionDetail?.currentState).toContain("项目取消");
    });

    it("没有未完成项时直接完成，不弹处置层", async () => {
        const saveItem = mount(transaction({
            todos: [{ ...createTodo("已完成的待办", NOW, "todo-1"), status: "done", completedOn: TODAY }],
            executionSlices: [{ id: "slice-done", scheduledDate: "2026-09-18", status: "completed", completedAt: NOW, updatedAt: NOW }],
        }));
        await clickComplete();
        expect(document.querySelector(".xz-complete-dialog")).toBeNull();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
        expect(saveItem.mock.calls[0][2].status).toBe("已完成");
    });

    it("取消处置层不写入任何状态", async () => {
        const saveItem = mount(transaction({ todos: [createTodo("整理 3.8.3 变更清单", NOW, "todo-1")] }));
        await clickComplete();
        clickByText(".xz-complete-actions button", "取消");
        await tick();
        expect(document.querySelector(".xz-complete-dialog")).toBeNull();
        expect(saveItem).not.toHaveBeenCalled();
    });

    it("状态下拉直接改成已完成时同样先走处置层", async () => {
        const saveItem = mount(transaction({ todos: [createTodo("整理 3.8.3 变更清单", NOW, "todo-1")] }));
        await vi.waitFor(() => expect(document.querySelector(".xz-meta-status-select")).not.toBeNull());
        const select = document.querySelector<HTMLSelectElement>(".xz-meta-status-select")!;
        select.value = "已完成";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.querySelector(".xz-complete-dialog")).not.toBeNull();
        expect(saveItem).not.toHaveBeenCalled();
    });

    function clickByText(selector: string, text: string) {
        const target = [...document.querySelectorAll<HTMLButtonElement>(selector)].find((button) => button.textContent?.includes(text));
        if (!target) throw new Error(`没有找到包含「${text}」的按钮`);
        target.click();
    }
});

describe("待办清单的出现位置", () => {
    let component: XingzhouApp | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    function mount(item: WorkItem) {
        const buildData = (items: WorkItem[]): WorkItemData => ({
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items, missingFields: [],
            fields: {
                title: { id: "title", name: "工作项", type: "block", options: [] },
                type: { id: "type", name: "工作项类型", type: "select", options: [{ name: "事务" }, { name: "项目" }, { name: "想法" }] },
                status: STATUS_FIELD,
                currentAction: { id: "current", name: "本次行动细则", type: "text", options: [] },
                nextAction: { id: "next", name: "下一步行动", type: "text", options: [] },
            },
        });
        const saveItem = vi.fn(async (current: WorkItemData, currentItem: WorkItem, changes: WorkItemChanges) => buildData(
            current.items.map((entry): WorkItem => entry.id === currentItem.id ? { ...entry, ...changes } as WorkItem : entry),
        ));
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue(buildData([item])),
                captureInbox: vi.fn(), saveItem, deleteItem: vi.fn(), openDocument: vi.fn(),
                initialWorkItemId: item.id,
            },
        });
        return saveItem;
    }

    it("事务的详情里待办清单在行动细则上方，且能直接添加", async () => {
        const saveItem = mount(transaction({ todos: [createTodo("整理 3.8.3 变更清单", NOW, "todo-1")] }));
        await vi.waitFor(() => expect(document.querySelector(".xz-todo-card")).not.toBeNull());
        // 位置：待办卡在行动细则卡之前
        const cards = [...document.querySelectorAll(".xz-todo-card, .xz-plan-card")];
        expect(cards.map((card) => card.className.split(" ")[0])).toEqual(["xz-todo-card", "xz-plan-card"]);
        expect(document.querySelector(".xz-todo-card")?.textContent).toContain("整理 3.8.3 变更清单");

        const draft = document.querySelector<HTMLTextAreaElement>("#xz-todo-draft")!;
        draft.value = "新加一条待办";
        draft.dispatchEvent(new Event("input", { bubbles: true }));
        draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
        expect(saveItem.mock.calls[0][2].todos?.map((todo) => todo.text)).toEqual(["整理 3.8.3 变更清单", "新加一条待办"]);
    });

    it("勾选待办即时保存，并记录完成当天", async () => {
        const saveItem = mount(transaction({ todos: [createTodo("写测试", NOW, "todo-1")] }));
        await vi.waitFor(() => expect(document.querySelector(".xz-todo__box")).not.toBeNull());
        document.querySelector<HTMLButtonElement>(".xz-todo__box")!.click();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
        expect(saveItem.mock.calls[0][2].todos?.[0]).toMatchObject({ id: "todo-1", status: "done" });
    });

    it("想法也有待办清单，项目没有", async () => {
        mount(transaction({ id: "idea-1", rowId: "idea-1", title: "一个想法", type: "想法" }));
        await vi.waitFor(() => expect(document.querySelector(".xz-plan-card")).not.toBeNull());
        expect(document.querySelector(".xz-todo-card")).not.toBeNull();

        component?.$destroy();
        document.body.replaceChildren();
        mount(transaction({ id: "proj-1", rowId: "proj-1", title: "一个项目", type: "项目" }));
        await vi.waitFor(() => expect(document.querySelector(".xz-plan-card")).not.toBeNull());
        expect(document.querySelector(".xz-todo-card")).toBeNull();
    });
});

describe("任务类型退役", () => {
    let component: XingzhouApp | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("类型下拉里不再有「任务」，存量任务显示为旧类型；图例也不含任务", async () => {
        const legacy: WorkItem = {
            id: "legacy-task", rowId: "legacy-task", title: "旧任务", documentId: null, detached: true,
            type: "任务", status: "进行中", currentAction: "", nextAction: "",
            actionDetail: createEmptyActionDetail(), todos: [],
            parentIds: [], topProjectIds: [], planDate: null, deadline: null, noDeadline: false,
            durationMinutes: null, energy: "", updatedAt: NOW,
        };
        const data: WorkItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [legacy], missingFields: [],
            fields: {
                title: { id: "title", name: "工作项", type: "block", options: [] },
                type: { id: "type", name: "工作项类型", type: "select", options: [{ name: "项目" }, { name: "长期领域" }, { name: "事务" }, { name: "想法" }] },
                status: STATUS_FIELD,
            },
        };
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue(data), captureInbox: vi.fn(), saveItem: vi.fn(),
                deleteItem: vi.fn(), openDocument: vi.fn(), initialWorkItemId: legacy.id,
            },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-meta-type-select")).not.toBeNull());

        const options = [...document.querySelectorAll<HTMLOptionElement>(".xz-meta-type-select option")].map((option) => option.textContent?.trim());
        expect(options.some((label) => label === "任务")).toBe(false);
        expect(options.some((label) => label?.includes("旧类型"))).toBe(true);
        const legend = [...document.querySelectorAll(".xz-role-legend .xz-role-badge")].map((badge) => badge.textContent?.trim());
        expect(legend).not.toContain("任务");
    });
});
