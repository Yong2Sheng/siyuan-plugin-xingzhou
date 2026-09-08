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

    it("右键未来切片可以提前完成并保留原计划日期", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
        const future = transaction({
            sliceTargetCount: 1,
            executionSlices: [{ id: "future", scheduledDate: tomorrowKey, status: "scheduled", completedAt: null, updatedAt: 1 }],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: future, save } });
        await tick();

        const day = [...document.querySelectorAll<HTMLButtonElement>(".xz-slice-day")]
            .find((button) => button.getAttribute("aria-label")?.startsWith(tomorrowKey));
        expect(day?.title).toContain("右键可提前完成");
        day?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 160 }));
        await tick();
        const completeEarly = document.querySelector<HTMLButtonElement>(".xz-slice-context-menu button");
        expect(completeEarly?.textContent).toBe("提前完成此切片");
        completeEarly?.click();

        await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
        expect(save.mock.calls[0][0].executionSlices).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: "future", status: "completed", scheduledDate: tomorrowKey }),
        ]));
    });

    it("右键今天的切片可以完成，右键过期切片可以补记完成", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const todayKey = localDateKey();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
        const current = transaction({
            sliceTargetCount: 2,
            executionSlices: [
                { id: "past", scheduledDate: yesterdayKey, status: "missed", completedAt: null, updatedAt: 1 },
                { id: "today", scheduledDate: todayKey, status: "scheduled", completedAt: null, updatedAt: 2 },
            ],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: current, save } });
        await tick();

        const today = [...document.querySelectorAll<HTMLButtonElement>(".xz-slice-day")]
            .find((button) => button.getAttribute("aria-label")?.startsWith(todayKey));
        expect(today?.title).toContain("右键可完成");
        today?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 160 }));
        await tick();
        expect(document.querySelector<HTMLButtonElement>(".xz-slice-context-menu button")?.textContent).toBe("完成此切片");

        document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await tick();
        const past = [...document.querySelectorAll<HTMLButtonElement>(".xz-slice-day")]
            .find((button) => button.getAttribute("aria-label")?.startsWith(yesterdayKey));
        expect(past?.disabled).toBe(false);
        expect(past?.title).toContain("右键可补记完成");
        past?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 160 }));
        await tick();
        const completeMissed = document.querySelector<HTMLButtonElement>(".xz-slice-context-menu button");
        expect(completeMissed?.textContent).toBe("补记完成此切片");
        completeMissed?.click();

        await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
        expect(save.mock.calls[0][0].executionSlices).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: "past", status: "completed", scheduledDate: yesterdayKey }),
            expect.objectContaining({ id: "today", status: "scheduled", scheduledDate: todayKey }),
        ]));
    });

    it("同一天存在多个切片时显示当前事务的切片数量", async () => {
        const key = localDateKey();
        const finished = transaction({
            sliceTargetCount: 2,
            executionSlices: [
                { id: "first", scheduledDate: key, status: "completed", completedAt: 1, updatedAt: 1 },
                { id: "second", scheduledDate: key, status: "completed", completedAt: 2, updatedAt: 2 },
            ],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: finished } });
        await tick();

        expect(document.querySelector(".xz-slice-arranged")?.textContent).toContain("已完成 2／2");
        expect(document.querySelector(".xz-slice-day.today .xz-slice-day-own-count")?.textContent).toContain("本事务 2 片 · 完成 2");
        expect(document.querySelector(".xz-slice-day.today")?.getAttribute("aria-label")).toContain("当前事务 2 个切片，已完成 2 个");
    });
});

function localDateKey(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function transaction(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "task", rowId: "task", title: "测试事务", documentId: null, detached: true,
        type: "事务", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        planDate: null, deadline: Date.now() + 2 * 24 * 60 * 60 * 1000, noDeadline: false,
        durationMinutes: 20, energy: "低", updatedAt: null, sliceTargetCount: null, executionSlices: [],
        ...overrides,
    };
}
