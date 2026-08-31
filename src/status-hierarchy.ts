import type { WorkItem } from "./work-items";

export type AutomaticStatusChange = { rowId: string; status: string };

const PROMOTABLE_STATUSES = new Set(["收件箱", "待开始", "已计划"]);

export function getAutomaticHierarchyStatusChanges(items: WorkItem[]): AutomaticStatusChange[] {
    const byId = new Map(items.map((item) => [item.id, item]));
    const changes = new Map<string, AutomaticStatusChange>();

    // 有明确上层的已分类条目已经离开整理入口，即使暂时没有进行中的下级，也应进入“待开始”。
    for (const item of items) {
        if (item.type && item.type !== "长期领域" && item.parentIds[0] && item.status === "收件箱") {
            changes.set(item.rowId, { rowId: item.rowId, status: "待开始" });
        }
    }

    // 任一进行中的后代都会把仍未启动的祖先向前推进；明确的暂停、阻塞和结束状态不会被覆盖。
    for (const item of items) {
        if (item.status !== "进行中" && item.status !== "活跃") continue;
        const seen = new Set<string>([item.id]);
        let parentId = item.parentIds[0];
        while (parentId && !seen.has(parentId)) {
            seen.add(parentId);
            const parent = byId.get(parentId);
            if (!parent) break;
            if (parent.type !== "长期领域" && PROMOTABLE_STATUSES.has(parent.status)) {
                changes.set(parent.rowId, { rowId: parent.rowId, status: "进行中" });
            }
            parentId = parent.parentIds[0];
        }
    }

    return [...changes.values()];
}
