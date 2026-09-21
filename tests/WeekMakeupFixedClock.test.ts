import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import XingzhouApp from "../src/XingzhouApp.svelte";
import type { WorkItem, WorkItemChanges, WorkItemData } from "../src/work-items";

function localDateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/*
 * 周视图的「补记完成」只在「本周之内、今天之前」的已排期切片上出现：
 * 周视图只渲染本周七天，而这个按钮要求 day.key < 今天。
 *
 * 于是这个行为在真实时钟下无法稳定测试——今天是周一时，本周之内不存在更早的一天
 * （上周日属于上一周，不在视图里）。XingzhouApp.test.ts 里那条同类用例因此只在周二到周日通过，
 * 周一必然失败。这里把系统时间固定到周三，让同一套断言在任何一天运行都成立，
 * 同时保留对真实实现的验证（不替换任何业务逻辑）。
 */
describe("周视图补记完成（固定系统时间）", () => {
    let component: XingzhouApp | undefined;

    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        // 2026-09-23 是星期三：本周为 09-21 ~ 09-27，昨天 09-22 落在本周之内
        vi.setSystemTime(new Date("2026-09-23T10:00:00"));
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
        vi.useRealTimers();
    });

    it("已完成的存量事务：补记完成不改状态，撤销后回到进行中", async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        expect(localDateKey(yesterday)).toBe("2026-09-22");

        const item: WorkItem = {
            id: "legacy", rowId: "legacy", title: "存量已完成的事务", documentId: null, detached: true,
            type: "事务", status: "已完成", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: null, noDeadline: true, durationMinutes: 20, energy: "低", updatedAt: Date.now(),
            sliceTargetCount: 1,
            executionSlices: [{ id: "legacy-slice", scheduledDate: localDateKey(yesterday), status: "missed", completedAt: null, updatedAt: Date.now() }],
        };
        const workItemData: WorkItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [item], missingFields: [], fields: {},
        };
        const saveItem = vi.fn(async (currentData: WorkItemData, currentItem: WorkItem, changes: WorkItemChanges): Promise<WorkItemData> => ({
            ...currentData,
            items: currentData.items.map((candidate) => candidate.id === currentItem.id ? {
                ...candidate,
                ...(changes.executionSlices !== undefined ? { executionSlices: changes.executionSlices } : {}),
                ...(typeof changes.status === "string" ? { status: changes.status } : {}),
                ...(changes.imageCleanup !== undefined ? { imageCleanup: changes.imageCleanup } : {}),
            } : candidate),
        }));

        component = new XingzhouApp({
            target: document.body,
            props: { load: vi.fn().mockResolvedValue(workItemData), captureInbox: vi.fn(), saveItem, deleteItem: vi.fn(), openDocument: vi.fn() },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-workspace")).not.toBeNull());
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "本周")?.click();
        await tick();

        const actions = () => [...(document.querySelector<HTMLElement>(`[data-work-item-id="legacy"][data-week-date="${localDateKey(yesterday)}"]`)
            ?.querySelectorAll<HTMLButtonElement>(".xz-week-item-actions button") ?? [])];
        expect(actions().map((button) => button.textContent?.trim())).toContain("补记完成");
        actions().find((button) => button.textContent?.trim() === "补记完成")?.click();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledOnce());
        /* 已结束的事务不被切片动作改写状态 */
        expect(saveItem.mock.calls[0][2].status).toBeUndefined();

        await vi.waitFor(() => expect(actions().some((button) => button.textContent?.trim() === "撤销完成")).toBe(true));
        actions().find((button) => button.textContent?.trim() === "撤销完成")?.click();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledTimes(2));
        expect(saveItem.mock.calls[1][2].status).toBe("进行中");
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="legacy"] .xz-week-item-meta')?.textContent).toContain("进行中"));
    });
});
