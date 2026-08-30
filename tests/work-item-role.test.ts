import { describe, expect, it } from "vitest";
import { buildWorkItemTree } from "../src/tree";
import { deriveTopProjectId, getWorkItemProfile, getWorkItemRole, needsDeadlineDecision } from "../src/work-item-role";
import type { WorkItem } from "../src/work-items";

describe("工作项角色", () => {
    it("根据直接上层区分顶层项目与子项目，并推导顶层项目", () => {
        const domain = item("domain", "写作", "长期领域");
        const top = item("top", "写小说", "项目", [domain.id]);
        const child = item("child", "世界观构建", "项目", [top.id]);
        const action = item("action", "整理贸易路线", "事务", [child.id]);
        const tree = buildWorkItemTree([domain, top, child, action]);

        expect(getWorkItemRole(top, tree)).toBe("topProject");
        expect(getWorkItemRole(child, tree)).toBe("subproject");
        expect(deriveTopProjectId(child.id, tree)).toBe(top.id);
        expect(deriveTopProjectId(action.parentIds[0], tree)).toBe(top.id);
    });

    it("长期领域隐藏执行字段，事务保留计划与成本字段", () => {
        const domain = item("domain", "写作", "长期领域");
        const action = item("action", "整理资料", "事务");
        const tree = buildWorkItemTree([domain, action]);

        expect(getWorkItemProfile(domain, tree)).toMatchObject({ showPlanDate: false, showDeadline: false, showExecutionCost: false, showComplete: false });
        expect(getWorkItemProfile(action, tree)).toMatchObject({ showPlanDate: true, showDeadline: true, showExecutionCost: true, showComplete: true });
    });

    it("区分尚未确认截止日期、明确无截止日期和具体日期", () => {
        const pending = item("pending", "待确认", "事务");
        const none = { ...item("none", "无期限", "事务"), noDeadline: true };
        const dated = { ...item("dated", "有期限", "事务"), deadline: Date.now() };
        const tree = buildWorkItemTree([pending, none, dated]);

        expect(needsDeadlineDecision(pending, tree)).toBe(true);
        expect(needsDeadlineDecision(none, tree)).toBe(false);
        expect(needsDeadlineDecision(dated, tree)).toBe(false);
    });
});

function item(id: string, title: string, type: string, parentIds: string[] = []): WorkItem {
    return {
        id, rowId: id, title, documentId: null, detached: true, type, status: "待开始",
        currentAction: "", nextAction: "", parentIds, topProjectIds: [], planDate: null,
        deadline: null, noDeadline: false, durationMinutes: null, energy: "", updatedAt: null,
    };
}
