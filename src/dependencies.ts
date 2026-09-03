import type { WorkItem } from "./work-items";

export type DependencyKind = "hardPrerequisites" | "softPrerequisites";

export function prerequisiteIds(item: WorkItem, kind?: DependencyKind): string[] {
    if (kind === "hardPrerequisites") return item.hardPrerequisiteIds ?? [];
    if (kind === "softPrerequisites") return item.softPrerequisiteIds ?? [];
    return [...new Set([...(item.hardPrerequisiteIds ?? []), ...(item.softPrerequisiteIds ?? [])])];
}

export function validateDependencyUpdate(
    items: WorkItem[],
    itemId: string,
    kind: DependencyKind,
    nextIds: string[],
): string | null {
    if (nextIds.includes(itemId)) return "工作项不能依赖自身。";
    const byId = new Map(items.map((item) => [item.id, item]));
    const missing = nextIds.find((id) => !byId.has(id));
    if (missing) return "所选前置工作项已不在当前数据库中，请刷新后重试。";
    const current = byId.get(itemId);
    const otherKind: DependencyKind = kind === "hardPrerequisites" ? "softPrerequisites" : "hardPrerequisites";
    if (current && nextIds.some((id) => prerequisiteIds(current, otherKind).includes(id))) {
        return "同一前置项不能同时设为“完成后开始”和“需先行”。";
    }

    const overrides = new Map<string, string[]>([[itemId, [...new Set(nextIds)]]]);
    const edges = (id: string): string[] => {
        const item = byId.get(id);
        if (!item) return [];
        const hard = kind === "hardPrerequisites" && overrides.has(id) ? overrides.get(id)! : prerequisiteIds(item, "hardPrerequisites");
        const soft = kind === "softPrerequisites" && overrides.has(id) ? overrides.get(id)! : prerequisiteIds(item, "softPrerequisites");
        return [...new Set([...hard, ...soft])];
    };
    const seen = new Set<string>();
    const visit = (id: string): boolean => {
        if (id === itemId) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return edges(id).some(visit);
    };
    if (edges(itemId).some((id) => visit(id))) return "这项设置会形成循环依赖，请先调整已有关系。";
    return null;
}

export function dependencyCycleIds(items: WorkItem[]): Set<string> {
    const byId = new Map(items.map((item) => [item.id, item]));
    const state = new Map<string, "visiting" | "visited">();
    const stack: string[] = [];
    const cycleIds = new Set<string>();
    const visit = (id: string) => {
        state.set(id, "visiting");
        stack.push(id);
        const item = byId.get(id);
        for (const next of item ? prerequisiteIds(item) : []) {
            if (!byId.has(next)) continue;
            if (state.get(next) === "visiting") {
                const cycleStart = stack.lastIndexOf(next);
                for (const cycleId of stack.slice(cycleStart)) cycleIds.add(cycleId);
            } else if (!state.has(next)) {
                visit(next);
            }
        }
        stack.pop();
        state.set(id, "visited");
    };
    for (const item of items) {
        if (!state.has(item.id)) visit(item.id);
    }
    return cycleIds;
}
