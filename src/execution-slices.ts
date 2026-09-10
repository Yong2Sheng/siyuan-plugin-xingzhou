import type { WorkItem } from "./work-items";

export type ExecutionSliceStatus = "scheduled" | "completed" | "missed" | "abandoned";

export type ExecutionSlice = {
    id: string;
    scheduledDate: string;
    status: ExecutionSliceStatus;
    completedAt: number | null;
    updatedAt: number;
};

export type ExecutionSliceDayLoad = {
    count: number;
    minutes: number;
    unestimatedCount: number;
};

export type ExecutionSlicePlanSummary = {
    kind: "unset" | "needs-planning" | "arranged" | "completed";
    label: string;
    title: string;
};

/** 一天的时长/片数口径；count、minutes 与 unestimatedCount 始终表示同一批切片。 */
export type DayLoadValue = {
    count: number;
    minutes: number;
    unestimatedCount: number;
    /** 有切片但完全没有可用的分钟数（都未估时）。 */
    unestimatedOnly: boolean;
    /** 存在未估时切片，分钟数只能是下限。 */
    atLeast: boolean;
};

export type MonthLoadSummary = {
    remainingMinutes: number;
    totalMinutes: number;
    /** 当天承诺过、且已全部做完的日期（按日期升序）。 */
    clearedDates: string[];
};

export function normalizeExecutionSlices(value: unknown): ExecutionSlice[] {
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    const result: ExecutionSlice[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const candidate = raw as Partial<ExecutionSlice>;
        if (typeof candidate.id !== "string" || !candidate.id || ids.has(candidate.id)) continue;
        if (!isDateKey(candidate.scheduledDate)) continue;
        if (!isSliceStatus(candidate.status)) continue;
        ids.add(candidate.id);
        result.push({
            id: candidate.id,
            scheduledDate: candidate.scheduledDate,
            status: candidate.status,
            completedAt: finiteNumber(candidate.completedAt),
            updatedAt: finiteNumber(candidate.updatedAt) ?? Date.now(),
        });
    }
    return result.sort(compareSlices);
}

export function completedSliceCount(item: WorkItem): number {
    return (item.executionSlices ?? []).filter((slice) => slice.status === "completed").length;
}

const SLICE_STARTABLE_STATUSES = new Set(["收件箱", "待开始", "已计划"]);

/** 首次实际完成切片时推进准备状态；后续手动选择的状态保持优先。 */
export function automaticStatusForSliceCompletion(item: WorkItem, nextSlices: ExecutionSlice[]): string | null {
    if (!SLICE_STARTABLE_STATUSES.has(item.status)) return null;
    if (completedSliceCount(item) > 0) return null;
    return nextSlices.some((slice) => slice.status === "completed") ? "进行中" : null;
}

export function scheduledSliceCount(item: WorkItem): number {
    return (item.executionSlices ?? []).filter((slice) => slice.status === "scheduled").length;
}

export function availableSliceCount(item: WorkItem): number {
    const target = normalizedTarget(item.sliceTargetCount);
    return Math.max(0, target - completedSliceCount(item) - scheduledSliceCount(item));
}

export function executionSlicePlanSummary(item: WorkItem): ExecutionSlicePlanSummary | null {
    if (item.type !== "事务") return null;
    const target = normalizedTarget(item.sliceTargetCount);
    const completed = completedSliceCount(item);
    const scheduled = scheduledSliceCount(item);
    const available = availableSliceCount(item);
    const covered = Math.min(target, completed + scheduled);
    if (!target) return { kind: "unset", label: "未设切片", title: "尚未设置目标切片数" };
    const details = `目标 ${target} 片 · 已完成 ${completed} 片 · 已安排 ${scheduled} 片 · 待安排 ${available} 片`;
    if (completed >= target) return { kind: "completed", label: `切片完成 ${target}/${target}`, title: details };
    if (available === 0) return { kind: "arranged", label: `已安排 ${covered}/${target}`, title: details };
    return { kind: "needs-planning", label: `待安排 ${available}`, title: details };
}

export function sliceCompletionPercent(item: WorkItem): number {
    const target = normalizedTarget(item.sliceTargetCount);
    return target > 0 ? Math.min(100, Math.round(completedSliceCount(item) / target * 100)) : 0;
}

export function slicesOnDate(item: WorkItem, date: string): ExecutionSlice[] {
    return (item.executionSlices ?? []).filter((slice) => slice.scheduledDate === date).sort(compareSlices);
}

/**
 * Summarize committed daily workload across every transaction. Missed and
 * abandoned attempts no longer occupy capacity, while completed work still
 * represents time that was committed on that date.
 */
export function executionSliceLoadsByDate(items: WorkItem[]): Map<string, ExecutionSliceDayLoad> {
    return aggregateSlicesByDate(items, (slice) => slice.status === "scheduled" || slice.status === "completed");
}

/**
 * 汇总当天「待做」的时长：只统计状态仍为 scheduled（尚未完成）的切片。
 * 提前完成的切片状态已变成 completed、计划日期保持不变，因此会从待做里消失——
 * 这就是「当天原本要 300 分钟、全部提前做完后当天待做是 0 分钟」的依据。
 */
export function executionSliceRemainingByDate(items: WorkItem[]): Map<string, ExecutionSliceDayLoad> {
    return aggregateSlicesByDate(items, (slice) => slice.status === "scheduled");
}

function aggregateSlicesByDate(items: WorkItem[], accept: (slice: ExecutionSlice) => boolean): Map<string, ExecutionSliceDayLoad> {
    const loads = new Map<string, ExecutionSliceDayLoad>();
    for (const item of items) {
        if (item.type !== "事务") continue;
        for (const slice of item.executionSlices ?? []) {
            if (!accept(slice)) continue;
            const current = loads.get(slice.scheduledDate) ?? { count: 0, minutes: 0, unestimatedCount: 0 };
            current.count += 1;
            if (item.durationMinutes === null || !Number.isFinite(item.durationMinutes) || item.durationMinutes < 0) {
                current.unestimatedCount += 1;
            } else {
                current.minutes += item.durationMinutes;
            }
            loads.set(slice.scheduledDate, current);
        }
    }
    return loads;
}

/** 把一天的负载整理成展示需要的口径，避免各组件各写一套判断。 */
export function dayLoadValue(load: ExecutionSliceDayLoad | undefined): DayLoadValue {
    const count = load?.count ?? 0;
    const minutes = load?.minutes ?? 0;
    const unestimatedCount = load?.unestimatedCount ?? 0;
    return {
        count,
        minutes,
        unestimatedCount,
        unestimatedOnly: count > 0 && minutes === 0 && unestimatedCount > 0,
        atLeast: minutes > 0 && unestimatedCount > 0,
    };
}

/** 汇总某段日期区间（含首尾，ISO 日期键可直接比较）的待做与总量。 */
export function summarizeDayLoads(
    loads: Map<string, ExecutionSliceDayLoad>,
    remaining: Map<string, ExecutionSliceDayLoad>,
    from: string,
    to: string,
): MonthLoadSummary {
    let remainingMinutes = 0;
    let totalMinutes = 0;
    const clearedDates: string[] = [];
    for (const [date, load] of loads) {
        if (date < from || date > to) continue;
        totalMinutes += load.minutes;
        const pending = dayLoadValue(remaining.get(date));
        remainingMinutes += pending.minutes;
        /* 当天承诺过事、且已经没有待做切片（未估时的待做也算“还没做完”，不计入已清空） */
        if (load.count > 0 && pending.count === 0) clearedDates.push(date);
    }
    clearedDates.sort((a, b) => a.localeCompare(b));
    return { remainingMinutes, totalMinutes, clearedDates };
}

export function scheduleSlice(item: WorkItem, date: string, id = createExecutionSliceId(), now = Date.now()): ExecutionSlice[] {
    if (item.type !== "事务") throw new Error("只有事务可以安排执行切片。");
    if (!isDateKey(date)) throw new Error("执行切片日期格式无效。");
    if (item.deadline && date > localDateKey(item.deadline)) throw new Error("执行切片不能安排在截止日期之后。");
    if (date < localDateKey(now)) throw new Error("不能把新的执行切片安排到过去日期。");
    if (availableSliceCount(item) <= 0) throw new Error("所有有效切片均已完成或安排，请先取消其他日期的安排。");
    if (slicesOnDate(item, date).length > 0) throw new Error("这个事务在该日期已经有执行记录。");
    return normalizeExecutionSlices([...(item.executionSlices ?? []), {
        id,
        scheduledDate: date,
        status: "scheduled",
        completedAt: null,
        updatedAt: now,
    }]);
}

export function cancelScheduledSlice(item: WorkItem, sliceId: string): ExecutionSlice[] {
    const slice = (item.executionSlices ?? []).find((candidate) => candidate.id === sliceId);
    if (!slice || slice.status !== "scheduled") throw new Error("只能取消尚未完成的切片安排。");
    return normalizeExecutionSlices((item.executionSlices ?? []).filter((candidate) => candidate.id !== sliceId));
}

export function moveScheduledSlice(item: WorkItem, sliceId: string, date: string, now = Date.now()): ExecutionSlice[] {
    const slice = (item.executionSlices ?? []).find((candidate) => candidate.id === sliceId);
    if (!slice || slice.status !== "scheduled") throw new Error("只能移动尚未完成的切片。");
    if (!isDateKey(date)) throw new Error("执行切片日期格式无效。");
    if (item.deadline && date > localDateKey(item.deadline)) throw new Error("执行切片不能移动到截止日期之后。");
    if (date < localDateKey(now)) throw new Error("不能把执行切片移动到过去日期。");
    if (slicesOnDate(item, date).some((candidate) => candidate.id !== sliceId)) throw new Error("这个事务在该日期已经有执行记录。");
    return normalizeExecutionSlices((item.executionSlices ?? []).map((candidate) => candidate.id === sliceId
        ? { ...candidate, scheduledDate: date, updatedAt: now }
        : candidate));
}

export function setSliceOutcome(
    item: WorkItem,
    sliceId: string,
    status: Extract<ExecutionSliceStatus, "completed" | "missed" | "abandoned">,
    now = Date.now(),
): ExecutionSlice[] {
    const slice = (item.executionSlices ?? []).find((candidate) => candidate.id === sliceId);
    if (!slice || slice.status !== "scheduled") throw new Error("只能处理尚未完成的切片。");
    return normalizeExecutionSlices((item.executionSlices ?? []).map((candidate) => candidate.id === sliceId
        ? { ...candidate, status, completedAt: status === "completed" ? now : null, updatedAt: now }
        : candidate));
}

/** Complete a slice while preserving its planned date; completedAt records when the work actually finished. */
export function completeSliceNow(item: WorkItem, sliceId: string, now = Date.now()): ExecutionSlice[] {
    const slice = (item.executionSlices ?? []).find((candidate) => candidate.id === sliceId);
    if (!slice || (slice.status !== "scheduled" && slice.status !== "missed")) {
        throw new Error("只能完成已安排或未完成的切片。");
    }
    return normalizeExecutionSlices((item.executionSlices ?? []).map((candidate) => candidate.id === sliceId
        ? { ...candidate, status: "completed" as const, completedAt: now, updatedAt: now }
        : candidate));
}

export function undoCompletedSlice(item: WorkItem, sliceId: string, today = localDateKey(), now = Date.now()): ExecutionSlice[] {
    const slice = (item.executionSlices ?? []).find((candidate) => candidate.id === sliceId);
    if (!slice || slice.status !== "completed") throw new Error("只能撤销已经完成的切片。");
    return normalizeExecutionSlices((item.executionSlices ?? []).map((candidate) => candidate.id === sliceId
        ? { ...candidate, status: candidate.scheduledDate < today ? "missed" : "scheduled", completedAt: null, updatedAt: now }
        : candidate));
}

export function expirePastSlices(item: WorkItem, today = localDateKey(), now = Date.now()): ExecutionSlice[] | null {
    let changed = false;
    const slices = (item.executionSlices ?? []).map((slice) => {
        if (slice.status !== "scheduled" || slice.scheduledDate >= today) return slice;
        changed = true;
        return { ...slice, status: "missed" as const, completedAt: null, updatedAt: now };
    });
    return changed ? normalizeExecutionSlices(slices) : null;
}

export function validateSliceTarget(item: WorkItem, target: number | null): string | null {
    if (target === null) return (item.executionSlices ?? []).length ? "已有执行记录时不能清空切片数量。" : null;
    if (!Number.isInteger(target) || target < 1 || target > 366) return "切片数量需要是 1–366 之间的整数。";
    const committed = completedSliceCount(item) + scheduledSliceCount(item);
    return target < committed ? `至少需要保留 ${committed} 个切片，以容纳已完成和已安排的记录。` : null;
}

export function localDateKey(timestamp = Date.now()): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function createExecutionSliceId(now = Date.now()): string {
    const random = Math.random().toString(36).slice(2, 9);
    return `slice-${now.toString(36)}-${random}`;
}

function normalizedTarget(value: number | null | undefined): number {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

function compareSlices(a: ExecutionSlice, b: ExecutionSlice): number {
    return a.scheduledDate.localeCompare(b.scheduledDate) || a.updatedAt - b.updatedAt || a.id.localeCompare(b.id);
}

function isSliceStatus(value: unknown): value is ExecutionSliceStatus {
    return value === "scheduled" || value === "completed" || value === "missed" || value === "abandoned";
}

function isDateKey(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
