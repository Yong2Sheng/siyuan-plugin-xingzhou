/**
 * 「完成事务」的收尾规则。
 *
 * 背景：切片一旦记为 missed／abandoned 就永远不会再变成 completed（见 execution-slices.ts），
 * 所以**硬拦截会让放弃过切片的事务永远无法完成**。这里采用的方式是：
 * 完成时把未完成项列出来，要求用户显式处置，然后照常完成。
 *
 * 领域层只负责「列出还有什么没做完」和「把处置动作算成新的数据」，
 * 具体弹什么选项、文案怎么写留在组件里。
 */
import type { ExecutionSlice } from "./execution-slices";
import { hasUnfinishedTodos, type Todo } from "./todos";

export type CompletionBlockerKind = "slice" | "todo";

export type CompletionBlocker = {
    kind: CompletionBlockerKind;
    id: string;
    label: string;
    detail: string;
};

/** 用户选择的处置方式。 */
export type CompletionDisposition = "drop-unfinished" | "keep-outstanding" | "reason";

export type CompletionBlockers = {
    slices: ExecutionSlice[];
    todos: Todo[];
    items: CompletionBlocker[];
    /** 有未完成项时为 true：完成前需要用户显式处置。 */
    needsDisposition: boolean;
    /** 用于按钮与摘要文案，例如「2 片切片、3 条待办」。 */
    summary: string;
};

export function completionBlockers(slices: ExecutionSlice[], todos: Todo[], today = localDateKey()): CompletionBlockers {
    const unfinishedSlices = slices.filter((slice) => slice.status === "scheduled" || slice.status === "missed");
    const unfinishedTodos = todos.filter((todo) => todo.status === "open");
    const items: CompletionBlocker[] = [
        ...unfinishedSlices.map((slice) => ({
            kind: "slice" as const,
            id: slice.id,
            label: sliceLabel(slice, today),
            detail: slice.scheduledDate,
        })),
        ...unfinishedTodos.map((todo) => ({
            kind: "todo" as const,
            id: todo.id,
            label: todo.text,
            detail: "待办未完成",
        })),
    ];
    const parts: string[] = [];
    if (unfinishedSlices.length > 0) parts.push(`${unfinishedSlices.length} 片切片`);
    if (unfinishedTodos.length > 0) parts.push(`${unfinishedTodos.length} 条待办`);
    return {
        slices: unfinishedSlices,
        todos: unfinishedTodos,
        items,
        needsDisposition: items.length > 0,
        summary: parts.join("、"),
    };
}

export function hasUnfinishedWork(slices: ExecutionSlice[], todos: Todo[]): boolean {
    return slices.some((slice) => slice.status === "scheduled" || slice.status === "missed") || hasUnfinishedTodos(todos);
}

/** 记录收尾原因时使用的前缀，和事务级备注一起保留在细则的当前状态里。 */
export function completionReasonLine(reason: string, today = localDateKey()): string {
    const trimmed = reason.trim().replace(/\s+/g, " ");
    return trimmed ? `（${today} 结束事务：${trimmed}）` : "";
}

function sliceLabel(slice: ExecutionSlice, today: string): string {
    if (slice.status === "missed") return `错过的切片 · ${slice.scheduledDate}`;
    return slice.scheduledDate < today ? `已过期的切片 · ${slice.scheduledDate}` : `已安排的切片 · ${slice.scheduledDate}`;
}

function localDateKey(timestamp = Date.now()): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
