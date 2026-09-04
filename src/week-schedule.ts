import { isClosed } from "./tree";
import type { WorkItem } from "./work-items";

export type WeekOccurrencePhase = "single" | "start" | "ongoing" | "deadline" | "carry-in" | "carry-out";

export type WeekOccurrence = {
    item: WorkItem;
    phase: WeekOccurrencePhase;
};

export function groupWeekOccurrences(items: WorkItem[], weekStart: number): Map<string, WeekOccurrence[]> {
    const dayKeys = buildDayKeys(weekStart, 7);
    const weekStartKey = dayKeys[0];
    const weekEndKey = dayKeys[dayKeys.length - 1];
    const result = new Map<string, WeekOccurrence[]>();

    for (const item of items) {
        if (isClosed(item) || !item.planDate) continue;
        const startKey = localDateKey(item.planDate);
        const rawEndKey = item.deadline ? localDateKey(item.deadline) : "";
        const endKey = rawEndKey >= startKey ? rawEndKey : startKey;
        if (startKey > weekEndKey || endKey < weekStartKey) continue;

        for (const dayKey of dayKeys) {
            if (dayKey < startKey || dayKey > endKey) continue;
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
    if (phase === "single") return "当日";
    if (phase === "start") return "开始";
    if (phase === "deadline") return "截止";
    if (phase === "carry-in") return "承接上周";
    if (phase === "carry-out") return "延续下周";
    return "持续中";
}

export function isWeekOccurrenceCompact(phase: WeekOccurrencePhase): boolean {
    return phase !== "single" && phase !== "start";
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
