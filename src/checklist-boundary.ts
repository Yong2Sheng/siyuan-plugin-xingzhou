/**
 * 边界提醒：checklist 里那些「成段的流程你都记得，但转场处一定会漏」的离散事件
 * （随餐鱼油、平光镜进书包、到点吃饭、下班收尾）。
 *
 * 它们的共同点是粘在一个「你已经在做别的事」的时刻上，所以不能等人来查看清单；
 * 由「今日记录」按时间主动浮现，才能覆盖「不会想到看清单」的那一刻。
 *
 * 本模块只做纯计算（时间窗口、排序、摘要），不做任何持久化：
 * 勾选状态仍写在 checklist.json 的 reminderStates 里，与「每日 Checklist」共用同一份数据。
 */

import { localDateKey } from "./execution-slices";
import { boundaryKeyFor, type ChecklistEntry, type ChecklistReminder, type ChecklistTemplate, type ChecklistTrainingMode } from "./checklist";

/** 计划时刻已过多久之内仍算「现在要处理」。再久就降级到折叠区，避免翻旧账。 */
export const BOUNDARY_OVERDUE_MINUTES = 180;
/** 计划时刻在前方多久之内算「即将到来」。 */
export const BOUNDARY_SOON_MINUTES = 60;
/** 面板默认最多同时展开几项，其余收进折叠入口。 */
export const BOUNDARY_MAX_VISIBLE = 4;

export type ChecklistBoundaryItem = {
    /** 与 reminderStates 共用的稳定 key。 */
    key: string;
    entryId: string;
    /** 条目标题：面板上「该做什么」的主文案。 */
    entryTitle: string;
    /** 提醒原文：面板上的补充说明（例如「随餐鱼油 1 粒」）。 */
    reminder: string;
    /** 面板上显示在左侧的时刻。 */
    at: string;
    /** 计划时刻距今天 00:00 的分钟数。 */
    atMinutes: number;
    /** now − atMinutes：正数表示已过，负数表示还有多久。 */
    minutesFromNow: number;
    status: "overdue" | "soon" | "later";
};

export type ChecklistBoundaryAttention = {
    /** 真正需要现在处理的项：逾期未确认 + 60 分钟内即将到来，已按紧迫度排序。 */
    items: ChecklistBoundaryItem[];
    /** 今天更晚的边界项（按时间正序），面板会直接列出前几条，不做成只有一个数量的折叠入口。 */
    later: ChecklistBoundaryItem[];
    /** 今天已确认的边界项，用于在面板上留下「今天做到过」的痕迹。 */
    doneKeys: ChecklistBoundaryItem[];
    /** 今天已确认的边界项数量。 */
    doneCount: number;
    /** 今天总共配置了几个边界项，用于区分「都确认了」和「今天没有」。 */
    totalCount: number;
    /**
     * 当没有任何项需要现在处理时的标题。
     * 面板此时仍要显示后续项，所以标题要说清「接下来是什么」，而不是只说一句都做完了。
     */
    laterPreviewHeadline: string;
};

export type ChecklistBoundaryContext = {
    /** 记录日期（YYYY-MM-DD），与 checklist 的当日状态同一天。 */
    date: string;
    /** 日期类型：开会日覆盖星期模板，与 DailyChecklist 的取模板规则一致。 */
    dayType?: string | null;
    /** 周末训练日／休息日选择，决定读取哪一组提醒及其边界时间。 */
    trainingMode?: ChecklistTrainingMode;
    /** 当前时刻，测试时注入。 */
    now?: number;
};

/** 数字时钟角度语义：下午的时间若明显落在「未来」，视为凌晨看昨天的表，不当作今天的待办。 */
function parseClock(value: string, nowMinutes: number): { atMinutes: number; minutesFromNow: number } | null {
    const matched = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
    if (!matched) return null;
    const atMinutes = Number(matched[1]) * 60 + Number(matched[2]);
    let minutesFromNow = nowMinutes - atMinutes;
    if (minutesFromNow < -BOUNDARY_OVERDUE_MINUTES && nowMinutes < BOUNDARY_OVERDUE_MINUTES) minutesFromNow -= 24 * 60;
    return { atMinutes, minutesFromNow };
}

/** 与 DailyChecklist 相同的模板选取规则：开会日优先，其余按星期。 */
export function boundaryTemplateId(date: string, dayType?: string | null): ChecklistTemplate["id"] {
    if (dayType === "conference-day") return "conference";
    const weekday = new Date(`${date}T12:00:00`).getDay();
    return weekday === 6 ? "saturday" : weekday === 0 ? "sunday" : "workday";
}

/**
 * 列出某天的边界项，并按「是否需要现在处理」分组。
 * 已经确认完成的不再出现；标记为未完成的仍算待处理（那是还没做的事，不是做完了）。
 */
export function boundaryAttention(
    template: ChecklistTemplate,
    reminderStates: ReadonlyMap<string, string>,
    context: ChecklistBoundaryContext,
): ChecklistBoundaryAttention {
    const now = context.now ?? Date.now();
    const parsedNow = new Date(now);
    const nowMinutes = parsedNow.getHours() * 60 + parsedNow.getMinutes();
    const today = localDateKey(now);
    const mode: ChecklistTrainingMode = context.trainingMode ?? "";

    const all: ChecklistBoundaryItem[] = [];
    const doneKeys: ChecklistBoundaryItem[] = [];
    /*
     * 时间绑在提醒 id 上，因此这里只需按 id 精确命中，不需要再拿文本去核对——
     * 调整顺序、插入或删除别的提醒都不会影响命中；提醒本身被删掉时，
     * 保存编辑的一步已经把它名下的边界时间一并清掉了。
     */
    for (const entry of template.entries) {
        const groups = reminderGroups(entry, mode);
        for (const group of groups) {
            group.reminders.forEach((reminder) => {
                const key = boundaryKeyFor(entry.id, reminder.id);
                const at = entry.boundaries?.[key];
                if (!at) return;
                const clock = parseClock(at, nowMinutes);
                if (!clock) return;
                const text = reminder.text || entry.title;
                const base: ChecklistBoundaryItem = {
                    key,
                    entryId: entry.id,
                    entryTitle: entry.title,
                    reminder: text,
                    at,
                    atMinutes: clock.atMinutes,
                    minutesFromNow: clock.minutesFromNow,
                    status: "later",
                };
                if (reminderStates.get(key) === "completed") {
                    doneKeys.push(base);
                    return;
                }
                all.push(base);
            });
        }
    }

    /*
     * 「只显示今天」：当前日期的面板才会按时间浮出。
     * 翻到过去的某天补记录时不该冒出一堆逾期提醒，翻到将来的某天也不该提前催。
     */
    const isToday = context.date === today;
    const items = isToday
        ? all.filter((item) => {
            const overdue = item.minutesFromNow >= 0 && item.minutesFromNow <= BOUNDARY_OVERDUE_MINUTES;
            const soon = item.minutesFromNow < 0 && -item.minutesFromNow <= BOUNDARY_SOON_MINUTES;
            if (!overdue && !soon) return false;
            item.status = overdue ? "overdue" : "soon";
            return true;
        })
        : [];
    const visible = [...items]
        .sort((left, right) => {
            // 逾期在前，且「刚过点」比「过很久」更该先看到；其余按时间正序
            if (left.status !== right.status) return left.status === "overdue" ? -1 : 1;
            return left.status === "overdue" ? left.minutesFromNow - right.minutesFromNow : left.atMinutes - right.atMinutes;
        })
        .slice(0, BOUNDARY_MAX_VISIBLE);
    const visibleKeys = new Set(visible.map((item) => item.key));
    const later = isToday
        ? all.filter((item) => !visibleKeys.has(item.key)).sort((left, right) => left.atMinutes - right.atMinutes)
        : [];
    const done = isToday ? [...doneKeys].sort((left, right) => left.atMinutes - right.atMinutes) : [];
    const pending = later.filter((item) => item.minutesFromNow < 0);
    const laterPreviewHeadline = pending.length
        ? `接下来是 ${pending[0].at} 的${pending[0].entryTitle}`
        : later.length
            ? `今天还有 ${later.length} 项边界提醒`
            : "";
    return { items: visible, later, doneKeys: done, doneCount: done.length, totalCount: all.length + doneKeys.length, laterPreviewHeadline };
}

/** 面板标题：没有待确认项时返回空串，由调用方决定显示哪种空状态。 */
export function boundarySummary(attention: ChecklistBoundaryAttention): string {
    if (!attention.items.length) return "";
    return `现在要确认的 ${attention.items.length} 件事`;
}

/** 把分钟数写成「已过 32 分钟」「28 分钟后」这类相对时间。 */
export function boundaryRelativeLabel(minutesFromNow: number): string {
    if (minutesFromNow === 0) return "就是现在";
    if (minutesFromNow > 0) return Number.isInteger(minutesFromNow / 60) && minutesFromNow >= 60
        ? `已过 ${minutesFromNow / 60} 小时`
        : `已过 ${minutesFromNow} 分钟`;
    const ahead = -minutesFromNow;
    return Number.isInteger(ahead / 60) && ahead >= 60 ? `${ahead / 60} 小时后` : `${ahead} 分钟后`;
}

/** 一个条目在当前模式下实际显示的提醒（通用 + 选中的训练／休息分支）。 */
function reminderGroups(item: ChecklistEntry, mode: ChecklistTrainingMode): Array<{ mode: "common" | "training" | "rest"; reminders: ChecklistReminder[] }> {
    const groups: Array<{ mode: "common" | "training" | "rest"; reminders: ChecklistReminder[] }> = [{ mode: "common", reminders: item.reminders }];
    if (!item.trainingChoices || !mode) return groups;
    groups.push({ mode, reminders: item.trainingChoices[mode] });
    return groups;
}

