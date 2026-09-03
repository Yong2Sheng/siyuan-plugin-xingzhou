import type { WorkItemData } from "./work-items";

export const DEPENDENCIES_FILE = "dependencies.json";

export type StoredDependency = {
    hard: string[];
    soft: string[];
};

export type DependencyStorage = {
    version: 1;
    databases: Record<string, Record<string, StoredDependency>>;
};

export function normalizeDependencyStorage(value: unknown): DependencyStorage {
    const result: DependencyStorage = { version: 1, databases: {} };
    if (!value || typeof value !== "object") return result;
    const databases = (value as { databases?: unknown }).databases;
    if (!databases || typeof databases !== "object") return result;
    for (const [databaseId, records] of Object.entries(databases)) {
        if (!records || typeof records !== "object") continue;
        result.databases[databaseId] = {};
        for (const [itemId, raw] of Object.entries(records)) {
            if (!raw || typeof raw !== "object") continue;
            const dependency = raw as { hard?: unknown; soft?: unknown };
            result.databases[databaseId][itemId] = {
                hard: normalizeIds(dependency.hard),
                soft: normalizeIds(dependency.soft),
            };
        }
    }
    return result;
}

export function applyDependencyStorage(data: WorkItemData, storage: DependencyStorage): WorkItemData {
    const records = storage.databases[data.attributeViewId] ?? {};
    return {
        ...data,
        items: data.items.map((item) => ({
            ...item,
            hardPrerequisiteIds: records[item.id]?.hard ?? [],
            softPrerequisiteIds: records[item.id]?.soft ?? [],
        })),
    };
}

export function setStoredDependency(
    storage: DependencyStorage,
    databaseId: string,
    itemId: string,
    dependency: StoredDependency,
): DependencyStorage {
    const next = normalizeDependencyStorage(storage);
    const records = { ...(next.databases[databaseId] ?? {}) };
    const normalized = { hard: normalizeIds(dependency.hard), soft: normalizeIds(dependency.soft) };
    if (normalized.hard.length || normalized.soft.length) records[itemId] = normalized;
    else delete records[itemId];
    return { ...next, databases: { ...next.databases, [databaseId]: records } };
}

export function removeStoredItem(storage: DependencyStorage, databaseId: string, itemId: string): DependencyStorage {
    const next = normalizeDependencyStorage(storage);
    const records = { ...(next.databases[databaseId] ?? {}) };
    delete records[itemId];
    for (const [id, dependency] of Object.entries(records)) {
        records[id] = {
            hard: dependency.hard.filter((candidate) => candidate !== itemId),
            soft: dependency.soft.filter((candidate) => candidate !== itemId),
        };
        if (!records[id].hard.length && !records[id].soft.length) delete records[id];
    }
    return { ...next, databases: { ...next.databases, [databaseId]: records } };
}

function normalizeIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id): id is string => typeof id === "string" && Boolean(id)))];
}
