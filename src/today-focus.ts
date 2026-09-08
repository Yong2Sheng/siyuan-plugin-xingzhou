import { isClosed, type WorkItemTree } from "./tree";
import type { WorkItem } from "./work-items";

export function getTodayFocusCounts(items: WorkItem[], _tree: WorkItemTree, now = Date.now()): Map<string, number> {
    const today = localDateKey(now);
    const counts = new Map<string, number>();

    for (const item of items) {
        if (item.type !== "事务" || isClosed(item)) continue;
        const unfinishedToday = (item.executionSlices ?? []).filter((slice) =>
            slice.scheduledDate === today && slice.status === "scheduled"
        ).length;
        if (unfinishedToday > 0) counts.set(item.id, unfinishedToday);
    }

    return counts;
}

function localDateKey(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
