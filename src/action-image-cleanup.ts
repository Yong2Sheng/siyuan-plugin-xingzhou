import { listActionImages, removeImageLine, type ActionImageItem } from "./action-images";
import { isClosed } from "./tree";
import type { WorkItem } from "./work-items";

/** 条目进入终态后图片的宽限期：到期前只提醒，删除前一律再确认一次。 */
export const IMAGE_CLEANUP_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ActionImageCleanup = {
    /** 进入待清理的时间戳，用于计算倒计时。 */
    startedAt: number;
    /** 登记时引用的图片路径，清理范围不会超出这里。 */
    paths: string[];
};

export type ImageCleanupActionField = "currentAction" | "nextAction";

export type ImageCleanupTextUpdate = {
    itemId: string;
    field: ImageCleanupActionField;
    /** 目标细则文本。 */
    text: string;
    /** 用摘掉图片引用后的内容替换对应字段。 */
    changes: Partial<Record<ImageCleanupActionField, string>>;
    /** 这条细则里将被删除的图片路径。 */
    removable: string[];
    /** 这条细则里保留（改由笔记或其它条目承担）的图片路径。 */
    kept: string[];
    /** 清理完成后是否还有图片引用。 */
    hasImagesAfter: boolean;
};

/**
 * 计算一次清理的执行范围：
 * - 只处理条目 imageCleanup 登记过的图片，之后新贴的图不会被牵连；
 * - 被其它未结束条目引用的图片只摘引用、保留文件。
 */
export function buildImageCleanupPlan(
    targets: WorkItem[],
    allItems: WorkItem[],
    options: { includeDescendants?: boolean; onlyPaths?: string[] } = {},
): ImageCleanupTextUpdate[] {
    const withDescendants = options.includeDescendants !== false;
    const ids: string[] = [];
    for (const target of targets) {
        if (!ids.includes(target.id)) ids.push(target.id);
        if (!withDescendants) continue;
        for (const child of descendantsOf(target.id, allItems)) {
            if (!ids.includes(child.id)) ids.push(child.id);
        }
    }
    const scope = new Set(ids);

    const plan: ImageCleanupTextUpdate[] = [];
    for (const itemId of ids) {
        const item = allItems.find((candidate) => candidate.id === itemId);
        if (!item || !item.imageCleanup) continue;
        const registered = new Set(item.imageCleanup.paths);
        const removableHere: string[] = [];
        const keptHere: string[] = [];
        const changes: ImageCleanupTextUpdate["changes"] = {};
        const textAfter: string[] = [];

        for (const field of ["currentAction", "nextAction"] as ImageCleanupActionField[]) {
            const source = item[field];
            const scoped = listActionImages(source).filter((image) => Boolean(image.src) && registered.has(image.src));
            if (scoped.length === 0) continue;

            let next = source;
            for (const image of scoped) {
                const blocked = isReferencedElsewhere(image.src, itemId, scope, allItems);
                // onlyPaths：调用方已按勾选缩小范围时，文本变更必须与之一致，
                // 否则会出现"列表剔除了某张、文本里却把它删了"
                const allowed = !options.onlyPaths || options.onlyPaths.includes(image.src);
                if (blocked || !allowed) {
                    if (!keptHere.includes(image.src)) keptHere.push(image.src);
                    continue;
                }
                next = removeImageLine(next, image.syntax);
                if (!removableHere.includes(image.src)) removableHere.push(image.src);
            }
            changes[field] = next;
            textAfter.push(next);
        }

        if (Object.keys(changes).length === 0) continue;
        plan.push({
            itemId,
            field: changes.currentAction !== undefined ? "currentAction" : "nextAction",
            text: textAfter.join("\n"),
            changes,
            removable: removableHere,
            kept: keptHere,
            hasImagesAfter: textAfter.some((text) => listActionImages(text).some((image) => Boolean(image.src))),
        });
    }
    return plan;
}

/** 计划里将被真正删除的图片路径（去重）。 */
export function removablePathsOf(plan: ImageCleanupTextUpdate[]): string[] {
    const paths: string[] = [];
    for (const entry of plan) {
        for (const path of entry.removable) {
            if (!paths.includes(path)) paths.push(path);
        }
    }
    return paths;
}

/** 计划里被保留（仍被引用）的图片路径（去重）。 */
export function keptPathsOf(plan: ImageCleanupTextUpdate[]): string[] {
    const paths: string[] = [];
    for (const entry of plan) {
        for (const path of entry.kept) {
            if (!paths.includes(path)) paths.push(path);
        }
    }
    return paths;
}

/** 条目进入终态时的清理登记；已完成登记或没有图片时返回 null。 */
export function planCleanupForClosedItem(item: WorkItem, items: WorkItem[], now = Date.now()): ActionImageCleanup | null {
    if (item.imageCleanup) return null;
    const images = collectItemImages([item, ...descendantsOf(item.id, items)]);
    if (images.length === 0) return null;
    return { startedAt: now, paths: images };
}

/** 状态即将变为终态时，为保存流程准备 imageCleanup 字段。 */
export function cleanupForStatusChange(item: WorkItem, nextStatus: string, items: WorkItem[], now = Date.now()): ActionImageCleanup | null {
    if (item.imageCleanup || !isClosed({ ...item, status: nextStatus })) return null;
    return planCleanupForClosedItem({ ...item, status: nextStatus }, items, now);
}

export type ActionImageCleanupEntry = {
    item: WorkItem;
    images: ActionImageItem[];
    due: boolean;
    remainingDays: number;
};

/** 登记范围内、当前仍出现在细则里的图片。 */
export function cleanupImagesOf(item: WorkItem): ActionImageItem[] {
    const registered = new Set(item.imageCleanup?.paths ?? []);
    if (registered.size === 0) return [];
    return [...listActionImages(item.currentAction), ...listActionImages(item.nextAction)]
        .filter((image) => Boolean(image.src) && registered.has(image.src));
}

export function cleanupRemainingDays(cleanup: ActionImageCleanup, now = Date.now()): number {
    return Math.max(0, Math.ceil((cleanup.startedAt + IMAGE_CLEANUP_GRACE_DAYS * DAY_MS - now) / DAY_MS));
}

export function isCleanupDue(cleanup: ActionImageCleanup, now = Date.now()): boolean {
    return now >= cleanup.startedAt + IMAGE_CLEANUP_GRACE_DAYS * DAY_MS;
}

export function cleanupCountdownLabel(cleanup: ActionImageCleanup, now = Date.now()): string {
    return isCleanupDue(cleanup, now) ? "今天到期，可确认清理" : `还剩 ${cleanupRemainingDays(cleanup, now)} 天`;
}

/** 条目角标文案；没有待清理图片时返回 null。 */
export function cleanupBadgeLabel(item: WorkItem, now = Date.now()): string | null {
    if (!item.imageCleanup) return null;
    const total = cleanupImagesOf(item).length;
    return total > 0 ? `图片待清理 · ${cleanupCountdownLabel(item.imageCleanup, now)}` : null;
}

/** 待清理面板的数据；不再终态（例如改回进行中）的条目自动排除。 */
export function listPendingImageCleanup(items: WorkItem[], now = Date.now()): ActionImageCleanupEntry[] {
    return items
        .filter((item) => Boolean(item.imageCleanup) && isClosed(item))
        .map((item) => ({
            item,
            images: cleanupImagesOf(item),
            due: isCleanupDue(item.imageCleanup!, now),
            remainingDays: cleanupRemainingDays(item.imageCleanup!, now),
        }))
        .filter((entry) => entry.images.length > 0)
        .sort((a, b) => Number(b.due) - Number(a.due) || (a.item.imageCleanup?.startedAt ?? 0) - (b.item.imageCleanup?.startedAt ?? 0));
}

/** 按 parentIds 递归收集下级，带环路保护。 */
export function descendantsOf(itemId: string, items: WorkItem[]): WorkItem[] {
    const children = new Map<string, WorkItem[]>();
    for (const item of items) {
        const parentId = item.parentIds[0];
        if (!parentId) continue;
        const bucket = children.get(parentId) ?? [];
        bucket.push(item);
        children.set(parentId, bucket);
    }
    const seen = new Set<string>([itemId]);
    const result: WorkItem[] = [];
    const queue = [...(children.get(itemId) ?? [])];
    while (queue.length > 0) {
        const item = queue.shift()!;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        result.push(item);
        queue.push(...(children.get(item.id) ?? []));
    }
    return result;
}

/** 条目在树中的上级标题链，用于确认窗里说明"为什么要清它"。 */
export function cleanupParentChain(item: WorkItem, items: WorkItem[]): string[] {
    const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
    const chain: string[] = [];
    const seen = new Set<string>([item.id]);
    let parentId = item.parentIds[0];
    while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = byId.get(parentId);
        if (!parent) break;
        chain.unshift(parent.title);
        parentId = parent.parentIds[0];
    }
    return chain;
}

function collectItemImages(items: WorkItem[]): string[] {
    const paths: string[] = [];
    for (const item of items) {
        for (const image of [...listActionImages(item.currentAction), ...listActionImages(item.nextAction)]) {
            if (image.src && !paths.includes(image.src)) paths.push(image.src);
        }
    }
    return paths;
}

function isReferencedElsewhere(src: string, itemId: string, scope: Set<string>, allItems: WorkItem[]): boolean {
    return allItems.some((candidate) => {
        if (candidate.id === itemId || scope.has(candidate.id) || isClosed(candidate)) return false;
        return [...listActionImages(candidate.currentAction), ...listActionImages(candidate.nextAction)].some((image) => image.src === src);
    });
}

/** 图库体检的统计（第 ⑤ 区块，只统计行舟引用的图片，同一张只算一份）。 */
export type ActionImageStorageStats = {
    /** 未结束条目数 */
    itemCount: number;
    /** 未结束条目引用的去重图片数 */
    imageCount: number;
    /** 上述图片的字节合计（取不到体积的不计入） */
    bytes: number;
    /** 取不到体积的图片数 */
    missingSize: number;
    /** 已结束但仍持有图片的条目数 */
    pendingItemCount: number;
    /** 这些条目引用的去重图片数 */
    pendingImageCount: number;
    /** 按占用从大到小的条目（仅含引用了图片的条目） */
    topItems: Array<{ item: WorkItem; count: number; bytes: number }>;
};

function imageSourcesOf(item: WorkItem): string[] {
    const seen = new Set<string>();
    const srcs: string[] = [];
    for (const image of [...listActionImages(item.currentAction), ...listActionImages(item.nextAction)]) {
        if (!image.src || seen.has(image.src)) continue;
        seen.add(image.src);
        srcs.push(image.src);
    }
    return srcs;
}

export function buildStorageStats(items: WorkItem[], sizes: Record<string, number | null>): ActionImageStorageStats {
    const active = items.filter((item) => !isClosed(item));
    const pending = items.filter((item) => Boolean(item.imageCleanup) && isClosed(item));
    const counted = new Set<string>();
    let bytes = 0;
    let missingSize = 0;

    const countOnce = (srcList: string[]): number => {
        let fresh = 0;
        for (const src of srcList) {
            if (counted.has(src)) continue;
            counted.add(src);
            fresh += 1;
            const size = sizes[src];
            if (typeof size === "number" && size > 0) bytes += size;
            else missingSize += 1;
        }
        return fresh;
    };

    const topItems: ActionImageStorageStats["topItems"] = [];
    for (const item of active) {
        const srcs = imageSourcesOf(item);
        if (srcs.length === 0) continue;
        countOnce(srcs);
        topItems.push({
            item,
            count: srcs.length,
            bytes: srcs.reduce((sum, src) => sum + (sizes[src] ?? 0), 0),
        });
    }
    topItems.sort((a, b) => b.bytes - a.bytes || b.count - a.count);

    let pendingImageCount = 0;
    for (const item of pending) {
        pendingImageCount += countOnce(imageSourcesOf(item));
    }

    return {
        itemCount: active.length,
        imageCount: counted.size,
        bytes,
        missingSize,
        pendingItemCount: pending.length,
        pendingImageCount,
        topItems,
    };
}

/** 某张图片是否仍被"未结束的其它条目"引用（引用方标题一并返回，便于说明为什么保留）。 */
export function referencingActiveItems(src: string, itemIds: string[], allItems: WorkItem[]): WorkItem[] {
    const scope = new Set(itemIds);
    return allItems.filter((candidate) => {
        if (scope.has(candidate.id) || isClosed(candidate)) return false;
        return [...listActionImages(candidate.currentAction), ...listActionImages(candidate.nextAction)].some((image) => image.src === src);
    });
}
