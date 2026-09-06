import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExecutionSlicePlanner from "../src/ExecutionSlicePlanner.svelte";
import type { WorkItem } from "../src/work-items";

describe("执行切片配置", () => {
    let component: ExecutionSlicePlanner | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("数字输入框会把目标切片数作为数值保存", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: transaction(), save } });
        await tick();

        const input = document.querySelector('[aria-label="目标切片数"]') as HTMLInputElement;
        input.value = "2";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));

        await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ sliceTargetCount: 2 }));
    });

    it("没有截止日期时仍允许点击日历安排切片", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        component = new ExecutionSlicePlanner({
            target: document.body,
            props: { item: transaction({ deadline: null, noDeadline: true, sliceTargetCount: 1 }), save },
        });
        await tick();

        const today = document.querySelector<HTMLButtonElement>(".xz-slice-day.today");
        if (!today) throw new Error("没有找到今天的日历格");
        expect(today.disabled).toBe(false);
        expect(document.body.textContent).toContain("未设置截止日期，可从今天起自由安排");
        today.click();
        await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
        expect(save.mock.calls[0][0].executionSlices).toHaveLength(1);
    });

    it("显示所有事务在同一天的切片数量和预计时间", async () => {
        const date = new Date();
        date.setHours(12, 0, 0, 0);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const current = transaction({
            sliceTargetCount: 1,
            executionSlices: [{ id: "current", scheduledDate: key, status: "scheduled", completedAt: null, updatedAt: 1 }],
        });
        const another = transaction({
            id: "another",
            rowId: "another",
            durationMinutes: 35,
            executionSlices: [{ id: "another-slice", scheduledDate: key, status: "completed", completedAt: 2, updatedAt: 2 }],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: current, items: [current, another] } });
        await tick();

        const today = document.querySelector<HTMLButtonElement>(".xz-slice-day.today");
        expect(today?.querySelector(".xz-slice-day-load")?.textContent).toContain("55分");
        expect(today?.querySelector(".xz-slice-day-count")?.textContent).toBe("2片");
        expect(today?.getAttribute("aria-label")).toContain("当日共 2 片，预计 55 分钟");
        expect(document.querySelector(".xz-slice-card > header .xz-slice-legend")?.textContent).toContain("已安排");
        expect(document.querySelector(".xz-slice-side")).toBeNull();
    });

    it("所有目标切片完成后提示确认事务完成", async () => {
        const complete = vi.fn().mockResolvedValue(undefined);
        const finished = transaction({
            status: "进行中",
            sliceTargetCount: 1,
            executionSlices: [{ id: "done", scheduledDate: "2026-09-04", status: "completed", completedAt: 2, updatedAt: 2 }],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: finished, complete } });
        await tick();

        expect(document.querySelector(".xz-slice-completion-prompt")?.textContent).toContain("事务是否也已完成");
        ([...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "完成事务") as HTMLButtonElement).click();
        await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
    });
});

function transaction(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "task", rowId: "task", title: "测试事务", documentId: null, detached: true,
        type: "事务", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        planDate: null, deadline: Date.now() + 2 * 24 * 60 * 60 * 1000, noDeadline: false,
        durationMinutes: 20, energy: "低", updatedAt: null, sliceTargetCount: null, executionSlices: [],
        ...overrides,
    };
}
