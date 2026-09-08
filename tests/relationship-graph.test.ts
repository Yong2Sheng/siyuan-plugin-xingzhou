import { describe, expect, it } from "vitest";
import { buildRelationshipGraph, graphStatusKind } from "../src/relationship-graph";
import type { WorkItem } from "../src/work-items";

function item(id: string, title: string, type: string, status: string, parentId = "", changes: Partial<WorkItem> = {}): WorkItem {
    return {
        id, rowId: id, title, documentId: null, detached: true, type, status,
        currentAction: "", nextAction: "", parentIds: parentId ? [parentId] : [], topProjectIds: [],
        hardPrerequisiteIds: [], softPrerequisiteIds: [], planDate: null, deadline: null, noDeadline: false,
        durationMinutes: null, energy: "", updatedAt: 1, ...changes,
    };
}

describe("未完成工作关系图", () => {
    const domain = item("domain", "长期领域", "长期领域", "已归档");
    const project = item("project", "进行中的项目", "项目", "进行中", domain.id);
    const waitingProject = item("waiting-project", "待开始项目", "项目", "待开始", domain.id);
    const first = item("first", "前置事务", "事务", "进行中", project.id);
    const second = item("second", "后续事务", "事务", "待开始", waitingProject.id, { hardPrerequisiteIds: [first.id] });
    const soft = item("soft", "并行事务", "事务", "进行中", project.id, { softPrerequisiteIds: [second.id] });
    const completed = item("completed", "已完成事务", "事务", "已完成", project.id);
    const items = [domain, project, waitingProject, first, second, soft, completed];

    it("默认显示未完成项目与事务，并补齐已结束的长期领域祖先", () => {
        const graph = buildRelationshipGraph(items);
        expect(graph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([domain.id, project.id, waitingProject.id, first.id, second.id, soft.id]));
        expect(graph.nodes.map((node) => node.id)).not.toContain(completed.id);
        expect(graph.nodes.find((node) => node.id === domain.id)?.contextOnly).toBe(true);
        expect(graph.domainCount).toBe(1);
        expect(graph.projectCount).toBe(2);
        expect(graph.transactionCount).toBe(3);
    });

    it("按正确方向生成上下层、完成后开始和需先行三类边", () => {
        const graph = buildRelationshipGraph(items);
        expect(graph.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "hierarchy", fromId: domain.id, toId: project.id }),
            expect.objectContaining({ kind: "hard", fromId: first.id, toId: second.id }),
            expect.objectContaining({ kind: "soft", fromId: second.id, toId: soft.id }),
        ]));
        expect(graph.width).toBeGreaterThan(900);
    });

    it("隐藏事务或筛选状态后仍保留命中项目的祖先链", () => {
        const projectsOnly = buildRelationshipGraph(items, { showTransactions: false });
        expect(projectsOnly.transactionCount).toBe(0);
        expect(projectsOnly.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([domain.id, project.id, waitingProject.id]));

        const ongoing = buildRelationshipGraph(items, { statusFilter: "ongoing" });
        expect(ongoing.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([domain.id, project.id, first.id, soft.id]));
        expect(ongoing.nodes.map((node) => node.id)).not.toContain(waitingProject.id);
        expect(ongoing.nodes.map((node) => node.id)).not.toContain(second.id);
    });

    it("兼容旧版进行中和待开始状态", () => {
        expect(graphStatusKind("活跃")).toBe("ongoing");
        expect(graphStatusKind("已计划")).toBe("pending");
        expect(graphStatusKind("阻塞")).toBe("blocked");
    });
});
