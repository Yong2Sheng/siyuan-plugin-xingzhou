import { describe, expect, it } from "vitest";
import { applyDependencyStorage, normalizeDependencyStorage, removeStoredItem, setStoredDependency } from "../src/dependency-storage";
import type { WorkItemData } from "../src/work-items";

describe("插件依赖存储", () => {
    const data: WorkItemData = {
        attributeViewId: "av-1", attributeViewName: "项目", viewId: "all", missingFields: [], fields: {},
        items: [{
            id: "map", rowId: "map", title: "小说地图设计", documentId: null, detached: true,
            type: "项目", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            hardPrerequisiteIds: [], softPrerequisiteIds: [], planDate: null, deadline: null, noDeadline: false,
            durationMinutes: null, energy: "", updatedAt: null,
        }],
    };

    it("不依赖属性视图字段即可保存并叠加到已有工作项", () => {
        const storage = setStoredDependency(normalizeDependencyStorage(null), "av-1", "map", {
            hard: ["outline"], soft: ["azgaar", "azgaar"],
        });
        const applied = applyDependencyStorage(data, storage);

        expect(applied.items[0]).toMatchObject({
            hardPrerequisiteIds: ["outline"],
            softPrerequisiteIds: ["azgaar"],
        });
        expect(applied.fields).toEqual({});
    });

    it("删除工作项时同时清理自身记录和其他工作项对它的引用", () => {
        let storage = setStoredDependency(normalizeDependencyStorage(null), "av-1", "map", { hard: [], soft: ["azgaar"] });
        storage = setStoredDependency(storage, "av-1", "azgaar", { hard: ["map"], soft: [] });
        storage = removeStoredItem(storage, "av-1", "azgaar");

        expect(storage.databases["av-1"]).toEqual({});
    });
});
