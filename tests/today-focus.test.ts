import { describe, expect, it } from "vitest";
import { getTodayFocusCounts } from "../src/today-focus";
import { buildWorkItemTree } from "../src/tree";
import type { WorkItem } from "../src/work-items";

describe("层级浏览今日提示", () => {
    const today = new Date(2026, 8, 3, 12).getTime();
    const yesterday = new Date(2026, 8, 2, 12).getTime();
    const tomorrow = new Date(2026, 8, 4, 12).getTime();

    it("把今日开始、今日截止和跨越今日的未结束工作项汇总到上层路径", () => {
        const area = item({ id: "area", type: "长期领域" });
        const project = item({ id: "project", parentIds: [area.id] });
        const startsToday = item({ id: "start", parentIds: [project.id], planDate: today });
        const endsToday = item({ id: "end", parentIds: [project.id], deadline: today });
        const activeWindow = item({ id: "window", parentIds: [project.id], planDate: yesterday, deadline: tomorrow });
        const items = [area, project, startsToday, endsToday, activeWindow];

        const counts = getTodayFocusCounts(items, buildWorkItemTree(items), today);

        expect(counts.get(area.id)).toBe(3);
        expect(counts.get(project.id)).toBe(3);
        expect(counts.get(startsToday.id)).toBe(1);
        expect(counts.get(endsToday.id)).toBe(1);
        expect(counts.get(activeWindow.id)).toBe(1);
    });

    it("不把已结束或只有过去开始日的工作项标记为今日", () => {
        const past = item({ id: "past", planDate: yesterday });
        const closed = item({ id: "closed", status: "已完成", planDate: today });
        const items = [past, closed];

        expect(getTodayFocusCounts(items, buildWorkItemTree(items), today).size).toBe(0);
    });
});

function item(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "item", rowId: overrides.id ?? "item", title: "工作项", documentId: null, detached: true,
        type: "项目", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        hardPrerequisiteIds: [], softPrerequisiteIds: [], planDate: null, deadline: null, noDeadline: false,
        durationMinutes: null, energy: "", updatedAt: null,
        ...overrides,
    };
}
