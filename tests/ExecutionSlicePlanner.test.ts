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
