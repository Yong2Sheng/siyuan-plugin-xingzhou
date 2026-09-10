import { describe, expect, it } from "vitest";
import {
    addStoredWorkItem,
    backupFileForRevision,
    createEmptyInternalStore,
    describeStoreMismatch,
    isAbsentInternalStore,
    migrateWorkItemData,
    parseInternalStore,
    removeStoredWorkItem,
    reorderStoredWorkItems,
    storesMatch,
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

    it("读取 v1 仓库时升级为 v2，并为旧事务补齐空的切片数据", () => {
        const migrated = parseInternalStore({
            version: 1, revision: 3, createdAt: 1, updatedAt: 2,
            items: [item({ id: "legacy-task", type: "事务", planDate: Date.now() })],
        });

        expect(migrated?.version).toBe(2);
        expect(migrated?.items[0]).toMatchObject({ sliceTargetCount: null, executionSlices: [] });
        expect(migrated?.items[0].planDate).not.toBeNull();
    });

    it("可在内部仓库更新全部详情字段和依赖，并增加修订号", () => {
        const store = migrateWorkItemData(data([item({ id: "task" })]), 1000);
        const next = updateStoredWorkItem(store, "task", {
            title: "新版名称", type: "事务", status: "进行中", currentAction: "执行", nextAction: "复核",
            parent: "parent", topProject: "top", hardPrerequisites: ["hard", "hard"], softPrerequisites: ["soft"],
            completedDates: ["2026-09-03", "无效日期", "2026-09-03"],
            planDate: "2026-09-03", deadline: "2026-09-10", noDeadline: false, duration: 45, energy: "高",
        }, 2000);

        expect(next.revision).toBe(store.revision + 1);
        expect(next.items[0]).toMatchObject({
            title: "新版名称", type: "事务", status: "进行中", currentAction: "执行", nextAction: "复核",
            parentIds: ["parent"], topProjectIds: ["top"], hardPrerequisiteIds: ["hard"], softPrerequisiteIds: ["soft"],
            completedDates: ["2026-09-03"],
            noDeadline: false, durationMinutes: 45, energy: "高", updatedAt: 2000,
        });
        expect(next.items[0].planDate).toBe(new Date("2026-09-03T00:00:00").getTime());
    });

    it("更换直接上层时把工作项放到新同级组末尾", () => {
        const store = migrateWorkItemData(data([
            item({ id: "old-parent", title: "旧项目" }),
            item({ id: "new-parent", title: "新项目" }),
            item({ id: "moved", title: "移动项", parentIds: ["old-parent"], sortOrder: 0 }),
            item({ id: "existing", title: "已有项", parentIds: ["new-parent"], sortOrder: 0 }),
        ]), 1000);
        const next = updateStoredWorkItem(store, "moved", { parent: "new-parent" }, 2000);
        const newSiblings = next.items.filter((entry) => entry.parentIds[0] === "new-parent")
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        expect(newSiblings.map((entry) => entry.id)).toEqual(["existing", "moved"]);
    });

    it("新增工作项默认进入待开始，并支持带上下文创建", () => {
        const store = migrateWorkItemData(data([]), 1000);
        const next = addStoredWorkItem(store, "  新想法  ", "new-id", {
            type: "想法", status: "进行中", parentId: "parent", topProjectId: "top",
        }, 2000);

        expect(next.items[0]).toMatchObject({
            id: "new-id", rowId: "new-id", title: "新想法", type: "想法", status: "进行中",
            detached: true, parentIds: ["parent"], topProjectIds: ["top"],
            hardPrerequisiteIds: [], softPrerequisiteIds: [],
        });
        expect(addStoredWorkItem(store, "默认条目", "default-id", {}, 2000).items[0].status).toBe("待开始");
    });

    it("新增工作项排在同级末尾，且可原子保存完整同级顺序", () => {
        const store = migrateWorkItemData(data([
            item({ id: "parent", title: "项目" }),
            item({ id: "second", title: "第二章", parentIds: ["parent"] }),
            item({ id: "first", title: "第一章", parentIds: ["parent"] }),
        ]), 1000);
        const added = addStoredWorkItem(store, "第三章", "third", { parentId: "parent" }, 1500);
        expect(added.items.find((entry) => entry.id === "third")?.status).toBe("待开始");
        expect(added.items.filter((entry) => entry.parentIds[0] === "parent")
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map((entry) => entry.id)).toEqual(["second", "first", "third"]);

        const reordered = reorderStoredWorkItems(added, "parent", ["first", "third", "second"], 2000);
        expect(reordered.revision).toBe(added.revision + 1);
        expect(reordered.items.filter((entry) => entry.parentIds[0] === "parent")
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map((entry) => entry.id)).toEqual(["first", "third", "second"]);
        expect(() => reorderStoredWorkItems(added, "parent", ["first", "second"], 2000))
            .toThrow("同级工作项已发生变化");
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

describe("写后复核：新建与修改对象必须与重新解析的结果一致", () => {
    it("新建条目后序列化再解析完全一致（新增字段不能只加在解析器上）", () => {
        const store = addStoredWorkItem(createEmptyInternalStore(1000), "测试图片清理", "item-new", { type: "事务", parentId: "parent" }, 2000);
        const roundTrip = parseInternalStore(JSON.parse(JSON.stringify(store)));
        expect(roundTrip).not.toBeNull();
        expect(storesMatch(store, roundTrip!)).toBe(true);
        expect(describeStoreMismatch(store, roundTrip!)).toBe("");
        // 新建对象必须显式带上图片清理字段，否则写入与读取不一致会拦下所有新建
        expect(store.items[0].imageCleanup).toBeNull();
    });

    it("修改条目（含图片登记）后序列化再解析完全一致", () => {
        const store = addStoredWorkItem(createEmptyInternalStore(1000), "条目", "item-1", { type: "事务" }, 2000);
        const updated = updateStoredWorkItem(store, "item-1", {
            currentAction: "看这张\n![](assets/xz-a.png)",
            imageCleanup: { startedAt: 5000, paths: ["assets/xz-a.png"] },
        }, 3000);
        const roundTrip = parseInternalStore(JSON.parse(JSON.stringify(updated)));
        expect(storesMatch(updated, roundTrip!)).toBe(true);

        const cleared = updateStoredWorkItem(updated, "item-1", { imageCleanup: null }, 4000);
        const clearedRoundTrip = parseInternalStore(JSON.parse(JSON.stringify(cleared)));
        expect(storesMatch(cleared, clearedRoundTrip!)).toBe(true);
        expect(cleared.items[0].imageCleanup).toBeNull();
    });

    it("差异描述能指出首个不一致位置", () => {
        const store = createEmptyInternalStore(1000);
        const other = { ...store, revision: 99 };
        expect(describeStoreMismatch(store, other)).toContain("不一致");
        expect(describeStoreMismatch(store, store)).toBe("");
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
