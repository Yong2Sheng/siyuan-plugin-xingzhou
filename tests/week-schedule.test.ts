import { describe, expect, it } from "vitest";
import { groupWeekOccurrences, weekOccurrenceLabel } from "../src/week-schedule";
import type { WorkItem } from "../src/work-items";

function localDate(year: number, month: number, day: number): number {
    return new Date(year, month - 1, day).getTime();
}

function item(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "item", rowId: "item", title: "区间工作项", documentId: null, detached: true,
        type: "事务", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        planDate: localDate(2026, 9, 1), deadline: localDate(2026, 9, 10), noDeadline: false,
        durationMinutes: 30, energy: "中", updatedAt: null,
        ...overrides,
    };
}

describe("本周区间安排", () => {
    it("把开始日至截止日投影到本周，并标出开始与跨周延续", () => {
        const grouped = groupWeekOccurrences([item()], localDate(2026, 8, 31));

        expect(grouped.get("2026-08-31")).toBeUndefined();
        expect(grouped.get("2026-09-01")?.[0].phase).toBe("start");
        expect(grouped.get("2026-09-02")?.[0].phase).toBe("ongoing");
        expect(grouped.get("2026-09-06")?.[0].phase).toBe("carry-out");
        expect([...grouped.values()].flat()).toHaveLength(6);
    });

    it("下一周显示承接、持续与真正的截止日", () => {
        const grouped = groupWeekOccurrences([item()], localDate(2026, 9, 7));

        expect(grouped.get("2026-09-07")?.[0].phase).toBe("carry-in");
        expect(grouped.get("2026-09-08")?.[0].phase).toBe("ongoing");
        expect(grouped.get("2026-09-10")?.[0].phase).toBe("deadline");
        expect(grouped.get("2026-09-11")).toBeUndefined();
    });

    it("没有有效区间时仍只显示在开始日，已结束项目不显示", () => {
        const single = item({ id: "single", title: "单日事项", deadline: null });
        const invalid = item({ id: "invalid", title: "错误区间", deadline: localDate(2026, 8, 30) });
        const closed = item({ id: "closed", title: "已完成事项", status: "已完成" });
        const grouped = groupWeekOccurrences([single, invalid, closed], localDate(2026, 8, 31));

        expect(grouped.get("2026-09-01")?.map(({ item, phase }) => [item.id, phase]).sort()).toEqual([
            ["invalid", "single"],
            ["single", "single"],
        ]);
        expect([...grouped.values()].flat().some(({ item }) => item.id === "closed")).toBe(false);
    });

    it("整体结束后仍保留已经逐日完成的历史日期", () => {
        const closed = item({
            id: "closed-with-history",
            status: "已完成",
            planDate: localDate(2026, 9, 1),
            deadline: localDate(2026, 9, 4),
            completedDates: ["2026-09-02"],
        });
        const grouped = groupWeekOccurrences([closed], localDate(2026, 8, 31));

        expect([...grouped.entries()].map(([date, occurrences]) => [date, occurrences.map(({ item }) => item.id)]))
            .toEqual([["2026-09-02", ["closed-with-history"]]]);
    });

    it("提供清晰的阶段文案", () => {
        expect(weekOccurrenceLabel("single")).toBe("当日");
        expect(weekOccurrenceLabel("start")).toBe("开始");
        expect(weekOccurrenceLabel("ongoing")).toBe("持续中");
        expect(weekOccurrenceLabel("deadline")).toBe("截止");
        expect(weekOccurrenceLabel("carry-in")).toBe("承接上周");
        expect(weekOccurrenceLabel("carry-out")).toBe("延续下周");
    });
});
