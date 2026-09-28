import { describe, expect, it } from "vitest";
import { buildWorkItemTree, collectRepeatSiblingIds, countItemDescendants, REPEAT_SIBLING_MIN } from "../src/tree";
import type { WorkItem } from "../src/work-items";

describe("层级浏览连续同值行", () => {
    it("同一父下连续三行切片计划与状态一致时，这三行都被标记", () => {
        const parent = item({ id: "parent", type: "项目" });
        const rows = [
            transaction({ id: "a", parentIds: [parent.id], status: "待开始" }),
            transaction({ id: "b", parentIds: [parent.id], status: "待开始" }),
            transaction({ id: "c", parentIds: [parent.id], status: "待开始" }),
        ];

        const repeats = collectRepeatSiblingIds(buildWorkItemTree([parent, ...rows]));

        expect(REPEAT_SIBLING_MIN).toBe(3);
        expect([...repeats].sort()).toEqual(["a", "b", "c"]);
    });

    it("只有两行相同时不标记：两行相同是常态，不值得淡化", () => {
        const parent = item({ id: "parent", type: "项目" });
        const rows = [
            transaction({ id: "a", parentIds: [parent.id], status: "待开始" }),
            transaction({ id: "b", parentIds: [parent.id], status: "待开始" }),
        ];

        expect(collectRepeatSiblingIds(buildWorkItemTree([parent, ...rows])).size).toBe(0);
    });

    it("状态或切片计划不同就断开，只标记真正连成一段的行", () => {
        const parent = item({ id: "parent", type: "项目" });
        const rows = [
            transaction({ id: "a", parentIds: [parent.id], status: "待开始" }),
            transaction({ id: "b", parentIds: [parent.id], status: "待开始" }),
            transaction({ id: "c", parentIds: [parent.id], status: "进行中" }),
            transaction({ id: "d", parentIds: [parent.id], status: "待开始" }),
            transaction({ id: "e", parentIds: [parent.id], status: "待开始" }),
            transaction({ id: "f", parentIds: [parent.id], status: "待开始" }),
        ];

        expect([...collectRepeatSiblingIds(buildWorkItemTree([parent, ...rows]))].sort()).toEqual(["d", "e", "f"]);
    });

    it("同值判定限定在同一个父之下，不跨父连段", () => {
        const first = item({ id: "first", type: "项目" });
        const second = item({ id: "second", type: "项目" });
        const items = [
            first,
            second,
            transaction({ id: "a", parentIds: [first.id], status: "待开始" }),
            transaction({ id: "b", parentIds: [first.id], status: "待开始" }),
            transaction({ id: "c", parentIds: [second.id], status: "待开始" }),
            transaction({ id: "d", parentIds: [second.id], status: "待开始" }),
        ];

        expect(collectRepeatSiblingIds(buildWorkItemTree(items)).size).toBe(0);
    });

    it("今日行既不参与同值段，也会把前后两段断开", () => {
        const parent = item({ id: "parent", type: "项目" });
        const rows = [
            transaction({ id: "a", parentIds: [parent.id], status: "待开始" }),
            transaction({ id: "b", parentIds: [parent.id], status: "待开始" }),
            transaction({ id: "today", parentIds: [parent.id], status: "待开始" }),
            transaction({ id: "c", parentIds: [parent.id], status: "待开始" }),
            transaction({ id: "d", parentIds: [parent.id], status: "待开始" }),
        ];
        const todayFocusCounts = new Map([["today", 2]]);

        const repeats = collectRepeatSiblingIds(buildWorkItemTree([parent, ...rows]), todayFocusCounts);

        expect(repeats.has("today")).toBe(false);
        expect(repeats.size).toBe(0);
    });

    it("顶层兄弟之间同样适用", () => {
        const rows = [
            transaction({ id: "a", status: "暂停" }),
            transaction({ id: "b", status: "暂停" }),
            transaction({ id: "c", status: "暂停" }),
        ];

        expect([...collectRepeatSiblingIds(buildWorkItemTree(rows))].sort()).toEqual(["a", "b", "c"]);
    });

    it("切片计划不同（例如未设切片与待安排）不算同值", () => {
        const parent = item({ id: "parent", type: "项目" });
        const rows = [
            transaction({ id: "a", parentIds: [parent.id], status: "待开始" }),
            transaction({ id: "b", parentIds: [parent.id], status: "待开始", sliceTargetCount: 5 }),
            transaction({ id: "c", parentIds: [parent.id], status: "待开始" }),
        ];

        expect(collectRepeatSiblingIds(buildWorkItemTree([parent, ...rows])).size).toBe(0);
    });
});

describe("层级浏览折叠计数", () => {
    it("分别数出项目与非项目后代，并贯穿多层", () => {
        const domain = item({ id: "domain", type: "长期领域" });
        const project = item({ id: "project", type: "项目", parentIds: [domain.id] });
        const subproject = item({ id: "subproject", type: "项目", parentIds: [project.id] });
        const items = [
            domain,
            project,
            subproject,
            transaction({ id: "t1", parentIds: [project.id] }),
            transaction({ id: "t2", parentIds: [subproject.id] }),
            item({ id: "idea", type: "想法", parentIds: [project.id] }),
        ];

        expect(countItemDescendants(domain.id, buildWorkItemTree(items))).toEqual({ projects: 2, transactions: 3 });
        expect(countItemDescendants(project.id, buildWorkItemTree(items))).toEqual({ projects: 1, transactions: 3 });
        expect(countItemDescendants("t1", buildWorkItemTree(items))).toEqual({ projects: 0, transactions: 0 });
    });

    it("只数当前筛选下可见的后代，避免「今日」筛选里的数字与展开后对不上", () => {
        const domain = item({ id: "domain", type: "长期领域" });
        const project = item({ id: "project", type: "项目", parentIds: [domain.id] });
        const items = [
            domain,
            project,
            transaction({ id: "shown", parentIds: [project.id] }),
            transaction({ id: "hidden", parentIds: [project.id] }),
        ];
        const visibleIds = new Set([domain.id, project.id, "shown"]);

        expect(countItemDescendants(domain.id, buildWorkItemTree(items), visibleIds)).toEqual({ projects: 1, transactions: 1 });
        // 不可见节点的整棵子树一起跳过
        const hiddenParentVisible = new Set([domain.id, project.id]);
        expect(countItemDescendants(domain.id, buildWorkItemTree(items), hiddenParentVisible)).toEqual({ projects: 1, transactions: 0 });
    });
});

function transaction(overrides: Partial<WorkItem> = {}): WorkItem {
    return item({ type: "事务", ...overrides });
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
