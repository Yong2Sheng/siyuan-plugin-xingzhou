import type { WorkItem } from "./work-items";
import { dependencyCycleIds, prerequisiteIds } from "./dependencies";
import { executionSlicePlanSummary } from "./execution-slices";
import { getWorkItemRole } from "./work-item-role";

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

export function compareWorkItemOrder(a: WorkItem, b: WorkItem): number {
    const aOrder = typeof a.sortOrder === "number" && Number.isFinite(a.sortOrder) ? a.sortOrder : null;
    const bOrder = typeof b.sortOrder === "number" && Number.isFinite(b.sortOrder) ? b.sortOrder : null;
    if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
    if (aOrder !== null && bOrder === null) return -1;
    if (aOrder === null && bOrder !== null) return 1;
    return a.title.localeCompare(b.title, "zh-CN");
}

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

    roots.sort(compareWorkItemOrder);
    for (const siblings of children.values()) siblings.sort(compareWorkItemOrder);
    return { byId, children, roots, issues: dedupeIssues(issues) };
}

/** Return items in the same depth-first, sibling-aware order used by the hierarchy browser. */
export function flattenWorkItemTree(tree: WorkItemTree): WorkItem[] {
    const ordered: WorkItem[] = [];
    const visited = new Set<string>();
    const visit = (item: WorkItem) => {
        if (visited.has(item.id)) return;
        visited.add(item.id);
        ordered.push(item);
        for (const child of tree.children.get(item.id) ?? []) visit(child);
    };

    for (const root of tree.roots) visit(root);
    // Malformed cyclic records have no traversable root; keep them available safely.
    for (const item of tree.byId.values()) visit(item);
    return ordered;
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

/** 连续同值的兄弟行要有这么多行才值得淡化：两行相同是常态，三行起才成为一堵墙。 */
export const REPEAT_SIBLING_MIN = 3;

export type DescendantCounts = { projects: number; transactions: number };

/**
 * 找出「同一父下连续若干行，切片计划与状态完全一致」的行，供层级浏览把重复的芯片退到背景里。
 * 今日行给唯一签名：既不参与同值段，也会把前后两段断开，避免把当天真要动手的事淡化掉。
 */
export function collectRepeatSiblingIds(tree: WorkItemTree, todayFocusCounts: Map<string, number> = new Map()): Set<string> {
    const repeats = new Set<string>();
    const siblingGroups: WorkItem[][] = [tree.roots, ...tree.children.values()];

    for (const siblings of siblingGroups) {
        let runStart = 0;
        let runSignature: string | null = null;
        for (let index = 0; index <= siblings.length; index += 1) {
            const item = siblings[index];
            const signature = item ? rowChipSignature(item, todayFocusCounts) : null;
            if (index < siblings.length && signature === runSignature) continue;
            if (runSignature !== null && index - runStart >= REPEAT_SIBLING_MIN) {
                for (let mark = runStart; mark < index; mark += 1) repeats.add(siblings[mark].id);
            }
            runStart = index;
            runSignature = signature;
        }
    }

    return repeats;
}

/** 一行右侧真正显示出来的东西：切片计划 + 状态。 */
function rowChipSignature(item: WorkItem, todayFocusCounts: Map<string, number>): string {
    if ((todayFocusCounts.get(item.id) ?? 0) > 0) return `today:${item.id}`;
    const plan = executionSlicePlanSummary(item);
    return `${plan?.kind ?? "none"}\u0000${plan?.label ?? ""}\u0000${item.status}`;
}

/**
 * 折叠一个节点时告诉用户里面有多少东西：项目数，以及非项目后代（事务／想法等）数。
 * 判定走 `getWorkItemRole`，与树上徽章的口径保持一致。
 * 传入 `visibleIds` 时只数当前筛选下可见的后代 —— 否则「今日」筛选里的数字会和展开后看到的对不上。
 */
export function countItemDescendants(itemId: string, tree: WorkItemTree, visibleIds?: Set<string>): DescendantCounts {
    const counts: DescendantCounts = { projects: 0, transactions: 0 };
    const seen = new Set<string>([itemId]);

    const visit = (id: string) => {
        for (const child of tree.children.get(id) ?? []) {
            if (seen.has(child.id)) continue;
            // 不可见的节点其整棵子树也不可见（可见集包含命中项的全部祖先），直接跳过
            if (visibleIds && !visibleIds.has(child.id)) continue;
            seen.add(child.id);
            const role = getWorkItemRole(child, tree);
            if (role === "topProject" || role === "subproject") counts.projects += 1;
            else counts.transactions += 1;
            visit(child.id);
        }
    };

    visit(itemId);
    return counts;
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
