import { describe, expect, it } from "vitest";
import { buildWorkItemTree } from "../src/tree";
import { parseViewState, parseViewStateFile, wrapViewStateFile, pickFallbackTransaction } from "../src/ui-state";
import type { WorkItem, WorkItemViewState } from "../src/work-items";

function viewState(overrides: Partial<WorkItemViewState> = {}): WorkItemViewState {
    return {
        page: "all",
        filter: "active",
        includeClosed: false,
        scope: "all",
        selectedId: null,
        expandedIds: [],
        weekStart: 1_700_000_000_000,
        sidebarScrollTop: 0,
        treeScrollTop: 0,
        detailScrollTop: 0,
        ...overrides,
    };
}

function item(overrides: Partial<WorkItem> & { id: string; title: string }): WorkItem {
    return {
        rowId: overrides.id,
        documentId: null,
        detached: true,
        type: "事务",
        status: "进行中",
        currentAction: "",
        nextAction: "",
        parentIds: [],
        topProjectIds: [],
        hardPrerequisiteIds: [],
        softPrerequisiteIds: [],
        completedDates: [],
        planDate: null,
        deadline: null,
        noDeadline: false,
        durationMinutes: null,
        energy: "",
        updatedAt: 1,
        sortOrder: null,
        ...overrides,
    };
}

function localKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("ui-state 视图状态解析", () => {
    it("识别完整有效的视图状态", () => {
        const state = parseViewState({
            page: "all",
            filter: "active",
            includeClosed: false,
            scope: "all",
            selectedId: "t1",
            expandedIds: ["p1", "t1"],
            weekStart: 1_700_000_000_000,
            sidebarScrollTop: 10,
            treeScrollTop: 20,
            detailScrollTop: 30,
        });
        expect(state).toMatchObject({
            page: "all",
            filter: "active",
            selectedId: "t1",
            expandedIds: ["p1", "t1"],
            weekStart: 1_700_000_000_000,
            sidebarScrollTop: 10,
            treeScrollTop: 20,
            detailScrollTop: 30,
        });
    });

    it("缺失的可选字段使用默认值", () => {
        const state = parseViewState({ page: "all", filter: "all" });
        expect(state?.includeClosed).toBe(false);
        expect(state?.scope).toBe("all");
        expect(state?.selectedId).toBeNull();
        expect(state?.expandedIds).toEqual([]);
        expect(typeof state?.weekStart).toBe("number");
        expect(state?.sidebarScrollTop).toBe(0);
        expect(state?.treeScrollTop).toBe(0);
    });

    it("关键字段非法时整体拒绝", () => {
        expect(parseViewState(null)).toBeNull();
        expect(parseViewState("x")).toBeNull();
        expect(parseViewState({})).toBeNull();
        expect(parseViewState({ page: "nope", filter: "all" })).toBeNull();
        expect(parseViewState({ page: "all", filter: "nope" })).toBeNull();
        expect(parseViewState({ page: "all", filter: "all", selectedId: 123 })?.selectedId).toBeNull();
    });

    it("expandedIds 去重并过滤非法项", () => {
        const state = parseViewState({ page: "all", filter: "all", expandedIds: ["a", "a", 5, "b", null] });
        expect(state?.expandedIds).toEqual(["a", "b"]);
    });
});

describe("ui-state 落盘文件读写", () => {
    it("wrapViewStateFile 使用版本包装结构", () => {
        const wrapped = wrapViewStateFile(viewState({ selectedId: "t1" }));
        expect(wrapped.version).toBe(1);
        expect(wrapped.projectViewState.selectedId).toBe("t1");
    });

    it("保存→读取往返保留点选的 selectedId（对象形式）", () => {
        const saved = viewState({
            page: "all",
            filter: "all",
            selectedId: "20260909175010-9374ncs",
            expandedIds: ["p1", "t1"],
            treeScrollTop: 42,
        });
        const file = wrapViewStateFile(saved);
        const restored = parseViewStateFile(file);
        expect(restored).toMatchObject({
            page: "all",
            filter: "all",
            selectedId: "20260909175010-9374ncs",
            expandedIds: ["p1", "t1"],
            treeScrollTop: 42,
        });
    });

    it("保存→读取往返保留点选的 selectedId（JSON 字符串形式）", () => {
        const saved = viewState({ selectedId: "20260909175010-9374ncs" });
        const restored = parseViewStateFile(JSON.stringify(wrapViewStateFile(saved)));
        expect(restored?.selectedId).toBe("20260909175010-9374ncs");
        expect(restored?.page).toBe("all");
    });

    it("兼容无版本包装的裸状态对象", () => {
        const restored = parseViewStateFile(viewState({ selectedId: "t9" }));
        expect(restored?.selectedId).toBe("t9");
    });

    it("损坏、空内容或非法包装时整体拒绝", () => {
        expect(parseViewStateFile(null)).toBeNull();
        expect(parseViewStateFile(undefined)).toBeNull();
        expect(parseViewStateFile("")).toBeNull();
        expect(parseViewStateFile("{oops")).toBeNull();
        expect(parseViewStateFile({ version: 1, projectViewState: { page: "nope", filter: "all" } })).toBeNull();
        expect(parseViewStateFile({ version: 1, projectViewState: "x" })).toBeNull();
        expect(parseViewStateFile([1, 2])).toBeNull();
    });
});

describe("pickFallbackTransaction 确定性回落", () => {
    const todayKey = localKey(new Date());

    function treeOf(items: WorkItem[]) {
        return buildWorkItemTree(items);
    }

    it("优先今日未完成切片数最多的事务（并列按树显示顺序）", () => {
        const items = [
            item({ id: "t3", title: "丙", executionSlices: [] }),
            item({ id: "t2", title: "乙", executionSlices: [{ id: "s2", scheduledDate: todayKey, status: "scheduled", completedAt: null, updatedAt: 1 }] }),
            item({ id: "t1", title: "甲", executionSlices: [
                { id: "s1a", scheduledDate: todayKey, status: "scheduled", completedAt: null, updatedAt: 1 },
                { id: "s1b", scheduledDate: todayKey, status: "scheduled", completedAt: null, updatedAt: 2 },
            ] }),
        ];
        const tree = treeOf(items);
        const visible = new Set(items.map((entry) => entry.id));
        expect(pickFallbackTransaction(items, tree, visible, new Date().getTime())).toBe("t1");
    });

    it("并列时取树显示顺序第一个（层级浏览从上往下）", () => {
        const items = [
            item({ id: "t1", title: "甲", sortOrder: 0, executionSlices: [{ id: "s1", scheduledDate: todayKey, status: "scheduled", completedAt: null, updatedAt: 1 }] }),
            item({ id: "t2", title: "乙", sortOrder: 1, executionSlices: [{ id: "s2", scheduledDate: todayKey, status: "scheduled", completedAt: null, updatedAt: 1 }] }),
        ];
        const tree = treeOf(items);
        // sortOrder 0 的「甲」位于更上方
        expect(pickFallbackTransaction(items, tree, new Set(items.map((entry) => entry.id)), new Date().getTime())).toBe("t1");
    });

    it("今日没有未完成切片时，取可见事务中树显示顺序第一个", () => {
        const items = [
            item({ id: "t1", title: "甲", sortOrder: 0, executionSlices: [] }),
            item({ id: "t2", title: "乙", sortOrder: 1, executionSlices: [] }),
        ];
        const tree = treeOf(items);
        expect(pickFallbackTransaction(items, tree, new Set(items.map((entry) => entry.id)), new Date().getTime())).toBe("t1");
    });

    it("跳过已完成事务、非事务与不可见项", () => {
        const items = [
            item({ id: "t1", title: "事务甲", executionSlices: [], status: "已完成" }),
            item({ id: "t2", title: "事务乙", executionSlices: [] }),
            item({ id: "p1", title: "项目甲", type: "项目", executionSlices: [] }),
        ];
        const tree = treeOf(items);
        expect(pickFallbackTransaction(items, tree, new Set(["t2"]), new Date().getTime())).toBe("t2");
    });

    it("没有可见事务时返回 null", () => {
        const items = [item({ id: "t1", title: "甲", executionSlices: [] })];
        expect(pickFallbackTransaction(items, treeOf(items), new Set(), new Date().getTime())).toBeNull();
    });
});
