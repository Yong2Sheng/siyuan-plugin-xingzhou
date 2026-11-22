/**
 * 入口（从哪继续）：类型清单 + 「用过的入口」收集。
 *
 * 收集口径照搬拾绪的 collectEntryHistory：同一「类型 + 位置」去重，最近用的排前面；
 * 本事务用过的排在最前，其他事务的带来源标注——这样在别的活里用过的同一个 notebook，
 * 在这里也能一点就填，不用每次重打一遍。
 *
 * 图标不在这里：内联 SVG 在 EntryIcon.svelte 里（组件层负责渲染，这里只管数据）。
 */
import type { ActionEntryPoint } from "./action-detail";
import type { WorkItem } from "./work-items";

export const ENTRY_TYPES: Array<{ value: string; label: string }> = [
    { value: "chatgpt", label: "ChatGPT" },
    { value: "dsh", label: "DeepSeek Harness" },
    { value: "jupyter", label: "Jupyter Notebook" },
    { value: "vscode", label: "VS Code" },
    { value: "terminal", label: "终端" },
    { value: "siyuan", label: "思源" },
    { value: "browser", label: "浏览器" },
    { value: "powerpoint", label: "PowerPoint" },
    { value: "file", label: "本地文件" },
    { value: "folder", label: "文件夹" },
    { value: "other", label: "其他" },
];

export function entryTypeLabel(value: string): string {
    return ENTRY_TYPES.find((item) => item.value === value)?.label ?? "其他";
}

export function entryKey(entry: Pick<ActionEntryPoint, "type" | "target">): string {
    return `${entry.type}|${entry.target}`;
}

export type EntryUsage = {
    key: string;
    type: string;
    label: string;
    target: string;
    usedAt: number;
    count: number;
    /** 来源工作项；等于当前工作项时界面不显示来源 */
    itemId: string;
    itemTitle: string;
};

/**
 * 收集全部工作项里用过的入口。
 *
 * 只收有位置的入口（没位置就无从「继续」）；没有位置的老数据不进入候选，但仍留在断点里。
 */
export function collectEntryUsages(items: WorkItem[], currentItemId: string | null): EntryUsage[] {
    const byKey = new Map<string, EntryUsage>();
    for (const item of items) {
        for (const checkpoint of item.actionDetail?.checkpoints ?? []) {
            const entry = checkpoint.entry;
            if (!entry || !entry.target.trim()) continue;
            const key = entryKey(entry);
            const usedAt = checkpoint.createdAt;
            const existing = byKey.get(key);
            if (existing) {
                existing.count += 1;
                if (usedAt >= existing.usedAt) {
                    existing.usedAt = usedAt;
                    existing.label = entry.label;
                    existing.itemId = item.id;
                    existing.itemTitle = item.title;
                }
                continue;
            }
            byKey.set(key, {
                key,
                type: entry.type,
                label: entry.label,
                target: entry.target,
                usedAt,
                count: 1,
                itemId: item.id,
                itemTitle: item.title,
            });
        }
    }
    const all = [...byKey.values()];
    const own = all.filter((item) => item.itemId === currentItemId).sort((a, b) => b.usedAt - a.usedAt);
    const others = all.filter((item) => item.itemId !== currentItemId).sort((a, b) => b.usedAt - a.usedAt);
    return [...own, ...others];
}
