import { describe, expect, it } from "vitest";
import {
    availableSliceCount,
    automaticStatusForSliceCompletion,
    cancelScheduledSlice,
    completeSliceNow,
    expirePastSlices,
    executionSliceLoadsByDate,
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

    it("未来切片提前完成时移到今天，过去未完成切片补记时保留原日期", () => {
        const future = scheduleSlice(item(), "2026-09-06", "future", TODAY);
        const completedEarly = completeSliceNow(item({ executionSlices: future }), "future", TODAY);
        expect(completedEarly[0]).toMatchObject({ scheduledDate: "2026-09-04", status: "completed", completedAt: TODAY });

        const missed = [{ id: "past", scheduledDate: "2026-09-03", status: "missed" as const, completedAt: null, updatedAt: 1 }];
        const corrected = completeSliceNow(item({ executionSlices: missed }), "past", TODAY);
        expect(corrected[0]).toMatchObject({ scheduledDate: "2026-09-03", status: "completed", completedAt: TODAY });
    });

    it("今天已有同一事务切片时阻止把未来切片提前完成", () => {
        const slices = [
            { id: "today", scheduledDate: "2026-09-04", status: "scheduled" as const, completedAt: null, updatedAt: 1 },
            { id: "future", scheduledDate: "2026-09-06", status: "scheduled" as const, completedAt: null, updatedAt: 2 },
        ];
        expect(() => completeSliceNow(item({ executionSlices: slices }), "future", TODAY)).toThrow("已经有执行记录");
    });

    it("首次完成切片只把准备状态推进为进行中，并尊重手动状态", () => {
        const scheduled = scheduleSlice(item({ status: "待开始" }), "2026-09-04", "first", TODAY);
        const before = item({ status: "待开始", executionSlices: scheduled });
        const completed = setSliceOutcome(before, "first", "completed", TODAY);
        expect(automaticStatusForSliceCompletion(before, completed)).toBe("进行中");
        expect(automaticStatusForSliceCompletion(item({ status: "暂停", executionSlices: scheduled }), completed)).toBeNull();
        expect(automaticStatusForSliceCompletion(item({ status: "待开始", executionSlices: completed }), completed)).toBeNull();
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

    it("按日期汇总已安排和已完成切片的数量与预计时长", () => {
        const first = item({
            id: "first",
            durationMinutes: 30,
            executionSlices: [
                { id: "scheduled", scheduledDate: "2026-09-05", status: "scheduled", completedAt: null, updatedAt: 1 },
                { id: "missed", scheduledDate: "2026-09-05", status: "missed", completedAt: null, updatedAt: 2 },
            ],
        });
        const second = item({
            id: "second",
            durationMinutes: 45,
            executionSlices: [{ id: "completed", scheduledDate: "2026-09-05", status: "completed", completedAt: 3, updatedAt: 3 }],
        });
        const unestimated = item({
            id: "third",
            durationMinutes: null,
            executionSlices: [{ id: "unknown", scheduledDate: "2026-09-05", status: "scheduled", completedAt: null, updatedAt: 4 }],
        });

        expect(executionSliceLoadsByDate([first, second, unestimated]).get("2026-09-05")).toEqual({
            count: 3,
            minutes: 75,
            unestimatedCount: 1,
        });
    });
});
