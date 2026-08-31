import { describe, expect, it } from "vitest";
import { getAutomaticHierarchyStatusChanges } from "../src/status-hierarchy";
import type { WorkItem } from "../src/work-items";

describe("层级状态自动推进", () => {
    it("进行中的任意后代会推进项目祖先，但不会改变长期领域", () => {
        const domain = item("domain", "长期领域", "重点投入");
        const top = item("top", "项目", "收件箱", [domain.id]);
        const child = item("child", "项目", "待开始", [top.id]);
        const action = item("action", "事务", "进行中", [child.id]);

        expect(getAutomaticHierarchyStatusChanges([domain, top, child, action])).toEqual(expect.arrayContaining([
            { rowId: "top", status: "进行中" },
            { rowId: "child", status: "进行中" },
        ]));
        expect(getAutomaticHierarchyStatusChanges([domain, top, child, action])).not.toContainEqual({ rowId: "domain", status: "进行中" });
    });

    it("不覆盖明确状态，也不因下级停止而自动倒退", () => {
        const top = item("top", "项目", "待开始");
        const paused = item("paused", "项目", "暂停", [top.id]);
        const action = item("action", "事务", "进行中", [paused.id]);
        const running = item("running", "项目", "进行中");
        const doneChild = item("done", "事务", "已完成", [running.id]);
        const changes = getAutomaticHierarchyStatusChanges([top, paused, action, running, doneChild]);

        expect(changes).toContainEqual({ rowId: "top", status: "进行中" });
        expect(changes).not.toContainEqual(expect.objectContaining({ rowId: "paused" }));
        expect(changes).not.toContainEqual(expect.objectContaining({ rowId: "running" }));
    });

    it("已分类且已有上层的收件箱条目转为待开始，独立根条目仍留在收件箱等待确认", () => {
        const parent = item("parent", "项目", "待开始");
        const organized = item("organized", "事务", "收件箱", [parent.id]);
        const root = item("root", "事务", "收件箱");

        expect(getAutomaticHierarchyStatusChanges([parent, organized, root])).toContainEqual({ rowId: "organized", status: "待开始" });
        expect(getAutomaticHierarchyStatusChanges([parent, organized, root])).not.toContainEqual(expect.objectContaining({ rowId: "root" }));
    });
});

function item(id: string, type: string, status: string, parentIds: string[] = []): WorkItem {
    return {
        id, rowId: id, title: id, documentId: null, detached: true, type, status,
        currentAction: "", nextAction: "", parentIds, topProjectIds: [], planDate: null,
        deadline: null, noDeadline: false, durationMinutes: null, energy: "", updatedAt: null,
    };
}
