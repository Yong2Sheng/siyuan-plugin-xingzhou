import { describe, expect, it } from "vitest";
import {
    availableSliceCount,
    automaticSliceStatusChanges,
    automaticSliceUndoChanges,
    automaticStatusForSliceCompletion,
    automaticStatusForSliceUndo,
    cancelScheduledSlice,
    completeSliceNow,
    dayLoadValue,
    expirePastSlices,
    executionSlicePlanSummary,
    executionSliceLoadsByDate,
    executionSliceRemainingByDate,
    moveScheduledSlice,
    scheduleSlice,
    setSliceOutcome,
    sliceCompletionPercent,
    summarizeDayLoads,
    undoCompletedSlice,
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

    it("未来切片提前完成和过去切片补记都保留原计划日期", () => {
        const future = scheduleSlice(item(), "2026-09-06", "future", TODAY);
        const completedEarly = completeSliceNow(item({ executionSlices: future }), "future", TODAY);
        expect(completedEarly[0]).toMatchObject({ scheduledDate: "2026-09-06", status: "completed", completedAt: TODAY });

        const missed = [{ id: "past", scheduledDate: "2026-09-03", status: "missed" as const, completedAt: null, updatedAt: 1 }];
        const corrected = completeSliceNow(item({ executionSlices: missed }), "past", TODAY);
        expect(corrected[0]).toMatchObject({ scheduledDate: "2026-09-03", status: "completed", completedAt: TODAY });
    });

    it("今天已有同一事务切片时仍可提前完成未来切片", () => {
        const slices = [
            { id: "today", scheduledDate: "2026-09-04", status: "scheduled" as const, completedAt: null, updatedAt: 1 },
            { id: "future", scheduledDate: "2026-09-06", status: "scheduled" as const, completedAt: null, updatedAt: 2 },
        ];
        const completed = completeSliceNow(item({ executionSlices: slices }), "future", TODAY);
        expect(completed).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: "today", scheduledDate: "2026-09-04", status: "scheduled" }),
            expect.objectContaining({ id: "future", scheduledDate: "2026-09-06", status: "completed", completedAt: TODAY }),
        ]));
    });

    it("汇总事务在层级浏览中需要显示的切片安排状态", () => {
        expect(executionSlicePlanSummary(item({ sliceTargetCount: null }))).toMatchObject({ kind: "unset", label: "未设切片" });
        expect(executionSlicePlanSummary(item({ sliceTargetCount: 2 }))).toMatchObject({ kind: "needs-planning", label: "待安排 2" });
        expect(executionSlicePlanSummary(item({ executionSlices: [
            { id: "today", scheduledDate: "2026-09-04", status: "scheduled", completedAt: null, updatedAt: 1 },
            { id: "future", scheduledDate: "2026-09-06", status: "scheduled", completedAt: null, updatedAt: 2 },
        ] }))).toMatchObject({ kind: "arranged", label: "已安排 2/2" });
        expect(executionSlicePlanSummary(item({ executionSlices: [
            { id: "done", scheduledDate: "2026-09-03", status: "completed", completedAt: 1, updatedAt: 1 },
            { id: "future", scheduledDate: "2026-09-06", status: "scheduled", completedAt: null, updatedAt: 2 },
        ] }))).toMatchObject({ kind: "arranged", label: "已安排 2/2" });
        expect(executionSlicePlanSummary(item({ executionSlices: [
            { id: "first", scheduledDate: "2026-09-03", status: "completed", completedAt: 1, updatedAt: 1 },
            { id: "second", scheduledDate: "2026-09-04", status: "completed", completedAt: 2, updatedAt: 2 },
        ] }))).toMatchObject({ kind: "completed", label: "切片完成 2/2" });
        expect(executionSlicePlanSummary(item({ type: "项目" }))).toBeNull();
    });

    it("首次完成切片只把准备状态推进为进行中，并尊重手动状态", () => {
        const scheduled = scheduleSlice(item({ status: "待开始" }), "2026-09-04", "first", TODAY);
        const before = item({ status: "待开始", executionSlices: scheduled });
        const completed = setSliceOutcome(before, "first", "completed", TODAY);
        expect(automaticStatusForSliceCompletion(before, completed)).toBe("进行中");
        expect(automaticStatusForSliceCompletion(item({ status: "暂停", executionSlices: scheduled }), completed)).toBeNull();
        expect(automaticStatusForSliceCompletion(item({ status: "待开始", executionSlices: completed }), completed)).toBeNull();
    });

    it("目标切片全部做满时把事务推进为已完成", () => {
        const first = scheduleSlice(item({ sliceTargetCount: 2 }), "2026-09-04", "first", TODAY);
        const both = scheduleSlice(item({ sliceTargetCount: 2, executionSlices: first }), "2026-09-05", "second", TODAY);
        const oneDone = setSliceOutcome(item({ sliceTargetCount: 2, executionSlices: both }), "first", "completed", TODAY);
        const allDone = setSliceOutcome(item({ sliceTargetCount: 2, executionSlices: oneDone }), "second", "completed", TODAY);

        expect(automaticStatusForSliceCompletion(item({ sliceTargetCount: 2, executionSlices: both }), oneDone)).toBeNull();
        expect(automaticStatusForSliceCompletion(item({ sliceTargetCount: 2, executionSlices: oneDone }), allDone)).toBe("已完成");
        const singleScheduled = scheduleSlice(item({ status: "待开始", sliceTargetCount: 1 }), "2026-09-04", "only", TODAY);
        const singleBefore = item({ status: "待开始", sliceTargetCount: 1, executionSlices: singleScheduled });
        expect(automaticStatusForSliceCompletion(singleBefore, completeSliceNow(singleBefore, "only", TODAY))).toBe("已完成");
    });

    it("已结束的事务不被切片动作改写状态", () => {
        const completed = [{ id: "only", scheduledDate: "2026-09-04", status: "completed" as const, completedAt: 1, updatedAt: 1 }];
        for (const status of ["已完成", "已失败", "已取消", "已放弃"]) {
            expect(automaticStatusForSliceCompletion(item({ status, sliceTargetCount: 1 }), completed)).toBeNull();
        }
        expect(automaticStatusForSliceCompletion(item({ status: "暂停", sliceTargetCount: 1 }), completed)).toBe("已完成");
    });

    it("撤销切片完成后把自动完成的事务退回进行中", () => {
        const allDone = [
            { id: "first", scheduledDate: "2026-09-03", status: "completed" as const, completedAt: 1, updatedAt: 1 },
            { id: "second", scheduledDate: "2026-09-04", status: "completed" as const, completedAt: 2, updatedAt: 2 },
        ];
        const afterUndo = undoCompletedSlice(item({ status: "已完成", sliceTargetCount: 2, executionSlices: allDone }), "second", "2026-09-04", TODAY);

        expect(automaticStatusForSliceUndo(item({ status: "已完成", sliceTargetCount: 2, executionSlices: allDone }), afterUndo)).toBe("进行中");
        expect(automaticStatusForSliceUndo(item({ status: "进行中", sliceTargetCount: 2, executionSlices: allDone }), afterUndo)).toBeNull();
        expect(automaticStatusForSliceUndo(item({ status: "已放弃", sliceTargetCount: 2, executionSlices: allDone }), afterUndo)).toBeNull();
        /* 撤销一片后目标仍然做满（例如后来调小了目标数）时保持已完成 */
        expect(automaticStatusForSliceUndo(item({ status: "已完成", sliceTargetCount: 1, executionSlices: allDone }), afterUndo)).toBeNull();
    });

    it("切片保存参数统一带上事务状态自动结果，且不覆盖显式状态", () => {
        const scheduled = scheduleSlice(item({ status: "进行中", sliceTargetCount: 1 }), "2026-09-04", "only", TODAY);
        const before = item({ status: "进行中", sliceTargetCount: 1, executionSlices: scheduled });
        const completed = setSliceOutcome(before, "only", "completed", TODAY);

        expect(automaticSliceStatusChanges(before, { executionSlices: completed })).toMatchObject({ status: "已完成" });
        expect(automaticSliceStatusChanges(before, { executionSlices: completed, status: "暂停" })).toEqual({ executionSlices: completed, status: "暂停" });
        expect(automaticSliceStatusChanges(before, { title: "改名" })).toEqual({ title: "改名" });
        expect(automaticSliceUndoChanges(item({ status: "已完成", sliceTargetCount: 1, executionSlices: completed }), { executionSlices: scheduled })).toMatchObject({ status: "进行中" });
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

    it("待做只统计尚未完成的切片：提前完成、已完成、未完成与放弃都不算", () => {
        const day = "2026-09-10";
        const scheduled = item({
            id: "scheduled",
            durationMinutes: 60,
            executionSlices: [{ id: "a", scheduledDate: day, status: "scheduled", completedAt: null, updatedAt: 1 }],
        });
        const earlyCompleted = item({
            id: "early",
            durationMinutes: 120,
            executionSlices: [{ id: "b", scheduledDate: day, status: "completed", completedAt: 9, updatedAt: 2 }],
        });
        const missed = item({
            id: "missed",
            durationMinutes: 45,
            executionSlices: [{ id: "c", scheduledDate: day, status: "missed", completedAt: null, updatedAt: 3 }],
        });
        const abandoned = item({
            id: "abandoned",
            durationMinutes: 30,
            executionSlices: [{ id: "d", scheduledDate: day, status: "abandoned", completedAt: null, updatedAt: 4 }],
        });

        const items = [scheduled, earlyCompleted, missed, abandoned];
        expect(executionSliceRemainingByDate(items).get(day)).toEqual({ count: 1, minutes: 60, unestimatedCount: 0 });
        /* 总量口径不变：已安排 + 已完成 */
        expect(executionSliceLoadsByDate(items).get(day)).toEqual({ count: 2, minutes: 180, unestimatedCount: 0 });
    });

    it("当天全部提前完成时待做为 0，但总量仍保留承诺过的时长", () => {
        const day = "2026-09-10";
        const done = [
            item({ id: "one", durationMinutes: 150, executionSlices: [{ id: "a", scheduledDate: day, status: "completed", completedAt: 1, updatedAt: 1 }] }),
            item({ id: "two", durationMinutes: 150, executionSlices: [{ id: "b", scheduledDate: day, status: "completed", completedAt: 2, updatedAt: 2 }] }),
        ];
        /* 待做表里不再有这一天（没有已安排切片），展示层用 dayLoadValue 读成 0 */
        expect(executionSliceRemainingByDate(done).get(day)).toBeUndefined();
        expect(dayLoadValue(executionSliceRemainingByDate(done).get(day))).toMatchObject({ count: 0, minutes: 0 });
        expect(executionSliceLoadsByDate(done).get(day)).toEqual({ count: 2, minutes: 300, unestimatedCount: 0 });
    });

    it("待做按事务分开统计未估时，并忽略非事务条目", () => {
        const day = "2026-09-11";
        const estimated = item({ id: "e", durationMinutes: 30, executionSlices: [{ id: "a", scheduledDate: day, status: "scheduled", completedAt: null, updatedAt: 1 }] });
        const unestimated = item({ id: "u", durationMinutes: null, executionSlices: [{ id: "b", scheduledDate: day, status: "scheduled", completedAt: null, updatedAt: 2 }] });
        const project = item({ id: "p", type: "项目", durationMinutes: 90, executionSlices: [{ id: "c", scheduledDate: day, status: "scheduled", completedAt: null, updatedAt: 3 }] });

        expect(executionSliceRemainingByDate([estimated, unestimated, project]).get(day)).toEqual({ count: 2, minutes: 30, unestimatedCount: 1 });
        expect(executionSliceRemainingByDate([estimated, unestimated, project]).get("2026-09-12")).toBeUndefined();
    });

    it("把一天的负载整理成展示口径", () => {
        expect(dayLoadValue(undefined)).toMatchObject({ count: 0, minutes: 0, unestimatedOnly: false, atLeast: false });
        expect(dayLoadValue({ count: 2, minutes: 0, unestimatedCount: 2 })).toMatchObject({ unestimatedOnly: true, atLeast: false });
        expect(dayLoadValue({ count: 2, minutes: 60, unestimatedCount: 1 })).toMatchObject({ unestimatedOnly: false, atLeast: true });
        expect(dayLoadValue({ count: 2, minutes: 60, unestimatedCount: 0 })).toMatchObject({ unestimatedOnly: false, atLeast: false });
        expect(dayLoadValue({ count: 1, minutes: 0, unestimatedCount: 0 })).toMatchObject({ unestimatedOnly: false, atLeast: false });
    });

    it("按区间汇总待做、总量与已清空的日期", () => {
        const loads = new Map([
            ["2026-09-09", { count: 1, minutes: 60, unestimatedCount: 0 }],
            ["2026-09-10", { count: 3, minutes: 300, unestimatedCount: 0 }],
            ["2026-09-15", { count: 1, minutes: 90, unestimatedCount: 0 }],
            ["2026-10-02", { count: 1, minutes: 30, unestimatedCount: 0 }],
        ]);
        const remaining = new Map([
            ["2026-09-09", { count: 1, minutes: 60, unestimatedCount: 0 }],
            ["2026-09-10", { count: 0, minutes: 0, unestimatedCount: 0 }],
            ["2026-09-15", { count: 1, minutes: 0, unestimatedCount: 1 }],
            ["2026-10-02", { count: 1, minutes: 30, unestimatedCount: 0 }],
        ]);

        expect(summarizeDayLoads(loads, remaining, "2026-09-09", "2026-09-30")).toEqual({
            remainingMinutes: 60,
            totalMinutes: 450,
            clearedDates: ["2026-09-10"],
        });
    });
});
