import { describe, expect, it } from "vitest";
import {
    addStoredWorkItem,
    backupFileForRevision,
    isAbsentInternalStore,
    migrateWorkItemData,
    parseInternalStore,
    removeStoredWorkItem,
    toInternalWorkItemData,
    updateStoredWorkItem,
} from "../src/internal-store";
import type { WorkItem, WorkItemData } from "../src/work-items";

describe("行舟内部工作项仓库", () => {
    it("把思源对不存在插件数据文件返回的空对象识别为首次启动", () => {
        expect(isAbsentInternalStore({})).toBe(true);
        expect(isAbsentInternalStore(null)).toBe(true);
        expect(isAbsentInternalStore({ version: 1 })).toBe(false);
        expect(isAbsentInternalStore([])).toBe(false);
    });

    it("一次性迁移会完整保留工作项、文档关联、层级和跨项目依赖", () => {
        const source = data([
            item({ id: "area", title: "地图制作学习", documentId: "doc-area", detached: false, type: "长期领域" }),
            item({ id: "learning", title: "Azgaar 使用学习", parentIds: ["area"], topProjectIds: ["learning"] }),
            item({ id: "design", title: "恶魔的尾巴小说地图设计", softPrerequisiteIds: ["learning"], currentAction: "先画大陆轮廓" }),
        ]);

        const store = migrateWorkItemData(source, 1000);
        expect(store.migration).toEqual({ source: "attribute-view", sourceId: "legacy-av", importedAt: 1000, itemCount: 3 });
        expect(store.items).toHaveLength(3);
        expect(store.items[0]).toMatchObject({ documentId: "doc-area", detached: false });
        expect(store.items[1]).toMatchObject({ parentIds: ["area"], topProjectIds: ["learning"] });
        expect(store.items[2]).toMatchObject({ softPrerequisiteIds: ["learning"], currentAction: "先画大陆轮廓" });
        expect(toInternalWorkItemData(store)).toMatchObject({ attributeViewId: "xingzhou-internal", missingFields: [] });
    });

    it("拒绝损坏版本和重复 ID，避免静默覆盖内部数据", () => {
        expect(parseInternalStore({ version: 99, items: [] })).toBeNull();
        expect(parseInternalStore({
            version: 1, revision: 1, createdAt: 1, updatedAt: 1,
            items: [item({ id: "same" }), item({ id: "same", title: "重复" })],
        })).toBeNull();
    });

    it("可在内部仓库更新全部详情字段和依赖，并增加修订号", () => {
        const store = migrateWorkItemData(data([item({ id: "task" })]), 1000);
        const next = updateStoredWorkItem(store, "task", {
            title: "新版名称", type: "事务", status: "进行中", currentAction: "执行", nextAction: "复核",
            parent: "parent", topProject: "top", hardPrerequisites: ["hard", "hard"], softPrerequisites: ["soft"],
            planDate: "2026-09-03", deadline: "2026-09-10", noDeadline: false, duration: 45, energy: "高",
        }, 2000);

        expect(next.revision).toBe(store.revision + 1);
        expect(next.items[0]).toMatchObject({
            title: "新版名称", type: "事务", status: "进行中", currentAction: "执行", nextAction: "复核",
            parentIds: ["parent"], topProjectIds: ["top"], hardPrerequisiteIds: ["hard"], softPrerequisiteIds: ["soft"],
            noDeadline: false, durationMinutes: 45, energy: "高", updatedAt: 2000,
        });
        expect(next.items[0].planDate).toBe(new Date("2026-09-03T00:00:00").getTime());
    });

    it("新增工作项直接进入内部收件箱，并支持带上下文创建", () => {
        const store = migrateWorkItemData(data([]), 1000);
        const next = addStoredWorkItem(store, "  新想法  ", "new-id", {
            type: "想法", status: "进行中", parentId: "parent", topProjectId: "top",
        }, 2000);

        expect(next.items[0]).toMatchObject({
            id: "new-id", rowId: "new-id", title: "新想法", type: "想法", status: "进行中",
            detached: true, parentIds: ["parent"], topProjectIds: ["top"],
            hardPrerequisiteIds: [], softPrerequisiteIds: [],
        });
    });

    it("删除工作项时保留下级，并自动清除所有指向它的关系", () => {
        const store = migrateWorkItemData(data([
            item({ id: "gone", title: "待删除" }),
            item({ id: "child", parentIds: ["gone"], topProjectIds: ["gone"], hardPrerequisiteIds: ["gone"], softPrerequisiteIds: ["gone"] }),
        ]), 1000);
        const next = removeStoredWorkItem(store, "gone", 2000);

        expect(next.items.map((entry) => entry.id)).toEqual(["child"]);
        expect(next.items[0]).toMatchObject({ parentIds: [], topProjectIds: [], hardPrerequisiteIds: [], softPrerequisiteIds: [] });
    });

    it("将连续修订轮换到三个内部备份文件", () => {
        expect([1, 2, 3, 4, 5, 6].map(backupFileForRevision)).toEqual([
            "work-items.backup-1.json", "work-items.backup-2.json", "work-items.backup-3.json",
            "work-items.backup-1.json", "work-items.backup-2.json", "work-items.backup-3.json",
        ]);
    });
});

function data(items: WorkItem[]): WorkItemData {
    return { attributeViewId: "legacy-av", attributeViewName: "旧数据", viewId: "all", items, missingFields: [], fields: {} };
}

function item(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "item", rowId: overrides.id ?? "item", title: "工作项", documentId: null, detached: true,
        type: "项目", status: "待开始", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        hardPrerequisiteIds: [], softPrerequisiteIds: [], planDate: null, deadline: null, noDeadline: false,
        durationMinutes: null, energy: "", updatedAt: null,
        ...overrides,
    };
}
