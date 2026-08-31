import type { WorkItem } from "./work-items";
import type { WorkItemTree } from "./tree";

export type WorkItemRole = "domain" | "topProject" | "subproject" | "task" | "transaction" | "idea" | "unclassified";

export const WORK_ITEM_ROLE_META: Record<WorkItemRole, { label: string }> = {
    domain: { label: "长期领域" },
    topProject: { label: "顶层项目" },
    subproject: { label: "子项目" },
    task: { label: "任务" },
    transaction: { label: "事务" },
    idea: { label: "想法" },
    unclassified: { label: "未分类" },
};

export const WORK_ITEM_ROLE_LEGEND: WorkItemRole[] = ["domain", "topProject", "subproject", "task", "transaction", "idea"];

export type WorkItemProfile = {
    role: WorkItemRole;
    label: string;
    statusLabel: string;
    statuses: string[];
    parentLabel: string;
    showParent: boolean;
    showTopProject: boolean;
    showPlanDate: boolean;
    showDeadline: boolean;
    showExecutionCost: boolean;
    showNextAction: boolean;
    showComplete: boolean;
    actionLabel: string;
};

const EXECUTION_STATUSES = ["待开始", "进行中", "阻塞", "暂停", "将来", "已完成", "已失败", "已取消", "已放弃"];
const PROJECT_STATUSES = ["待开始", "进行中", "阻塞", "暂停", "将来", "已完成", "已取消", "已放弃"];
const DOMAIN_STATUSES = ["重点投入", "持续维持", "暂停", "将来", "已归档"];

export function getWorkItemRole(item: WorkItem, tree: WorkItemTree): WorkItemRole {
    if (item.type === "长期领域") return "domain";
    if (item.type === "项目") {
        const parent = item.parentIds[0] ? tree.byId.get(item.parentIds[0]) : null;
        return !parent || parent.type === "长期领域" ? "topProject" : "subproject";
    }
    if (item.type === "任务") return "task";
    if (item.type === "事务") return "transaction";
    if (item.type === "想法") return "idea";
    return "unclassified";
}

export function getWorkItemProfile(item: WorkItem, tree: WorkItemTree): WorkItemProfile {
    const role = getWorkItemRole(item, tree);
    if (role === "domain") return {
        role, label: WORK_ITEM_ROLE_META[role].label, statusLabel: "投入状态", statuses: DOMAIN_STATUSES,
        parentLabel: "", showParent: false, showTopProject: false, showPlanDate: false, showDeadline: false,
        showExecutionCost: false, showNextAction: false, showComplete: false, actionLabel: "领域说明／当前关注方向",
    };
    if (role === "topProject") return {
        role, label: WORK_ITEM_ROLE_META[role].label, statusLabel: "项目状态", statuses: PROJECT_STATUSES,
        parentLabel: "所属领域", showParent: true, showTopProject: false, showPlanDate: false, showDeadline: true,
        showExecutionCost: false, showNextAction: true, showComplete: true, actionLabel: "项目目标／当前阶段",
    };
    if (role === "subproject") return {
        role, label: WORK_ITEM_ROLE_META[role].label, statusLabel: "项目状态", statuses: PROJECT_STATUSES,
        parentLabel: "上层项目", showParent: true, showTopProject: true, showPlanDate: false, showDeadline: true,
        showExecutionCost: false, showNextAction: true, showComplete: true, actionLabel: "项目目标／当前阶段",
    };
    if (role === "task") return {
        role, label: WORK_ITEM_ROLE_META[role].label, statusLabel: "任务状态", statuses: PROJECT_STATUSES,
        parentLabel: "上层工作项", showParent: true, showTopProject: true, showPlanDate: false, showDeadline: true,
        showExecutionCost: false, showNextAction: true, showComplete: true, actionLabel: "完成标准／任务说明",
    };
    if (role === "transaction" || role === "idea") return {
        role, label: WORK_ITEM_ROLE_META[role].label, statusLabel: "执行状态", statuses: EXECUTION_STATUSES,
        parentLabel: "上层工作项", showParent: true, showTopProject: true, showPlanDate: true, showDeadline: true,
        showExecutionCost: true, showNextAction: true, showComplete: true, actionLabel: role === "idea" ? "想法说明／准备如何验证" : "本次行动细则",
    };
    return {
        role, label: WORK_ITEM_ROLE_META[role].label, statusLabel: "状态", statuses: EXECUTION_STATUSES,
        parentLabel: "上层工作项", showParent: true, showTopProject: false, showPlanDate: false, showDeadline: false,
        showExecutionCost: false, showNextAction: false, showComplete: false, actionLabel: "补充说明",
    };
}

export function deriveTopProjectId(parentId: string, tree: WorkItemTree): string {
    const seen = new Set<string>();
    let current = parentId ? tree.byId.get(parentId) : undefined;
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        if (current.type === "项目") {
            const parent = current.parentIds[0] ? tree.byId.get(current.parentIds[0]) : null;
            if (!parent || parent.type === "长期领域") return current.id;
        }
        current = current.parentIds[0] ? tree.byId.get(current.parentIds[0]) : undefined;
    }
    return "";
}

export function needsDeadlineDecision(item: WorkItem, tree: WorkItemTree): boolean {
    const profile = getWorkItemProfile(item, tree);
    return profile.showDeadline && !item.deadline && !item.noDeadline;
}
