import { isClosed, type WorkItemTree } from "./tree";
import type { WorkItem } from "./work-items";

export function getTodayFocusCounts(items: WorkItem[], tree: WorkItemTree, now = Date.now()): Map<string, number> {
    const today = localDateKey(now);
    const counts = new Map<string, number>();

    for (const item of items) {
        if (!isRelevantToday(item, today)) continue;
        const seen = new Set<string>();
        let current: WorkItem | undefined = item;
        while (current && !seen.has(current.id)) {
            seen.add(current.id);
            counts.set(current.id, (counts.get(current.id) ?? 0) + 1);
            current = current.parentIds[0] ? tree.byId.get(current.parentIds[0]) : undefined;
        }
    }

    return counts;
}

function isRelevantToday(item: WorkItem, today: string): boolean {
    if (isClosed(item)) return false;
    const start = item.planDate ? localDateKey(item.planDate) : "";
    const deadline = item.deadline ? localDateKey(item.deadline) : "";
    if (start === today || deadline === today) return true;
    return Boolean(start && deadline && start < today && today < deadline);
}

function localDateKey(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
