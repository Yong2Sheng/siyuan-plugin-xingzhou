import { describe, expect, it } from "vitest";
import { groupWeekOccurrences, isWeekOccurrenceCompact, weekOccurrenceLabel } from "../src/week-schedule";
import type { WorkItem } from "../src/work-items";

function localDate(year: number, month: number, day: number): number {
    return new Date(year, month - 1, day).getTime();
}

function item(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "item", rowId: "item", title: "执行事务", documentId: null, detached: true,
        type: "事务", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        planDate: localDate(2026, 9, 1), deadline: localDate(2026, 9, 10), noDeadline: false,
        durationMinutes: 30, energy: "中", updatedAt: null, sliceTargetCount: 3,
        executionSlices: [
            { id: "first", scheduledDate: "2026-09-01", status: "completed", completedAt: localDate(2026, 9, 1), updatedAt: 1 },
            { id: "second", scheduledDate: "2026-09-03", status: "scheduled", completedAt: null, updatedAt: 2 },
            { id: "failed", scheduledDate: "2026-09-05", status: "abandoned", completedAt: null, updatedAt: 3 },
        ],
        ...overrides,
    };
}

describe("本周执行切片安排", () => {
    it("事务只投影明确安排的执行切片，不再展开开始日至截止日", () => {
        const grouped = groupWeekOccurrences([item()], localDate(2026, 8, 31));

        expect([...grouped.keys()]).toEqual(["2026-09-01", "2026-09-03", "2026-09-05"]);
        expect([...grouped.values()].flat().every(({ phase }) => phase === "slice")).toBe(true);
        expect(grouped.get("2026-09-03")?.[0].slice?.status).toBe("scheduled");
        expect(grouped.get("2026-09-02")).toBeUndefined();
    });

    it("已完成事务仍保留真实切片历史，周外切片不出现", () => {
        const grouped = groupWeekOccurrences([item({
            status: "已完成",
            executionSlices: [
                { id: "inside", scheduledDate: "2026-09-02", status: "completed", completedAt: 10, updatedAt: 10 },
                { id: "outside", scheduledDate: "2026-09-09", status: "completed", completedAt: 20, updatedAt: 20 },
            ],
        })], localDate(2026, 8, 31));

        expect([...grouped.keys()]).toEqual(["2026-09-02"]);
        expect(grouped.get("2026-09-02")?.[0].slice?.id).toBe("inside");
    });

    it("非事务仍保留单日与日期区间投影", () => {
        const idea = item({ id: "idea", type: "想法", title: "整理想法", executionSlices: [], planDate: localDate(2026, 9, 1), deadline: localDate(2026, 9, 3) });
        const grouped = groupWeekOccurrences([idea], localDate(2026, 8, 31));

        expect(grouped.get("2026-09-01")?.[0].phase).toBe("start");
        expect(grouped.get("2026-09-02")?.[0].phase).toBe("ongoing");
        expect(grouped.get("2026-09-03")?.[0].phase).toBe("deadline");
    });

    it("提供切片文案且切片卡片不折叠", () => {
        expect(weekOccurrenceLabel("slice")).toBe("执行切片");
        expect(isWeekOccurrenceCompact("slice")).toBe(false);
        expect(weekOccurrenceLabel("carry-in")).toBe("承接上周");
    });
});
