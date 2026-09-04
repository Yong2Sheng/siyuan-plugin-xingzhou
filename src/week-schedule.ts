import { isClosed } from "./tree";
import type { ExecutionSlice } from "./execution-slices";
import type { WorkItem } from "./work-items";

export type WeekOccurrencePhase = "slice" | "single" | "start" | "ongoing" | "deadline" | "carry-in" | "carry-out";

export type WeekOccurrence = {
    item: WorkItem;
    phase: WeekOccurrencePhase;
    slice?: ExecutionSlice;
};

export function groupWeekOccurrences(items: WorkItem[], weekStart: number): Map<string, WeekOccurrence[]> {
    const dayKeys = buildDayKeys(weekStart, 7);
    const weekStartKey = dayKeys[0];
    const weekEndKey = dayKeys[dayKeys.length - 1];
    const result = new Map<string, WeekOccurrence[]>();

    for (const item of items) {
        if (item.type === "事务") {
            for (const slice of item.executionSlices ?? []) {
                if (slice.scheduledDate < weekStartKey || slice.scheduledDate > weekEndKey) continue;
                const occurrences = result.get(slice.scheduledDate) ?? [];
                occurrences.push({ item, phase: "slice", slice });
                result.set(slice.scheduledDate, occurrences);
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
