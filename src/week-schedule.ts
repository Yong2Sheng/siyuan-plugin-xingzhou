import { isClosed } from "./tree";
import { executionSliceLoadsByDate, executionSliceRemainingByDate } from "./execution-slices";
import type { ExecutionSlice, ExecutionSliceDayLoad } from "./execution-slices";
import type { WorkItem } from "./work-items";

export type WeekOccurrencePhase = "slice" | "early-completion" | "single" | "start" | "ongoing" | "deadline" | "carry-in" | "carry-out";

export type WeekOccurrence = {
    item: WorkItem;
    phase: WeekOccurrencePhase;
    slice?: ExecutionSlice;
};

export type WeekDayLoad = {
    /** 当天所有事务「已安排＋已完成」的时长合计（与执行切片日历同一口径）。 */
    load: ExecutionSliceDayLoad;
    /** 当天「尚未完成」（状态仍为已安排）的时长合计，即待做。 */
    remaining: ExecutionSliceDayLoad;
};

/** 汇总一周七天每天的负载与待做，供周看板展示。 */
export function weekDayLoads(items: WorkItem[], weekStart: number): Map<string, WeekDayLoad> {
    const loadsByDate = executionSliceLoadsByDate(items);
    const remainingByDate = executionSliceRemainingByDate(items);
    const result = new Map<string, WeekDayLoad>();
    for (const dayKey of buildDayKeys(weekStart, 7)) {
        result.set(dayKey, {
            load: { ...(loadsByDate.get(dayKey) ?? { count: 0, minutes: 0, unestimatedCount: 0 }) },
            remaining: { ...(remainingByDate.get(dayKey) ?? { count: 0, minutes: 0, unestimatedCount: 0 }) },
        });
    }
    return result;
}

export function groupWeekOccurrences(items: WorkItem[], weekStart: number): Map<string, WeekOccurrence[]> {
    const dayKeys = buildDayKeys(weekStart, 7);
    const weekStartKey = dayKeys[0];
    const weekEndKey = dayKeys[dayKeys.length - 1];
    const result = new Map<string, WeekOccurrence[]>();

    for (const item of items) {
        if (item.type === "事务") {
            for (const slice of item.executionSlices ?? []) {
                if (slice.scheduledDate >= weekStartKey && slice.scheduledDate <= weekEndKey) {
                    const occurrences = result.get(slice.scheduledDate) ?? [];
                    occurrences.push({ item, phase: "slice", slice });
                    result.set(slice.scheduledDate, occurrences);
                }
                const completedDate = slice.completedAt ? localDateKey(slice.completedAt) : "";
                if (slice.status === "completed" && completedDate && completedDate < slice.scheduledDate
                    && completedDate >= weekStartKey && completedDate <= weekEndKey) {
                    const achievements = result.get(completedDate) ?? [];
                    achievements.push({ item, phase: "early-completion", slice });
                    result.set(completedDate, achievements);
                }
            }
            continue;
        }
        if (!item.planDate) continue;
        const closed = isClosed(item);
        if (closed && (item.completedDates?.length ?? 0) === 0) continue;
        const startKey = localDateKey(item.planDate);
        const rawEndKey = item.deadline ? localDateKey(item.deadline) : "";
        const endKey = rawEndKey >= startKey ? rawEndKey : startKey;
        if (startKey > weekEndKey || endKey < weekStartKey) continue;

        for (const dayKey of dayKeys) {
            if (dayKey < startKey || dayKey > endKey) continue;
            if (closed && !item.completedDates?.includes(dayKey)) continue;
            const phase = occurrencePhase(dayKey, startKey, endKey, weekStartKey, weekEndKey);
            const occurrences = result.get(dayKey) ?? [];
            occurrences.push({ item, phase });
            result.set(dayKey, occurrences);
        }
    }

    for (const occurrences of result.values()) {
        occurrences.sort((a, b) => a.item.title.localeCompare(b.item.title, "zh-CN"));
    }
    return result;
}

export function weekOccurrenceLabel(phase: WeekOccurrencePhase): string {
    if (phase === "slice") return "执行切片";
    if (phase === "early-completion") return "提前完成记录";
    if (phase === "single") return "当日";
    if (phase === "start") return "开始";
    if (phase === "deadline") return "截止";
    if (phase === "carry-in") return "承接上周";
    if (phase === "carry-out") return "延续下周";
    return "持续中";
}

export function isWeekOccurrenceCompact(phase: WeekOccurrencePhase): boolean {
    return phase !== "slice" && phase !== "single" && phase !== "start";
}

function occurrencePhase(dayKey: string, startKey: string, endKey: string, weekStartKey: string, weekEndKey: string): WeekOccurrencePhase {
    if (startKey === endKey) return "single";
    if (dayKey === startKey) return "start";
    if (dayKey === endKey) return "deadline";
    if (dayKey === weekStartKey && startKey < weekStartKey) return "carry-in";
    if (dayKey === weekEndKey && endKey > weekEndKey) return "carry-out";
    return "ongoing";
}

function buildDayKeys(start: number, count: number): string[] {
    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0);
    return Array.from({ length: count }, (_, index) => {
        const date = new Date(startDate);
        date.setDate(date.getDate() + index);
        return localDateKey(date.getTime());
    });
}

function localDateKey(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
