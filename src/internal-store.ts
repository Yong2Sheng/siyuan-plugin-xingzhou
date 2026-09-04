import type { WorkItem, WorkItemChanges, WorkItemData, WorkItemField } from "./work-items";
import { normalizeExecutionSlices } from "./execution-slices";

export const INTERNAL_STORE_FILE = "work-items.json";
export const MIGRATION_SNAPSHOT_FILE = "migration-source-snapshot.json";
export const INTERNAL_STORE_VERSION = 2;
export const INTERNAL_DATA_SOURCE_ID = "xingzhou-internal";

export function isAbsentInternalStore(value: unknown): boolean {
    if (value === null || value === undefined || value === "") return true;
    if (typeof value !== "object" || Array.isArray(value)) return false;
    return Object.keys(value).length === 0;
}

export type InternalWorkItemStore = {
    version: 2;
    revision: number;
    createdAt: number;
    updatedAt: number;
    items: WorkItem[];
    migration?: {
        source: "attribute-view";
        sourceId: string;
        importedAt: number;
        itemCount: number;
    };
};

export function parseInternalStore(value: unknown): InternalWorkItemStore | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<Omit<InternalWorkItemStore, "version">> & { version?: unknown };
    if ((source.version !== 1 && source.version !== INTERNAL_STORE_VERSION) || !Array.isArray(source.items)) return null;
    const ids = new Set<string>();
    const items: WorkItem[] = [];
    for (const raw of source.items) {
        const item = normalizeWorkItem(raw);
        if (!item || ids.has(item.id)) return null;
        ids.add(item.id);
        items.push(item);
    }
    const createdAt = finiteNumber(source.createdAt) ?? Date.now();
    return {
        version: INTERNAL_STORE_VERSION,
        revision: Math.max(0, Math.trunc(finiteNumber(source.revision) ?? 0)),
        createdAt,
        updatedAt: finiteNumber(source.updatedAt) ?? createdAt,
        items,
        ...(source.migration?.source === "attribute-view" && typeof source.migration.sourceId === "string"
            ? { migration: {
                source: "attribute-view" as const,
                sourceId: source.migration.sourceId,
                importedAt: finiteNumber(source.migration.importedAt) ?? createdAt,
                itemCount: Math.max(0, Math.trunc(finiteNumber(source.migration.itemCount) ?? items.length)),
            } }
            : {}),
    };
}

export function migrateWorkItemData(data: WorkItemData, now = Date.now()): InternalWorkItemStore {
    const items = data.items.map((item) => normalizeWorkItem(item)).filter((item): item is WorkItem => Boolean(item));
    if (items.length !== data.items.length) throw new Error("旧数据库中存在无法识别的工作项，已停止迁移以避免数据丢失。");
    return {
        version: INTERNAL_STORE_VERSION,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        items,
        migration: {
            source: "attribute-view",
            sourceId: data.attributeViewId,
            importedAt: now,
            itemCount: items.length,
        },
    };
}

export function createEmptyInternalStore(now = Date.now()): InternalWorkItemStore {
    return {
        version: INTERNAL_STORE_VERSION,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        items: [],
    };
}

export function toInternalWorkItemData(store: InternalWorkItemStore): WorkItemData {
    return {
        attributeViewId: INTERNAL_DATA_SOURCE_ID,
        attributeViewName: "行舟内部数据",
        viewId: "all",
        items: store.items.map(cloneWorkItem),
        missingFields: [],
        fields: internalFields(),
    };
}

export function updateStoredWorkItem(
    store: InternalWorkItemStore,
    itemId: string,
    changes: WorkItemChanges,
    now = Date.now(),
): InternalWorkItemStore {
    let found = false;
    const original = store.items.find((item) => item.id === itemId || item.rowId === itemId);
    let items = store.items.map((item) => {
        if (item.id !== itemId && item.rowId !== itemId) return cloneWorkItem(item);
        found = true;
        return applyChanges(item, changes, now);
    });
    if (!found) throw new Error("内部数据中没有找到要修改的工作项，请刷新后重试。");
    const moved = items.find((item) => item.id === itemId || item.rowId === itemId);
    const oldParentId = original?.parentIds[0] ?? null;
    const newParentId = moved?.parentIds[0] ?? null;
    if (changes.parent !== undefined && moved && oldParentId !== newParentId) {
        items = normalizeOrdersAfterParentChange(items, moved.id, oldParentId, newParentId);
    }
    return nextRevision(store, items, now);
}

export function addStoredWorkItem(
    store: InternalWorkItemStore,
    title: string,
    id: string,
    options: { type?: string; status?: string; parentId?: string; topProjectId?: string } = {},
    now = Date.now(),
): InternalWorkItemStore {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new Error("请输入要记录的内容。");
    if (!id || store.items.some((item) => item.id === id || item.rowId === id)) throw new Error("无法生成唯一的工作项 ID，请重试。");
    const parentId = options.parentId || null;
    const siblings = store.items
        .filter((candidate) => (candidate.parentIds[0] ?? null) === parentId)
        .sort(compareStoredOrder);
    const siblingOrder = new Map(siblings.map((candidate, index) => [candidate.id, index]));
    const existingItems = store.items.map((candidate) => siblingOrder.has(candidate.id)
        ? { ...cloneWorkItem(candidate), sortOrder: siblingOrder.get(candidate.id) ?? null }
        : cloneWorkItem(candidate));
    const item: WorkItem = {
        id,
        rowId: id,
        title: normalizedTitle,
        documentId: null,
        detached: true,
        type: options.type ?? "",
        status: options.status ?? "收件箱",
        currentAction: "",
        nextAction: "",
        parentIds: options.parentId ? [options.parentId] : [],
        topProjectIds: options.topProjectId ? [options.topProjectId] : [],
        hardPrerequisiteIds: [],
        softPrerequisiteIds: [],
        completedDates: [],
        sliceTargetCount: null,
        executionSlices: [],
        planDate: null,
        deadline: null,
        noDeadline: false,
        durationMinutes: null,
        energy: "",
        updatedAt: now,
        sortOrder: siblings.length,
    };
    return nextRevision(store, [...existingItems, item], now);
}

export function removeStoredWorkItem(store: InternalWorkItemStore, itemId: string, now = Date.now()): InternalWorkItemStore {
    if (!store.items.some((item) => item.id === itemId || item.rowId === itemId)) {
        throw new Error("内部数据中没有找到要删除的工作项，请刷新后重试。");
    }
    const items = store.items
        .filter((item) => item.id !== itemId && item.rowId !== itemId)
        .map((item) => ({
            ...cloneWorkItem(item),
            parentIds: item.parentIds.filter((id) => id !== itemId),
            topProjectIds: item.topProjectIds.filter((id) => id !== itemId),
            hardPrerequisiteIds: (item.hardPrerequisiteIds ?? []).filter((id) => id !== itemId),
            softPrerequisiteIds: (item.softPrerequisiteIds ?? []).filter((id) => id !== itemId),
        }));
    return nextRevision(store, items, now);
}

export function reorderStoredWorkItems(
    store: InternalWorkItemStore,
    parentId: string | null,
    orderedIds: string[],
    now = Date.now(),
): InternalWorkItemStore {
    const siblings = store.items.filter((item) => (item.parentIds[0] ?? null) === parentId);
    const siblingIds = new Set(siblings.map((item) => item.id));
    if (orderedIds.length !== siblings.length || new Set(orderedIds).size !== orderedIds.length
        || orderedIds.some((id) => !siblingIds.has(id))) {
        throw new Error("同级工作项已发生变化，请刷新后重试排序。");
    }
    const orderById = new Map(orderedIds.map((id, index) => [id, index]));
    const items = store.items.map((item) => siblingIds.has(item.id)
        ? { ...cloneWorkItem(item), sortOrder: orderById.get(item.id) ?? null }
        : cloneWorkItem(item));
    return nextRevision(store, items, now);
}

export function storesMatch(expected: InternalWorkItemStore, actual: InternalWorkItemStore): boolean {
    return JSON.stringify(expected) === JSON.stringify(actual);
}

export function backupFileForRevision(revision: number): string {
    return `work-items.backup-${Math.abs(revision - 1) % 3 + 1}.json`;
}

function applyChanges(item: WorkItem, changes: WorkItemChanges, now: number): WorkItem {
    const next = cloneWorkItem(item);
    if (changes.title !== undefined) {
        const title = String(changes.title ?? "").trim();
        if (!title) throw new Error("名称不能为空。");
        next.title = title;
    }
    if (changes.type !== undefined) next.type = String(changes.type ?? "");
    if (changes.status !== undefined) next.status = String(changes.status ?? "");
    if (changes.currentAction !== undefined) next.currentAction = String(changes.currentAction ?? "");
    if (changes.nextAction !== undefined) next.nextAction = String(changes.nextAction ?? "");
    if (changes.parent !== undefined) next.parentIds = changes.parent ? [String(changes.parent)] : [];
    if (changes.topProject !== undefined) next.topProjectIds = changes.topProject ? [String(changes.topProject)] : [];
    if (changes.hardPrerequisites !== undefined) next.hardPrerequisiteIds = normalizeIds(changes.hardPrerequisites);
    if (changes.softPrerequisites !== undefined) next.softPrerequisiteIds = normalizeIds(changes.softPrerequisites);
    if (changes.completedDates !== undefined) next.completedDates = normalizeDateKeys(changes.completedDates);
    if (changes.sliceTargetCount !== undefined) next.sliceTargetCount = normalizeSliceTarget(changes.sliceTargetCount);
    if (changes.executionSlices !== undefined) next.executionSlices = normalizeExecutionSlices(changes.executionSlices);
    if (changes.planDate !== undefined) next.planDate = normalizeDate(changes.planDate);
    if (changes.deadline !== undefined) next.deadline = normalizeDate(changes.deadline);
    if (changes.noDeadline !== undefined) next.noDeadline = Boolean(changes.noDeadline);
    if (changes.duration !== undefined) next.durationMinutes = changes.duration === null || changes.duration === "" ? null : Number(changes.duration);
    if (changes.energy !== undefined) next.energy = String(changes.energy ?? "");
    next.updatedAt = now;
    return next;
}

function nextRevision(store: InternalWorkItemStore, items: WorkItem[], now: number): InternalWorkItemStore {
    return {
        ...store,
        revision: store.revision + 1,
        updatedAt: now,
        items,
    };
}

function normalizeWorkItem(value: unknown): WorkItem | null {
    if (!value || typeof value !== "object") return null;
    const item = value as Partial<WorkItem>;
    if (typeof item.id !== "string" || !item.id || typeof item.title !== "string" || !item.title.trim()) return null;
    return {
        id: item.id,
        rowId: typeof item.rowId === "string" && item.rowId ? item.rowId : item.id,
        title: item.title.trim(),
        documentId: typeof item.documentId === "string" && item.documentId ? item.documentId : null,
        detached: Boolean(item.detached),
        type: stringValue(item.type),
        status: stringValue(item.status),
        currentAction: stringValue(item.currentAction),
        nextAction: stringValue(item.nextAction),
        parentIds: normalizeIds(item.parentIds),
        topProjectIds: normalizeIds(item.topProjectIds),
        hardPrerequisiteIds: normalizeIds(item.hardPrerequisiteIds),
        softPrerequisiteIds: normalizeIds(item.softPrerequisiteIds),
        completedDates: normalizeDateKeys(item.completedDates),
        sliceTargetCount: normalizeSliceTarget(item.sliceTargetCount),
        executionSlices: normalizeExecutionSlices(item.executionSlices),
        planDate: nullableNumber(item.planDate),
        deadline: nullableNumber(item.deadline),
        noDeadline: Boolean(item.noDeadline),
        durationMinutes: nullableNumber(item.durationMinutes),
        energy: stringValue(item.energy),
        updatedAt: nullableNumber(item.updatedAt),
        sortOrder: nullableNumber(item.sortOrder),
    };
}

function cloneWorkItem(item: WorkItem): WorkItem {
    return {
        ...item,
        parentIds: [...item.parentIds],
        topProjectIds: [...item.topProjectIds],
        hardPrerequisiteIds: [...(item.hardPrerequisiteIds ?? [])],
        softPrerequisiteIds: [...(item.softPrerequisiteIds ?? [])],
        completedDates: [...(item.completedDates ?? [])],
        executionSlices: normalizeExecutionSlices(item.executionSlices),
    };
}

function internalFields(): WorkItemData["fields"] {
    const field = (id: string, name: string, type: string, options: WorkItemField["options"] = []): WorkItemField => ({ id, name, type, options });
    return {
        title: field("title", "工作项", "block"),
        type: field("type", "工作项类型", "select", ["项目", "长期领域", "任务", "事务", "想法"].map((name) => ({ name }))),
        status: field("status", "状态", "select"),
        currentAction: field("currentAction", "本次行动细则", "text"),
        nextAction: field("nextAction", "下一步行动", "text"),
        parent: field("parent", "上层工作项", "relation"),
        topProject: field("topProject", "所属顶层项目", "relation"),
        planDate: field("planDate", "计划日期", "date"),
        deadline: field("deadline", "截止日期", "date"),
        noDeadline: field("noDeadline", "无截止日期", "checkbox"),
        duration: field("duration", "预计时长（分钟）", "number"),
        energy: field("energy", "所需精力", "select", ["低", "中", "高"].map((name) => ({ name }))),
    };
}

function normalizeIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id): id is string => typeof id === "string" && Boolean(id)))];
}

function normalizeDateKeys(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
}

function normalizeSliceTarget(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 366 ? value : null;
}

function normalizeDate(value: string | number | boolean | null): number | null {
    if (value === null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    const timestamp = new Date(`${value}T00:00:00`).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

function nullableNumber(value: unknown): number | null {
    return finiteNumber(value);
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function compareStoredOrder(a: WorkItem, b: WorkItem): number {
    const aOrder = finiteNumber(a.sortOrder);
    const bOrder = finiteNumber(b.sortOrder);
    if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
    if (aOrder !== null && bOrder === null) return -1;
    if (aOrder === null && bOrder !== null) return 1;
    return a.title.localeCompare(b.title, "zh-CN");
}

function normalizeOrdersAfterParentChange(items: WorkItem[], movedId: string, oldParentId: string | null, newParentId: string | null): WorkItem[] {
    const oldSiblings = items
        .filter((item) => item.id !== movedId && (item.parentIds[0] ?? null) === oldParentId)
        .sort(compareStoredOrder);
    const newSiblings = items
        .filter((item) => item.id !== movedId && (item.parentIds[0] ?? null) === newParentId)
        .sort(compareStoredOrder);
    const oldOrder = new Map(oldSiblings.map((item, index) => [item.id, index]));
    const newOrder = new Map(newSiblings.map((item, index) => [item.id, index]));
    return items.map((item) => {
        if (item.id === movedId) return { ...item, sortOrder: newSiblings.length };
        if (oldOrder.has(item.id)) return { ...item, sortOrder: oldOrder.get(item.id) ?? null };
        if (newOrder.has(item.id)) return { ...item, sortOrder: newOrder.get(item.id) ?? null };
        return item;
    });
}
