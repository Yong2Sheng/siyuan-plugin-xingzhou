import { describe, expect, it } from "vitest";
import {
    availableSliceCount,
    cancelScheduledSlice,
    expirePastSlices,
    moveScheduledSlice,
    scheduleSlice,
    setSliceOutcome,
    sliceCompletionPercent,
    validateSliceTarget,
} from "../src/execution-slices";
import type { WorkItem } from "../src/work-items";

const TODAY = new Date("2026-09-04T12:00:00").getTime();

function item(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "task", rowId: "task", title: "分片事务", documentId: null, detached: true,
        type: "事务", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        planDate: null, deadline: new Date("2026-09-10T00:00:00").getTime(), noDeadline: false,
        durationMinutes: 30, energy: "", updatedAt: null, sliceTargetCount: 2, executionSlices: [],
        ...overrides,
    };
}

describe("事务执行切片", () => {
    it("在截止日期前安排、移动和取消，并禁止同日重复", () => {
        const scheduled = scheduleSlice(item(), "2026-09-05", "slice-1", TODAY);
        expect(scheduled).toMatchObject([{ id: "slice-1", scheduledDate: "2026-09-05", status: "scheduled" }]);
        expect(() => scheduleSlice(item({ executionSlices: scheduled }), "2026-09-05", "slice-2", TODAY)).toThrow("已经有执行记录");
        expect(() => scheduleSlice(item(), "2026-09-11", "late", TODAY)).toThrow("截止日期之后");

        const moved = moveScheduledSlice(item({ executionSlices: scheduled }), "slice-1", "2026-09-06", TODAY);
        expect(moved[0].scheduledDate).toBe("2026-09-06");
        expect(cancelScheduledSlice(item({ executionSlices: moved }), "slice-1")).toEqual([]);
    });

    it("没有截止日期时仍可安排和移动执行切片", () => {
        const scheduled = scheduleSlice(item({ deadline: null, noDeadline: true }), "2026-09-05", "open-ended", TODAY);
        expect(scheduled[0]).toMatchObject({ id: "open-ended", scheduledDate: "2026-09-05", status: "scheduled" });

        const moved = moveScheduledSlice(item({ deadline: null, noDeadline: true, executionSlices: scheduled }), "open-ended", "2026-10-01", TODAY);
        expect(moved[0].scheduledDate).toBe("2026-10-01");
    });

    it("完成按目标数计算百分比，放弃释放一个可重新安排的名额", () => {
        const first = scheduleSlice(item(), "2026-09-04", "done", TODAY);
        const withTwo = scheduleSlice(item({ executionSlices: first }), "2026-09-05", "give-up", TODAY);
        expect(availableSliceCount(item({ executionSlices: withTwo }))).toBe(0);

        const completed = setSliceOutcome(item({ executionSlices: withTwo }), "done", "completed", TODAY);
        expect(sliceCompletionPercent(item({ executionSlices: completed }))).toBe(50);
        const abandoned = setSliceOutcome(item({ executionSlices: completed }), "give-up", "abandoned", TODAY);
        expect(availableSliceCount(item({ executionSlices: abandoned }))).toBe(1);
        expect(sliceCompletionPercent(item({ executionSlices: abandoned }))).toBe(50);
    });

    it("跨日后把未处理的过去安排标为未完成并释放名额", () => {
        const past = [{ id: "past", scheduledDate: "2026-09-03", status: "scheduled" as const, completedAt: null, updatedAt: 1 }];
        const expired = expirePastSlices(item({ executionSlices: past }), "2026-09-04", TODAY);
        expect(expired?.[0].status).toBe("missed");
        expect(availableSliceCount(item({ executionSlices: expired ?? [] }))).toBe(2);
    });

    it("目标数不能小于已完成和已安排的有效切片数", () => {
        const executionSlices = [
            { id: "done", scheduledDate: "2026-09-03", status: "completed" as const, completedAt: 1, updatedAt: 1 },
            { id: "next", scheduledDate: "2026-09-05", status: "scheduled" as const, completedAt: null, updatedAt: 2 },
            { id: "missed", scheduledDate: "2026-09-02", status: "missed" as const, completedAt: null, updatedAt: 3 },
        ];
        expect(validateSliceTarget(item({ executionSlices }), 1)).toContain("至少需要保留 2 个切片");
        expect(validateSliceTarget(item({ executionSlices }), 2)).toBeNull();
    });
});
