import type { WorkItem } from "./work-items";
import { dependencyCycleIds, prerequisiteIds } from "./dependencies";

export type WorkItemIssue = {
    itemId: string;
    kind: "self-parent" | "multiple-parents" | "missing-parent" | "cycle" | "top-project-mismatch" | "self-dependency" | "missing-dependency" | "dependency-cycle";
    message: string;
};

export type WorkItemTree = {
    byId: Map<string, WorkItem>;
    children: Map<string, WorkItem[]>;
    roots: WorkItem[];
    issues: WorkItemIssue[];
};

// 旧状态暂时保留在判定中，确保数据库迁移前现有项目不会从活跃筛选中消失。
const ACTIVE_STATUSES = new Set(["活跃", "进行中", "待开始", "已计划", "等待", "阻塞"]);
const CLOSED_STATUSES = new Set(["已完成", "已失败", "已取消", "已放弃", "已归档"]);

export function buildWorkItemTree(items: WorkItem[]): WorkItemTree {
    const byId = new Map(items.map((item) => [item.id, item]));
    const children = new Map<string, WorkItem[]>();
    const issues: WorkItemIssue[] = [];
    const roots: WorkItem[] = [];
    const cyclicDependencyIds = dependencyCycleIds(items);

    for (const item of items) {
        if (item.parentIds.length > 1) {
            issues.push({ itemId: item.id, kind: "multiple-parents", message: `“${item.title}”设置了多个直接上层。` });
        }
        const parentId = item.parentIds[0];
        if (!parentId) {
            roots.push(item);
            continue;
        }
        if (parentId === item.id) {
            issues.push({ itemId: item.id, kind: "self-parent", message: `“${item.title}”不能把自己设为上层工作项。` });
            roots.push(item);
            continue;
        }
        if (!byId.has(parentId)) {
            issues.push({ itemId: item.id, kind: "missing-parent", message: `“${item.title}”的上层工作项不在当前数据库中。` });
            roots.push(item);
            continue;
        }
        const siblings = children.get(parentId) ?? [];
        siblings.push(item);
        children.set(parentId, siblings);
    }

    for (const item of items) {
        if (hasParentCycle(item, byId)) {
            issues.push({ itemId: item.id, kind: "cycle", message: `“${item.title}”所在的上层关系形成了循环。` });
        }
        const topId = item.topProjectIds[0];
        if (topId && topId !== item.id && !isAncestor(topId, item, byId)) {
            issues.push({ itemId: item.id, kind: "top-project-mismatch", message: `“${item.title}”的所属顶层项目不在其上层链中。` });
        }
        const dependencies = prerequisiteIds(item);
        if (dependencies.includes(item.id)) {
            issues.push({ itemId: item.id, kind: "self-dependency", message: `“${item.title}”不能依赖自身。` });
        }
        if (dependencies.some((id) => !byId.has(id))) {
            issues.push({ itemId: item.id, kind: "missing-dependency", message: `“${item.title}”引用了当前数据库中不存在的前置工作项。` });
        }
        if (cyclicDependencyIds.has(item.id)) {
            issues.push({ itemId: item.id, kind: "dependency-cycle", message: `“${item.title}”所在的前置关系形成了循环依赖。` });
        }
    }

    const order = (a: WorkItem, b: WorkItem) => a.title.localeCompare(b.title, "zh-CN");
    roots.sort(order);
    for (const siblings of children.values()) siblings.sort(order);
    return { byId, children, roots, issues: dedupeIssues(issues) };
}

export function isActive(item: WorkItem): boolean {
    return ACTIVE_STATUSES.has(item.status);
}

export function isClosed(item: WorkItem): boolean {
    return CLOSED_STATUSES.has(item.status);
}

export function hasActiveDescendant(itemId: string, tree: WorkItemTree): boolean {
    const seen = new Set<string>();
    const visit = (id: string): boolean => {
        if (seen.has(id)) return false;
        seen.add(id);
        return (tree.children.get(id) ?? []).some((child) => isActive(child) || visit(child.id));
    };
    return visit(itemId);
}

export function hasOngoingDescendant(itemId: string, tree: WorkItemTree): boolean {
    const seen = new Set<string>();
    const visit = (id: string): boolean => {
        if (seen.has(id)) return false;
        seen.add(id);
        return (tree.children.get(id) ?? []).some((child) => child.status === "进行中" || child.status === "活跃" || visit(child.id));
    };
    return visit(itemId);
}

export function collectDescendantIds(itemId: string, tree: WorkItemTree): Set<string> {
    const result = new Set<string>([itemId]);
    const visit = (id: string) => {
        for (const child of tree.children.get(id) ?? []) {
            if (result.has(child.id)) continue;
            result.add(child.id);
            visit(child.id);
        }
    };
    visit(itemId);
    return result;
}

function hasParentCycle(start: WorkItem, byId: Map<string, WorkItem>): boolean {
    const seen = new Set<string>([start.id]);
    let current: WorkItem | undefined = start;
    while (current?.parentIds[0]) {
        const parentId = current.parentIds[0];
        if (seen.has(parentId)) return true;
        seen.add(parentId);
        current = byId.get(parentId);
    }
    return false;
}

function isAncestor(ancestorId: string, item: WorkItem, byId: Map<string, WorkItem>): boolean {
    const seen = new Set<string>();
    let parentId: string | undefined = item.parentIds[0];
    while (parentId && !seen.has(parentId)) {
        if (parentId === ancestorId) return true;
        seen.add(parentId);
        parentId = byId.get(parentId)?.parentIds[0];
    }
    return false;
}

function dedupeIssues(issues: WorkItemIssue[]): WorkItemIssue[] {
    const seen = new Set<string>();
    return issues.filter((issue) => {
        const key = `${issue.itemId}:${issue.kind}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
