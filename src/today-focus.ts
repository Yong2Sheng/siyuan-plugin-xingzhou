import { isClosed, type WorkItemTree } from "./tree";
import type { WorkItem } from "./work-items";

/**
 * 「今日」口径的唯一实现：只有事务、未结束、且今天仍有尚未完成的执行切片，才算今天的承诺。
 * 层级浏览的今日标记、「今日」筛选、以及选中项回落都调用这里，避免各视图各写一套日期规则。
 */
export function todayFocusCount(item: WorkItem, todayKey: string): number {
    if (item.type !== "事务" || isClosed(item)) return 0;
    return (item.executionSlices ?? []).filter((slice) =>
        slice.scheduledDate === todayKey && slice.status === "scheduled"
    ).length;
}

export function isTodayFocusItem(item: WorkItem, todayKey = localDateKey(Date.now())): boolean {
    return todayFocusCount(item, todayKey) > 0;
}

export function getTodayFocusCounts(items: WorkItem[], _tree: WorkItemTree, now = Date.now()): Map<string, number> {
    const today = localDateKey(now);
    const counts = new Map<string, number>();

    for (const item of items) {
        const unfinishedToday = todayFocusCount(item, today);
        if (unfinishedToday > 0) counts.set(item.id, unfinishedToday);
    }

    return counts;
}

export function localDateKey(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
