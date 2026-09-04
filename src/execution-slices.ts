import type { WorkItem } from "./work-items";

export type ExecutionSliceStatus = "scheduled" | "completed" | "missed" | "abandoned";

export type ExecutionSlice = {
    id: string;
    scheduledDate: string;
    status: ExecutionSliceStatus;
    completedAt: number | null;
    updatedAt: number;
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

export function scheduledSliceCount(item: WorkItem): number {
    return (item.executionSlices ?? []).filter((slice) => slice.status === "scheduled").length;
}

export function availableSliceCount(item: WorkItem): number {
    const target = normalizedTarget(item.sliceTargetCount);
    return Math.max(0, target - completedSliceCount(item) - scheduledSliceCount(item));
}

export function sliceCompletionPercent(item: WorkItem): number {
    const target = normalizedTarget(item.sliceTargetCount);
    return target > 0 ? Math.min(100, Math.round(completedSliceCount(item) / target * 100)) : 0;
}

export function slicesOnDate(item: WorkItem, date: string): ExecutionSlice[] {
    return (item.executionSlices ?? []).filter((slice) => slice.scheduledDate === date).sort(compareSlices);
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
    status: Extract<ExecutionSliceStatus, "completed" | "abandoned">,
    now = Date.now(),
): ExecutionSlice[] {
    const slice = (item.executionSlices ?? []).find((candidate) => candidate.id === sliceId);
    if (!slice || slice.status !== "scheduled") throw new Error("只能处理尚未完成的切片。");
    return normalizeExecutionSlices((item.executionSlices ?? []).map((candidate) => candidate.id === sliceId
        ? { ...candidate, status, completedAt: status === "completed" ? now : null, updatedAt: now }
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
