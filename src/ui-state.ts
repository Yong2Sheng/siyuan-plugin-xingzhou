import { flattenWorkItemTree, isClosed, type WorkItemTree } from "./tree";
import { getTodayFocusCounts } from "./today-focus";
import type { WorkItem, WorkItemViewState } from "./work-items";

export const UI_STATE_FILE = "ui-state.json";
export const UI_STATE_VERSION = 1;

const PAGES = new Set(["week", "all", "inbox", "review", "graph", "cleanup"]);
const FILTERS = new Set(["all", "today", "active", "future", "closed"]);

/**
 * 落盘文件结构：外层携带版本号便于演进，实际状态放在 projectViewState 下。
 */
export function wrapViewStateFile(state: WorkItemViewState): { version: number; projectViewState: WorkItemViewState } {
    return { version: UI_STATE_VERSION, projectViewState: state };
}

/**
 * 解析落盘文件内容（对象或 JSON 字符串）。
 * 兼容 { version, projectViewState } 包装结构与裸状态对象；损坏时返回 null，由调用方回落默认。
 */
export function parseViewStateFile(value: unknown): WorkItemViewState | null {
    if (value === null || value === undefined || value === "") return null;
    let parsed: unknown = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value);
        } catch {
            return null;
        }
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (record.projectViewState !== undefined) return parseViewState(record.projectViewState);
    }
    return parseViewState(parsed);
}

/**
 * 严格解析持久化的项目视图状态。
 * 任何关键字段非法时整体视为不可用（返回 null），由调用方回落默认；不抛异常。
 */
export function parseViewState(value: unknown): WorkItemViewState | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    if (typeof source.page !== "string" || !PAGES.has(source.page)) return null;
    if (typeof source.filter !== "string" || !FILTERS.has(source.filter)) return null;
    return {
        page: source.page as WorkItemViewState["page"],
        filter: source.filter as WorkItemViewState["filter"],
        includeClosed: source.includeClosed === true,
        scope: typeof source.scope === "string" ? source.scope : "all",
        selectedId: typeof source.selectedId === "string" && source.selectedId ? source.selectedId : null,
        expandedIds: Array.isArray(source.expandedIds)
            ? [...new Set(source.expandedIds.filter((id): id is string => typeof id === "string" && Boolean(id)))]
            : [],
        weekStart: finiteNumber(source.weekStart) ?? startOfWeek(Date.now()),
        sidebarScrollTop: finiteNumber(source.sidebarScrollTop) ?? 0,
        treeScrollTop: finiteNumber(source.treeScrollTop) ?? 0,
        detailScrollTop: finiteNumber(source.detailScrollTop) ?? 0,
    };
}

/**
 * 恢复选中项不可见时的确定性回落：
 * 1. 优先“今日有未完成切片”的事务（切片数最多者；并列按树显示顺序，即层级浏览从上往下）；
 * 2. 否则取树显示顺序中第一个可见事务。
 */
export function pickFallbackTransaction(
    items: WorkItem[],
    tree: WorkItemTree,
    visibleIds: Set<string>,
    now = Date.now(),
): string | null {
    const visible = flattenWorkItemTree(tree).filter(
        (item) => item.type === "事务" && visibleIds.has(item.id) && !isClosed(item),
    );
    if (visible.length === 0) return null;
    const counts = getTodayFocusCounts(items, tree, now);
    const candidates = visible
        .map((item) => ({ item, count: counts.get(item.id) ?? 0 }))
        .filter((entry) => entry.count > 0);
    // 稳定排序：计数相同者保持树显示顺序
    candidates.sort((a, b) => b.count - a.count);
    return (candidates[0]?.item ?? visible[0]).id;
}

function localDateKey(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfWeek(timestamp: number): number {
    const date = new Date(timestamp);
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - mondayOffset);
    return date.getTime();
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
