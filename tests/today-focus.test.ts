import { describe, expect, it } from "vitest";
import { getTodayFocusCounts } from "../src/today-focus";
import { buildWorkItemTree } from "../src/tree";
import type { WorkItem } from "../src/work-items";

describe("层级浏览今日提示", () => {
    const today = new Date(2026, 8, 3, 12).getTime();
    const yesterday = new Date(2026, 8, 2, 12).getTime();
    const tomorrow = new Date(2026, 8, 4, 12).getTime();

    it("不再把日期范围或上层路径当作层级浏览的今日切片提醒", () => {
        const area = item({ id: "area", type: "长期领域" });
        const project = item({ id: "project", parentIds: [area.id] });
        const startsToday = item({ id: "start", parentIds: [project.id], planDate: today });
        const endsToday = item({ id: "end", parentIds: [project.id], deadline: today });
        const activeWindow = item({ id: "window", parentIds: [project.id], planDate: yesterday, deadline: tomorrow });
        const items = [area, project, startsToday, endsToday, activeWindow];

        const counts = getTodayFocusCounts(items, buildWorkItemTree(items), today);

        expect(counts.size).toBe(0);
    });

    it("不把已结束或只有过去开始日的工作项标记为今日", () => {
        const past = item({ id: "past", planDate: yesterday });
        const closed = item({ id: "closed", status: "已完成", planDate: today });
        const items = [past, closed];

        expect(getTodayFocusCounts(items, buildWorkItemTree(items), today).size).toBe(0);
    });

    it("只给今天仍未完成切片的事务标记今日，不汇总到上层", () => {
        const project = item({ id: "project", executionSlices: [slice("scheduled", "2026-09-03")] });
        const scheduled = item({
            id: "scheduled",
            type: "事务",
            parentIds: [project.id],
            executionSlices: [slice("scheduled", "2026-09-03")],
        });
        const completed = item({
            id: "completed",
            type: "事务",
            parentIds: [project.id],
            executionSlices: [slice("completed", "2026-09-03")],
        });
        const items = [project, scheduled, completed];

        const counts = getTodayFocusCounts(items, buildWorkItemTree(items), today);

        expect(counts.has(project.id)).toBe(false);
        expect(counts.get(scheduled.id)).toBe(1);
        expect(counts.has(completed.id)).toBe(false);
    });

    it("不把其他日期、未完成或已放弃的切片标记为今日", () => {
        const future = item({ id: "future", type: "事务", executionSlices: [slice("scheduled", "2026-09-04")] });
        const missed = item({ id: "missed", type: "事务", executionSlices: [slice("missed", "2026-09-03")] });
        const abandoned = item({ id: "abandoned", type: "事务", executionSlices: [slice("abandoned", "2026-09-03")] });
        const closed = item({ id: "closed-slice", type: "事务", status: "已完成", executionSlices: [slice("completed", "2026-09-03")] });
        const items = [future, missed, abandoned, closed];

        expect(getTodayFocusCounts(items, buildWorkItemTree(items), today).size).toBe(0);
    });
});

function slice(status: "scheduled" | "completed" | "missed" | "abandoned", scheduledDate: string) {
    return { id: `${status}-${scheduledDate}`, scheduledDate, status, completedAt: status === "completed" ? 1 : null, updatedAt: 1 };
}

function item(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "item", rowId: overrides.id ?? "item", title: "工作项", documentId: null, detached: true,
        type: "项目", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        hardPrerequisiteIds: [], softPrerequisiteIds: [], planDate: null, deadline: null, noDeadline: false,
        durationMinutes: null, energy: "", updatedAt: null,
        ...overrides,
    };
}
