import { prerequisiteIds } from "./dependencies";
import { buildWorkItemTree, compareWorkItemOrder, isClosed } from "./tree";
import type { WorkItem } from "./work-items";

export type RelationshipGraphStatusFilter = "all" | "ongoing" | "pending";
export type RelationshipGraphEdgeKind = "hierarchy" | "hard" | "soft";

export type RelationshipGraphNode = {
    id: string;
    item: WorkItem;
    x: number;
    y: number;
    width: number;
    height: number;
    depth: number;
    contextOnly: boolean;
};

export type RelationshipGraphEdge = {
    id: string;
    fromId: string;
    toId: string;
    kind: RelationshipGraphEdgeKind;
};

export type RelationshipGraphLayout = {
    nodes: RelationshipGraphNode[];
    edges: RelationshipGraphEdge[];
    width: number;
    height: number;
    projectCount: number;
    transactionCount: number;
    domainCount: number;
};

const NODE_WIDTH = 190;
const NODE_HEIGHT = 58;
const HORIZONTAL_GAP = 76;
const VERTICAL_GAP = 44;
const ROOT_GAP = 38;
const PADDING = 28;
const DEPENDENCY_GUTTER = 180;

export function buildRelationshipGraph(
    items: WorkItem[],
    options: { showTransactions?: boolean; statusFilter?: RelationshipGraphStatusFilter } = {},
): RelationshipGraphLayout {
    const showTransactions = options.showTransactions ?? true;
    const statusFilter = options.statusFilter ?? "all";
    const tree = buildWorkItemTree(items);
    const baseIds = new Set(items
        .filter((item) => !isClosed(item))
        .filter((item) => item.type === "项目" || (showTransactions && item.type === "事务"))
        .filter((item) => matchesStatusFilter(item.status, statusFilter))
        .map((item) => item.id));
    const visibleIds = new Set(baseIds);

    for (const id of baseIds) {
        const seen = new Set<string>();
        let current = tree.byId.get(id);
        while (current?.parentIds[0] && !seen.has(current.parentIds[0])) {
            const parentId = current.parentIds[0];
            seen.add(parentId);
            const parent = tree.byId.get(parentId);
            if (!parent) break;
            visibleIds.add(parent.id);
            current = parent;
            if (parent.type === "长期领域") break;
        }
    }

    const visibleItems = items.filter((item) => visibleIds.has(item.id));
    const visibleChildren = new Map<string, WorkItem[]>();
    for (const item of visibleItems) {
        const parentId = item.parentIds[0];
        if (!parentId || !visibleIds.has(parentId)) continue;
        const children = visibleChildren.get(parentId) ?? [];
        children.push(item);
        visibleChildren.set(parentId, children);
    }
    for (const children of visibleChildren.values()) children.sort(compareWorkItemOrder);

    const roots = visibleItems
        .filter((item) => !item.parentIds[0] || !visibleIds.has(item.parentIds[0]))
        .sort(compareWorkItemOrder);
    const positions = new Map<string, { depth: number; centerY: number }>();
    const visiting = new Set<string>();
    let nextLeafY = PADDING + NODE_HEIGHT / 2;

    const place = (item: WorkItem, depth: number): number => {
        if (positions.has(item.id)) return positions.get(item.id)!.centerY;
        if (visiting.has(item.id)) {
            const centerY = nextLeafY;
            nextLeafY += NODE_HEIGHT + VERTICAL_GAP;
            positions.set(item.id, { depth, centerY });
            return centerY;
        }
        visiting.add(item.id);
        const children = (visibleChildren.get(item.id) ?? []).filter((child) => !positions.has(child.id));
        const childYs = children.map((child) => place(child, depth + 1));
        const centerY = childYs.length ? (childYs[0] + childYs[childYs.length - 1]) / 2 : nextLeafY;
        if (!childYs.length) nextLeafY += NODE_HEIGHT + VERTICAL_GAP;
        visiting.delete(item.id);
        positions.set(item.id, { depth, centerY });
        return centerY;
    };

    roots.forEach((root, index) => {
        if (index > 0) nextLeafY += ROOT_GAP;
        place(root, 0);
    });
    for (const item of visibleItems.sort(compareWorkItemOrder)) {
        if (positions.has(item.id)) continue;
        nextLeafY += ROOT_GAP;
        place(item, 0);
    }

    const nodes = visibleItems.map((item): RelationshipGraphNode => {
        const position = positions.get(item.id) ?? { depth: 0, centerY: nextLeafY };
        return {
            id: item.id,
            item,
            x: PADDING + position.depth * (NODE_WIDTH + HORIZONTAL_GAP),
            y: position.centerY - NODE_HEIGHT / 2,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            depth: position.depth,
            contextOnly: !baseIds.has(item.id),
        };
    }).sort((left, right) => left.y - right.y || left.depth - right.depth || compareWorkItemOrder(left.item, right.item));

    const edges: RelationshipGraphEdge[] = [];
    for (const item of visibleItems) {
        const parentId = item.parentIds[0];
        if (parentId && visibleIds.has(parentId)) edges.push(edge("hierarchy", parentId, item.id));
        for (const prerequisiteId of prerequisiteIds(item, "hardPrerequisites")) {
            if (visibleIds.has(prerequisiteId)) edges.push(edge("hard", prerequisiteId, item.id));
        }
        for (const prerequisiteId of prerequisiteIds(item, "softPrerequisites")) {
            if (visibleIds.has(prerequisiteId)) edges.push(edge("soft", prerequisiteId, item.id));
        }
    }

    const maxDepth = nodes.reduce((maximum, node) => Math.max(maximum, node.depth), 0);
    const maxBottom = nodes.reduce((maximum, node) => Math.max(maximum, node.y + node.height), 0);
    return {
        nodes,
        edges: dedupeEdges(edges),
        width: Math.max(720, PADDING * 2 + (maxDepth + 1) * NODE_WIDTH + maxDepth * HORIZONTAL_GAP + DEPENDENCY_GUTTER),
        height: Math.max(420, maxBottom + PADDING),
        projectCount: nodes.filter((node) => node.item.type === "项目" && !node.contextOnly).length,
        transactionCount: nodes.filter((node) => node.item.type === "事务" && !node.contextOnly).length,
        domainCount: new Set(nodes.filter((node) => node.item.type === "长期领域").map((node) => node.id)).size,
    };
}

export function graphStatusKind(status: string): "ongoing" | "pending" | "blocked" | "paused" | "future" | "context" {
    if (status === "进行中" || status === "活跃") return "ongoing";
    if (status === "待开始" || status === "规划中" || status === "已计划" || status === "等待") return "pending";
    if (status === "阻塞") return "blocked";
    if (status === "暂停") return "paused";
    if (status === "将来" || status === "将来／也许") return "future";
    return "context";
}

function matchesStatusFilter(status: string, filter: RelationshipGraphStatusFilter): boolean {
    if (filter === "all") return true;
    return graphStatusKind(status) === filter;
}

function edge(kind: RelationshipGraphEdgeKind, fromId: string, toId: string): RelationshipGraphEdge {
    return { id: `${kind}:${fromId}:${toId}`, kind, fromId, toId };
}

function dedupeEdges(edges: RelationshipGraphEdge[]): RelationshipGraphEdge[] {
    return [...new Map(edges.map((entry) => [entry.id, entry])).values()];
}
