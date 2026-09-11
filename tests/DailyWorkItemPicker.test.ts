import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import DailyWorkItemPicker from "../src/DailyWorkItemPicker.svelte";
import type { WorkItem, WorkItemChanges, WorkItemData } from "../src/work-items";

function localDateKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const TODAY = localDateKey();

function transaction(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "tx", rowId: "tx", title: "今天要推进的事务", documentId: null, detached: true,
        type: "事务", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        planDate: null, deadline: null, noDeadline: true, durationMinutes: 20, energy: "中", updatedAt: Date.now(),
        sliceTargetCount: 1,
        executionSlices: [{ id: "today-slice", scheduledDate: TODAY, status: "scheduled", completedAt: null, updatedAt: Date.now() }],
        ...overrides,
    };
}

function dataOf(items: WorkItem[]): WorkItemData {
    return { attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view", items, missingFields: [], fields: {} };
}

/** 按行舟真实保存语义回写：切片、状态与图片登记都落到条目上。 */
function savingMock(initial: WorkItemData) {
    let current = initial;
    const saveWorkItem = vi.fn(async (data: WorkItemData, item: WorkItem, changes: WorkItemChanges): Promise<WorkItemData> => {
        current = {
            ...data,
            items: data.items.map((candidate) => candidate.id === item.id ? {
                ...candidate,
                ...(changes.executionSlices !== undefined ? { executionSlices: changes.executionSlices } : {}),
                ...(typeof changes.status === "string" ? { status: changes.status } : {}),
                ...(changes.imageCleanup !== undefined ? { imageCleanup: changes.imageCleanup } : {}),
            } : candidate),
        };
        return current;
    });
    return { saveWorkItem, current: () => current };
}

function buttonRow(title: string): HTMLElement {
    const chip = [...document.querySelectorAll<HTMLElement>(".xz-daily-project-link")]
        .find((candidate) => candidate.querySelector("strong")?.textContent?.includes(title));
    if (!chip) throw new Error(`没有找到「${title}」这一行`);
    return chip;
}

describe("今日个人安排", () => {
    let component: DailyWorkItemPicker | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("待执行的行提供 完成／放弃／取消安排 三个操作", async () => {
        const item = transaction();
        const { saveWorkItem } = savingMock(dataOf([item]));
        component = new DailyWorkItemPicker({ target: document.body, props: { data: dataOf([item]), date: TODAY, saveWorkItem } });
        await tick();

        expect([...buttonRow("今天要推进的事务").querySelectorAll(".xz-daily-slice-actions button")].map((button) => button.textContent?.trim()))
            .toEqual(["完成", "放弃", "取消安排"]);
    });

    it("取消安排只撤掉今天的切片，不改事务状态，并回传新的今日安排", async () => {
        const item = transaction();
        const { saveWorkItem } = savingMock(dataOf([item]));
        const change = vi.fn();
        component = new DailyWorkItemPicker({ target: document.body, props: { data: dataOf([item]), date: TODAY, saveWorkItem } });
        component.$on("change", change);
        await tick();

        [...buttonRow("今天要推进的事务").querySelectorAll<HTMLButtonElement>(".xz-daily-slice-actions button")]
            .find((button) => button.textContent?.trim() === "取消安排")?.click();

        await vi.waitFor(() => expect(saveWorkItem).toHaveBeenCalledOnce());
        expect(saveWorkItem.mock.calls[0][2]).toEqual({ executionSlices: [] });
        expect(change).toHaveBeenCalledOnce();
        expect(change.mock.calls[0][0].detail.links).toEqual([]);
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-project-picker__empty")).not.toBeNull());
    });

    it("完成最后一片时同步把事务改成已完成，并登记终态图片清理", async () => {
        const item = transaction({ currentAction: "看这张\n![](assets/evidence.png)" });
        const { saveWorkItem } = savingMock(dataOf([item]));
        component = new DailyWorkItemPicker({ target: document.body, props: { data: dataOf([item]), date: TODAY, saveWorkItem } });
        await tick();

        [...buttonRow("今天要推进的事务").querySelectorAll<HTMLButtonElement>(".xz-daily-slice-actions button")]
            .find((button) => button.textContent?.trim() === "完成")?.click();

        await vi.waitFor(() => expect(saveWorkItem).toHaveBeenCalledOnce());
        expect(saveWorkItem.mock.calls[0][2]).toMatchObject({
            status: "已完成",
            imageCleanup: { paths: ["assets/evidence.png"] },
        });
        expect(saveWorkItem.mock.calls[0][2].executionSlices).toEqual([expect.objectContaining({ id: "today-slice", status: "completed" })]);
    });

    it("目标切片还没做满时只完成切片，不动事务状态", async () => {
        const item = transaction({ sliceTargetCount: 2 });
        const { saveWorkItem } = savingMock(dataOf([item]));
        component = new DailyWorkItemPicker({ target: document.body, props: { data: dataOf([item]), date: TODAY, saveWorkItem } });
        await tick();

        [...buttonRow("今天要推进的事务").querySelectorAll<HTMLButtonElement>(".xz-daily-slice-actions button")]
            .find((button) => button.textContent?.trim() === "完成")?.click();

        await vi.waitFor(() => expect(saveWorkItem).toHaveBeenCalledOnce());
        expect(saveWorkItem.mock.calls[0][2]).toEqual({ executionSlices: [expect.objectContaining({ id: "today-slice", status: "completed" })] });
    });

    it("事务已结束时行保留并标出状态，但不再提供操作", async () => {
        const cancelled = transaction({ id: "cancelled", rowId: "cancelled", title: "已经取消的事务", status: "已取消" });
        const done = transaction({ id: "done", rowId: "done", title: "已经完成的事务", status: "已完成", executionSlices: [{ id: "done-slice", scheduledDate: TODAY, status: "completed", completedAt: Date.now(), updatedAt: Date.now() }] });
        const { saveWorkItem } = savingMock(dataOf([cancelled, done]));
        component = new DailyWorkItemPicker({ target: document.body, props: { data: dataOf([cancelled, done]), date: TODAY, saveWorkItem } });
        await tick();

        expect(document.querySelector(".xz-daily-project-links")?.textContent).toContain("已经取消的事务");
        expect(buttonRow("已经取消的事务").classList.contains("closed")).toBe(true);
        expect(buttonRow("已经取消的事务").querySelector(".xz-daily-project-link__state--stopped")?.textContent).toBe("事务已取消");
        expect(buttonRow("已经取消的事务").querySelector(".xz-daily-slice-actions")).toBeNull();
        expect(buttonRow("已经完成的事务").querySelector(".xz-daily-project-link__state--done")?.textContent).toBe("事务已完成");
        expect(buttonRow("已经完成的事务").querySelector(".xz-daily-slice-actions")).toBeNull();
        expect(saveWorkItem).not.toHaveBeenCalled();
    });

    it("点行标题把事务交给项目与事务视图打开", async () => {
        const item = transaction();
        const { saveWorkItem } = savingMock(dataOf([item]));
        const openWorkItem = vi.fn();
        component = new DailyWorkItemPicker({ target: document.body, props: { data: dataOf([item]), date: TODAY, saveWorkItem, openWorkItem } });
        await tick();

        buttonRow("今天要推进的事务").querySelector<HTMLButtonElement>(".xz-daily-project-link__main")?.click();
        expect(openWorkItem).toHaveBeenCalledWith("tx");
    });
});
