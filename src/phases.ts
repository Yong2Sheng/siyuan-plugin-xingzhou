/**
 * 阶段（紧急期 / 归航期）领域模块。
 *
 * 为什么单独一个模块：紧急期与归航期不是「某一天的属性」，而是「一段时间」。
 * 把它们塞进每日记录会让解析、迁移和统计三处都变复杂；独立文件也让这两段有完整的
 * 开始 / 结束 / 归档生命周期，并且不必触碰 checklist 的既有迁移逻辑。
 *
 * 两条设计约束（来自实际使用场景，不要在实现里"优化"掉）：
 * 1. 紧急期的目标是 hard deadline：**目标不改、不缩**，唯一能改的是结束日，且由你手动选。
 * 2. 每天只走一级。三个动作（做完 / 明天再说 / 这一级不需要）**都从明天起生效**，
 *    因此同一天重复点击不会跳级，也不会退回。
 */
import { shiftDateKey } from "./daily-records";

export const PHASE_STORE_FILE = "phases.json";
export const PHASE_STORE_VERSION = 1;
export const MAX_SPRINT_DAYS = 3650;

export type PhaseAnchorId = "lightsOff" | "wakeTime" | "meals" | "progress";

export type PhaseAnchor = {
    id: PhaseAnchorId;
    /** 文案快照：锚点名称可能随版本调整，历史阶段保留当时叫法。 */
    label: string;
};

/** 一天的锚点数据快照：确认过就一定有条目，锚点可以为空。 */
export type SprintDayEntry = {
    date: string;
    /** 白天点过「今天仍在紧急期」的时刻。 */
    confirmedAt: number;
};

export type SprintPhase = {
    id: string;
    /** 这次在赶什么（只给自己看，可以留空）。 */
    title: string;
    kind: "sprint";
    /** 声明的开始日。 */
    startDate: string;
    /** 当前结束日；延长只改这里。 */
    endDate: string;
    /** 第一次声明时的结束日，用来事后区分「原定」与「实际」。 */
    originalEndDate: string;
    /** 延长次数：延长就是延长，不做任何评价，只照实记。 */
    extensionCount: number;
    anchors: PhaseAnchor[];
    days: SprintDayEntry[];
    createdAt: number;
    updatedAt: number;
    endedAt: number | null;
    /** 结束方式：到点结束 / 手动结束。 */
    endedBy: "manual" | "deadline" | null;
};

export type LandingRungStatus = "done" | "skipped" | "deferred";

/** 每次动作都留一条记录；rungIndex 是 0 起的阶梯序号。 */
export type LandingLogEntry = {
    rungIndex: number;
    status: LandingRungStatus;
    date: string;
    at: number;
};

export type LandingPhase = {
    id: string;
    kind: "landing";
    /** 来源紧急期的 id，便于事后把两段连起来读。 */
    sprintId: string | null;
    sprintTitle: string;
    startDate: string;
    /** 已经完成或跳过的级数（0–7）。 */
    cursor: number;
    logs: LandingLogEntry[];
    createdAt: number;
    updatedAt: number;
    endedAt: number | null;
    endedBy: "completed" | "manual" | null;
};

export type PhaseStore = {
    version: 1;
    revision: number;
    createdAt: number;
    updatedAt: number;
    sprints: SprintPhase[];
    landings: LandingPhase[];
};

/**
 * 归航的固定七级。顺序是唯一的一条，不由用户挑选，也不因跳过而改变顺序。
 * `text` 是完整描述，`short` 用于窄屏与紧凑横幅。
 */
export const LANDING_RUNGS: readonly { id: string; text: string; short: string }[] = [
    { id: "delivery", text: "写下止损点：这次交付完成了吗？后面还等着什么（数据、脚本、笔记、筛选过程、复现步骤）", short: "这次交付完成了吗？后面还等着什么" },
    { id: "wake", text: "起床时间回来（只要求记录，不要求守住）", short: "起床时间回来" },
    { id: "lights-off", text: "熄灯时间回来（恢复计划与实际，但不进达成率）", short: "熄灯时间回来" },
    { id: "work-boundary", text: "一个工作边界回来（下班时间）", short: "一个工作边界回来" },
    { id: "personal-time", text: "一个个人时段回来（选一个项目或休息）", short: "一个个人时段回来" },
    { id: "work-space", text: "工作环境收尾（桌面、下载、临时文件、没关的标签页）", short: "工作环境收尾" },
    { id: "return", text: "归还与翻篇（紧急期前没做完的事，逐条判掉）", short: "归还与翻篇" },
] as const;

export const DEFAULT_SPRINT_ANCHORS: readonly PhaseAnchor[] = [
    { id: "lightsOff", label: "今晚熄灯" },
    { id: "wakeTime", label: "今早起床" },
    { id: "meals", label: "今天吃上饭" },
    { id: "progress", label: "今天推进了什么" },
] as const;

/** 「此刻熄灯」的归日语义：当场记录，因此归日就是记录日当晚。 */
export const SPRINT_LIGHTS_OFF_SOURCE = "live";

export function createEmptyPhaseStore(now = Date.now()): PhaseStore {
    return { version: PHASE_STORE_VERSION, revision: 1, createdAt: now, updatedAt: now, sprints: [], landings: [] };
}

export function parsePhaseStore(value: unknown): PhaseStore | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<PhaseStore>;
    if (source.version !== PHASE_STORE_VERSION || !Array.isArray(source.sprints) || !Array.isArray(source.landings)) return null;
    const sprintIds = new Set<string>();
    const sprints: SprintPhase[] = [];
    for (const raw of source.sprints) {
        const phase = normalizeSprint(raw);
        if (!phase || sprintIds.has(phase.id)) return null;
        sprintIds.add(phase.id);
        sprints.push(phase);
    }
    const landingIds = new Set<string>();
    const landings: LandingPhase[] = [];
    for (const raw of source.landings) {
        const phase = normalizeLanding(raw);
        if (!phase || landingIds.has(phase.id)) return null;
        landingIds.add(phase.id);
        landings.push(phase);
    }
    const createdAt = finiteNumber(source.createdAt) ?? Date.now();
    return {
        version: PHASE_STORE_VERSION,
        revision: Math.max(0, Math.trunc(finiteNumber(source.revision) ?? 0)),
        createdAt,
        updatedAt: finiteNumber(source.updatedAt) ?? createdAt,
        sprints: sprints.sort((a, b) => a.startDate.localeCompare(b.startDate)),
        landings: landings.sort((a, b) => a.startDate.localeCompare(b.startDate)),
    };
}

/**
 * 以 `base`（磁盘上的当前值）为底合并 `incoming`（界面提交的版本）：
 * 同 id 以 incoming 为准，incoming 里没有的阶段保留 base 的。
 *
 * 为什么需要它：阶段数据是"一段时间"，不是某一天的字段。陈旧快照整份覆盖会**删掉**用户刚声明的紧急期，
 * 而界面上没有任何删除阶段的入口，所以合并不会妨碍任何正常操作。
 */
export function mergePhaseStores(base: PhaseStore, incoming: PhaseStore): PhaseStore {
    const mergeById = <T extends { id: string; updatedAt: number }>(left: T[], right: T[]): T[] => {
        const byId = new Map(left.map((entry) => [entry.id, entry]));
        for (const entry of right) byId.set(entry.id, entry);
        return [...byId.values()].sort((a, b) => a.updatedAt - b.updatedAt);
    };
    return {
        version: PHASE_STORE_VERSION,
        revision: Math.max(base.revision, incoming.revision),
        createdAt: Math.min(base.createdAt, incoming.createdAt),
        updatedAt: Math.max(base.updatedAt, incoming.updatedAt),
        sprints: mergeById(base.sprints, incoming.sprints).sort((a, b) => a.startDate.localeCompare(b.startDate)),
        landings: mergeById(base.landings, incoming.landings).sort((a, b) => a.startDate.localeCompare(b.startDate)),
    };
}

export function clonePhaseStore(store: PhaseStore): PhaseStore {
    return {
        ...store,
        sprints: store.sprints.map(cloneSprint),
        landings: store.landings.map(cloneLanding),
    };
}

export function phaseStoresMatch(expected: PhaseStore, actual: PhaseStore): boolean {
    return JSON.stringify(expected) === JSON.stringify(actual);
}

export function phaseBackupFileForRevision(revision: number): string {
    return `phases.backup-${Math.abs(revision - 1) % 3 + 1}.json`;
}

/* ── 查询 ─────────────────────────────────────────────────────── */

/** 今天是否落在某个紧急期内（含被手动结束前的那一天）。 */
/**
 * 今天是否处在一个**仍然开启**的紧急期里。
 *
 * 只认 `endedAt === null`：紧急期一旦结束（不论手动结束还是到点结束），
 * 横幅、锚点、延长与结束入口就该全部消失。
 * 之前这里有个"退回到任意覆盖今天的区间"的兜底，导致**已经结束的紧急期仍在顶部显示**
 * 「第 N 天 / 延长到… / 结束紧急期」——用户实际看到后指出"这不对"。
 * 需要"某个日期属于哪次紧急期"（例如历史列表、补记）时，用 sprintForDate，不要用这个函数。
 */
export function activeSprint(store: PhaseStore, date: string): SprintPhase | null {
    return store.sprints.find((phase) => phase.endedAt === null && isDateWithin(date, phase.startDate, phase.endDate)) ?? null;
}

export function isSprintDay(store: PhaseStore, date: string): boolean {
    return store.sprints.some((phase) => isDateWithin(date, phase.startDate, phase.endDate));
}

export function activeLanding(store: PhaseStore): LandingPhase | null {
    const open = store.landings.filter((phase) => phase.endedAt === null);
    return open.length ? open[open.length - 1] : null;
}

export function sprintDayCount(phase: SprintPhase): number {
    return Math.max(1, dateDiffInDays(phase.startDate, phase.endDate) + 1);
}

/** 第几天（从 1 开始）；不在区间内时返回 0。 */
export function sprintDayIndex(phase: SprintPhase, date: string): number {
    if (!isDateWithin(date, phase.startDate, phase.endDate)) return 0;
    return dateDiffInDays(phase.startDate, date) + 1;
}

/** 原定多少天：用来事后区分「原定 10 天、实际 17 天」。 */
export function sprintPlannedDays(phase: SprintPhase): number {
    return Math.max(1, dateDiffInDays(phase.startDate, phase.originalEndDate) + 1);
}

export function sprintDayEntry(phase: SprintPhase, date: string): SprintDayEntry | null {
    return phase.days.find((entry) => entry.date === date) ?? null;
}

export function isSprintConfirmed(phase: SprintPhase, date: string): boolean {
    return sprintDayEntry(phase, date) !== null;
}

/** 归航当前应该做哪一级；越界返回 null（表示 7 级都过了）。 */
export function currentRung(phase: LandingPhase): { index: number; rung: (typeof LANDING_RUNGS)[number] } | null {
    const index = Math.min(Math.max(0, phase.cursor), LANDING_RUNGS.length);
    return index >= LANDING_RUNGS.length ? null : { index, rung: LANDING_RUNGS[index] };
}

/**
 * 今天做过的动作；没做过返回 null。
 *
 * 口径是「今天是否已经动作过」，不是「今天在当前这一级上动作过」：
 * 「做完」与「这一级不需要」都会把光标推到下一级，如果按当前级判断，
 * 同一天再点一次就会再跳一级——那正好破坏了「每天只走一级」。
 */
export function rungLogOnDate(phase: LandingPhase, date: string): LandingLogEntry | null {
    return [...phase.logs].reverse().find((entry) => entry.date === date) ?? null;
}

/** 今天是否已经动作过（做完 / 今天不方便 / 这一级不需要）。 */
export function isRungActedToday(phase: LandingPhase, date: string): boolean {
    return rungLogOnDate(phase, date) !== null;
}

/**
 * 停在同一级超过 `stuckDays` 天时，问一次「继续归航 / 结束归航」。
 * 只在「有光标、且最近一次动作不是在这一级上做的动作」时触发；不推进、不改变任何状态。
 */
export function isLandingStuck(phase: LandingPhase, date: string, stuckDays = 4): boolean {
    if (!currentRung(phase)) return false;
    const last = phase.logs.length ? phase.logs[phase.logs.length - 1] : null;
    const reference = last ? last.date : phase.startDate;
    return dateDiffInDays(reference, date) >= stuckDays;
}

/* ── 命令 ─────────────────────────────────────────────────────── */

/** 进入紧急期。日期必须合法且结束日不早于开始日。 */
export function startSprint(store: PhaseStore, input: {
    title?: string;
    startDate: string;
    endDate: string;
    anchors?: readonly PhaseAnchor[];
    id?: string;
}, now = Date.now()): PhaseStore {
    const next = clonePhaseStore(store);
    if (!isDateKey(input.startDate) || !isDateKey(input.endDate)) throw new Error("紧急期的开始日或结束日格式无效。");
    const spanDays = dateDiffInDays(input.startDate, input.endDate) + 1;
    // 顺序很关键：先判格式、再判区间长度、最后判先后。
    // 反过来写的话，「结束日远早于开始日」会先命中"区间过长"（天数为负但绝对长度很大），给出看不出问题的提示。
    if (spanDays > MAX_SPRINT_DAYS) throw new Error("紧急期区间过长，请分段时间声明。");
    if (input.endDate < input.startDate) throw new Error("紧急期的结束日不能早于开始日。");
    const id = input.id ?? `sprint-${now.toString(36)}-${next.sprints.length + 1}`;
    if (next.sprints.some((phase) => phase.id === id)) throw new Error("阶段 ID 重复，请重试。");
    const phase: SprintPhase = {
        id,
        kind: "sprint",
        title: textValue(input.title).trim(),
        startDate: input.startDate,
        endDate: input.endDate,
        originalEndDate: input.endDate,
        extensionCount: 0,
        anchors: normalizeAnchors(input.anchors ?? DEFAULT_SPRINT_ANCHORS),
        days: [],
        createdAt: now,
        updatedAt: now,
        endedAt: null,
        endedBy: null,
    };
    next.sprints = [...next.sprints, phase].sort((a, b) => a.startDate.localeCompare(b.startDate));
    return touch(next, now);
}

/**
 * 延长紧急期：只改结束日，目标不动。
 * 结束日必须晚于当前结束日；早于或等于时按「没有变化」处理，避免误操作把区间缩短。
 */
export function extendSprint(store: PhaseStore, sprintId: string, newEndDate: string, now = Date.now()): PhaseStore {
    const next = clonePhaseStore(store);
    const phase = next.sprints.find((candidate) => candidate.id === sprintId);
    if (!phase) throw new Error("没有找到要延长的紧急期。");
    if (phase.endedAt !== null) throw new Error("这个紧急期已经结束了。");
    if (!isDateKey(newEndDate)) throw new Error("请选择有效的结束日期。");
    if (newEndDate <= phase.endDate) throw new Error("新的结束日必须晚于当前结束日。");
    if (dateDiffInDays(phase.startDate, newEndDate) + 1 > MAX_SPRINT_DAYS) throw new Error("紧急期区间过长，请分段时间声明。");
    phase.endDate = newEndDate;
    phase.extensionCount += 1;
    phase.updatedAt = now;
    return touch(next, now);
}

/** 结束紧急期；`startLanding` 为真时同时开启归航。 */
export function endSprint(store: PhaseStore, sprintId: string, options: { startLanding?: boolean; endedBy?: "manual" | "deadline"; landingStartDate?: string } = {}, now = Date.now()): PhaseStore {
    const next = clonePhaseStore(store);
    const phase = next.sprints.find((candidate) => candidate.id === sprintId);
    if (!phase) throw new Error("没有找到要结束的紧急期。");
    if (phase.endedAt === null) {
        phase.endedAt = now;
        phase.endedBy = options.endedBy ?? "manual";
        phase.updatedAt = now;
    }
    const startDate = options.landingStartDate ?? shiftDateKey(phase.endDate, 1);
    const hasLanding = next.landings.some((landing) => landing.sprintId === phase.id && landing.endedAt === null);
    if (options.startLanding !== false && !hasLanding && next.landings.every((landing) => landing.endedAt !== null)) {
        next.landings = [...next.landings, createLandingPhase(phase, startDate, now)];
    }
    return touch(next, now);
}

/** 紧急期每天的「今天仍在紧急期」。同一天重复确认不重复写入，返回原状态。 */
export function confirmSprintDay(store: PhaseStore, sprintId: string, date: string, now = Date.now()): PhaseStore {
    const next = clonePhaseStore(store);
    const phase = next.sprints.find((candidate) => candidate.id === sprintId);
    if (!phase) throw new Error("没有找到这个紧急期。");
    if (!isDateWithin(date, phase.startDate, phase.endDate)) throw new Error("这一天不在紧急期区间内。");
    if (sprintDayEntry(phase, date)) return store;
    phase.days = [...phase.days, { date, confirmedAt: now }].sort((a, b) => a.date.localeCompare(b.date));
    phase.updatedAt = now;
    return touch(next, now);
}

/** 撤回当天的确认：紧急期内不允许出现"点错了却改不回来"的单向动作。 */
export function unconfirmSprintDay(store: PhaseStore, sprintId: string, date: string, now = Date.now()): PhaseStore {
    const next = clonePhaseStore(store);
    const phase = next.sprints.find((candidate) => candidate.id === sprintId);
    if (!phase) throw new Error("没有找到这个紧急期。");
    if (!sprintDayEntry(phase, date)) return store;
    phase.days = phase.days.filter((entry) => entry.date !== date);
    phase.updatedAt = now;
    return touch(next, now);
}

export function createLandingPhase(sprint: SprintPhase | null, startDate: string, now = Date.now()): LandingPhase {
    return {
        id: `landing-${now.toString(36)}`,
        kind: "landing",
        sprintId: sprint?.id ?? null,
        sprintTitle: sprint?.title ?? "",
        startDate,
        cursor: 0,
        logs: [],
        createdAt: now,
        updatedAt: now,
        endedAt: null,
        endedBy: null,
    };
}

/**
 * 归航的三个动作，一律**从明天起生效**：
 * - done：做完 → 明天进下一级
 * - deferred：今天不方便 → 明天还是这一级（不推进、不作废）
 * - skipped：这一级不需要 → 明天进下一级
 * 同一天在同一级上重复点击不再产生新记录，因此不会跳级、也不会退回。
 */
export function advanceLanding(store: PhaseStore, landingId: string, status: LandingRungStatus, date: string, now = Date.now()): PhaseStore {
    const next = clonePhaseStore(store);
    const phase = next.landings.find((candidate) => candidate.id === landingId);
    if (!phase) throw new Error("没有找到这个归航。");
    if (phase.endedAt !== null) throw new Error("这个归航已经结束了。");
    const target = currentRung(phase);
    if (!target) throw new Error("七级已经走完，不需要再推进。");
    if (!isDateKey(date)) throw new Error("日期无效。");
    if (rungLogOnDate(phase, date)) return store;
    phase.logs = [...phase.logs, { rungIndex: target.index, status, date, at: now }];
    if (status !== "deferred") phase.cursor = target.index + 1;
    if (phase.cursor >= LANDING_RUNGS.length) {
        phase.endedAt = now;
        phase.endedBy = "completed";
    }
    phase.updatedAt = now;
    return touch(next, now);
}

export function endLanding(store: PhaseStore, landingId: string, now = Date.now()): PhaseStore {
    const next = clonePhaseStore(store);
    const phase = next.landings.find((candidate) => candidate.id === landingId);
    if (!phase) throw new Error("没有找到这个归航。");
    if (phase.endedAt === null) {
        phase.endedAt = now;
        phase.endedBy = "manual";
        phase.updatedAt = now;
    }
    return touch(next, now);
}

/**
 * 归航结束时的事实卡数字：只陈述，不打分、不排名、不和上个周期比较。
 * 归航天数按日志与开始日推导；紧急期的「原定 / 实际」从来源紧急期取。
 */
export function landedSummary(landing: LandingPhase, store: PhaseStore): {
    days: number;
    done: number;
    skipped: number;
    plannedDays: number;
    actualDays: number;
} {
    const last = landing.logs.length ? landing.logs[landing.logs.length - 1] : null;
    const endDate = landing.endedAt ? null : last?.date ?? landing.startDate;
    const days = Math.max(1, (endDate ? dateDiffInDays(landing.startDate, endDate) : 0) + 1);
    const sprint = landing.sprintId ? store.sprints.find((phase) => phase.id === landing.sprintId) ?? null : null;
    return {
        days,
        done: landing.logs.filter((entry) => entry.status === "done").length,
        skipped: landing.logs.filter((entry) => entry.status === "skipped").length,
        plannedDays: sprint ? sprintPlannedDays(sprint) : days,
        actualDays: sprint ? sprintDayCount(sprint) : days,
    };
}

/** 允许在紧急期内仍走一次「补那天的记录」：只校验日期是否落在某个紧急期内。 */
export function sprintForDate(store: PhaseStore, date: string): SprintPhase | null {
    return store.sprints.find((phase) => isDateWithin(date, phase.startDate, phase.endDate)) ?? null;
}

/* ── 内部工具 ─────────────────────────────────────────────────── */

function touch(store: PhaseStore, now: number): PhaseStore {
    return { ...store, revision: store.revision + 1, updatedAt: now };
}

function cloneSprint(phase: SprintPhase): SprintPhase {
    return {
        ...phase,
        anchors: phase.anchors.map((anchor) => ({ ...anchor })),
        days: phase.days.map((entry) => ({ ...entry })),
    };
}

function cloneLanding(phase: LandingPhase): LandingPhase {
    return { ...phase, logs: phase.logs.map((entry) => ({ ...entry })) };
}

function normalizeSprint(value: unknown): SprintPhase | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<SprintPhase>;
    if (typeof source.id !== "string" || !source.id) return null;
    if (!isDateKey(source.startDate) || !isDateKey(source.endDate)) return null;
    if (source.endDate < source.startDate) return null;
    const createdAt = finiteNumber(source.createdAt) ?? Date.now();
    const originalEndDate = isDateKey(source.originalEndDate) && source.originalEndDate >= source.startDate ? source.originalEndDate : source.endDate;
    const days: SprintDayEntry[] = [];
    const seen = new Set<string>();
    for (const raw of Array.isArray(source.days) ? source.days : []) {
        const entry = raw as Partial<SprintDayEntry>;
        if (!isDateKey(entry.date) || seen.has(entry.date)) continue;
        if (!isDateWithin(entry.date, source.startDate, source.endDate)) continue;
        seen.add(entry.date);
        days.push({ date: entry.date, confirmedAt: finiteNumber(entry.confirmedAt) ?? createdAt });
    }
    return {
        id: source.id,
        kind: "sprint",
        title: textValue(source.title).trim(),
        startDate: source.startDate,
        endDate: source.endDate,
        originalEndDate,
        extensionCount: Math.max(0, Math.trunc(finiteNumber(source.extensionCount) ?? 0)),
        anchors: normalizeAnchors(source.anchors),
        days: days.sort((a, b) => a.date.localeCompare(b.date)),
        createdAt,
        updatedAt: finiteNumber(source.updatedAt) ?? createdAt,
        endedAt: finiteNumber(source.endedAt),
        endedBy: source.endedBy === "manual" || source.endedBy === "deadline" ? source.endedBy : null,
    };
}

function normalizeLanding(value: unknown): LandingPhase | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<LandingPhase>;
    if (typeof source.id !== "string" || !source.id) return null;
    if (!isDateKey(source.startDate)) return null;
    const createdAt = finiteNumber(source.createdAt) ?? Date.now();
    const logs: LandingLogEntry[] = [];
    for (const raw of Array.isArray(source.logs) ? source.logs : []) {
        const entry = raw as Partial<LandingLogEntry>;
        if (!isDateKey(entry.date)) continue;
        if (entry.status !== "done" && entry.status !== "skipped" && entry.status !== "deferred") continue;
        const rungIndex = Math.trunc(finiteNumber(entry.rungIndex) ?? -1);
        if (rungIndex < 0 || rungIndex >= LANDING_RUNGS.length) continue;
        logs.push({ rungIndex, status: entry.status, date: entry.date, at: finiteNumber(entry.at) ?? createdAt });
    }
    const declaredCursor = Math.trunc(finiteNumber(source.cursor) ?? 0);
    return {
        id: source.id,
        kind: "landing",
        sprintId: typeof source.sprintId === "string" && source.sprintId ? source.sprintId : null,
        sprintTitle: textValue(source.sprintTitle).trim(),
        startDate: source.startDate,
        cursor: Math.min(Math.max(0, declaredCursor), LANDING_RUNGS.length),
        logs: logs.sort((a, b) => a.at - b.at),
        createdAt,
        updatedAt: finiteNumber(source.updatedAt) ?? createdAt,
        endedAt: finiteNumber(source.endedAt),
        endedBy: source.endedBy === "completed" || source.endedBy === "manual" ? source.endedBy : null,
    };
}

/**
 * 锚点规范化：熄灯不可去掉；未知 id 丢弃；顺序按默认顺序固定，避免同一套锚点在不同日子顺序不同。
 */
function normalizeAnchors(value: unknown): PhaseAnchor[] {
    const provided = Array.isArray(value) ? value : [];
    const byId = new Map<PhaseAnchorId, PhaseAnchor>();
    for (const raw of provided) {
        const anchor = raw as Partial<PhaseAnchor>;
        const id = anchor?.id;
        if (id !== "lightsOff" && id !== "wakeTime" && id !== "meals" && id !== "progress") continue;
        byId.set(id, { id, label: textValue(anchor.label).trim() || defaultAnchorLabel(id) });
    }
    if (!byId.has("lightsOff")) byId.set("lightsOff", { id: "lightsOff", label: defaultAnchorLabel("lightsOff") });
    return DEFAULT_SPRINT_ANCHORS
        .filter((anchor) => byId.has(anchor.id))
        .map((anchor) => byId.get(anchor.id) as PhaseAnchor);
}

function defaultAnchorLabel(id: PhaseAnchorId): string {
    return DEFAULT_SPRINT_ANCHORS.find((anchor) => anchor.id === id)?.label ?? id;
}

function isDateKey(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

export function isDateWithin(date: string, start: string, end: string): boolean {
    return isDateKey(date) && date >= start && date <= end;
}

/** 两个日期键之间相差的天数；用中午 12 点解析，避开时区与夏令时。 */
export function dateDiffInDays(from: string, to: string): number {
    const start = new Date(`${from}T12:00:00`).getTime();
    const end = new Date(`${to}T12:00:00`).getTime();
    return Math.round((end - start) / 86_400_000);
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/**
 * 归航期每天解锁哪些记录字段。
 *
 * 为什么需要它：紧急期结束时如果一次性把整张表拍回来，等于把"回到日常"的压力也一次性拍回来——
 * 而用户的原话是"打乱之后我会更倾向于乱掉的节律，得花时间让自己回到原来的日常"。
 * 因此归航按阶梯逐级放开：第 1 级只放"交付结果 + 后面等着什么"，之后每天加回一组，
 * 第 7 级（归还与翻篇）走完才恢复完整表单。
 */
export type LandingFieldGroup = "delivery" | "wake" | "sleep" | "workBoundary" | "afterWork";

const LANDING_GROUPS_BY_RUNG: readonly LandingFieldGroup[][] = [
    ["delivery"],                       // 第 1 级：写下止损点
    ["delivery", "wake"],               // 第 2 级：起床时间回来
    ["delivery", "wake", "sleep"],      // 第 3 级：熄灯时间回来
    ["delivery", "wake", "sleep", "workBoundary"],  // 第 4 级：一个工作边界回来
    ["delivery", "wake", "sleep", "workBoundary"],  // 第 5 级：一个个人时段回来（用的是下班后那一组）
    ["delivery", "wake", "sleep", "workBoundary"],  // 第 6 级：工作环境收尾（纯动作，不加字段）
    ["delivery", "wake", "sleep", "workBoundary", "afterWork"], // 第 7 级：归还与翻篇 → 恢复完整表单
];

/** 第 7 级及之后不再限制字段（等价于完整表单）。 */
export function landingUnlocksFullForm(rungIndex: number): boolean {
    return rungIndex >= LANDING_GROUPS_BY_RUNG.length - 1;
}

export function landingFieldGroups(rungIndex: number): LandingFieldGroup[] {
    const index = Math.min(Math.max(0, Math.trunc(rungIndex)), LANDING_GROUPS_BY_RUNG.length - 1);
    return [...LANDING_GROUPS_BY_RUNG[index]];
}

export function landingOffersGroup(rungIndex: number, group: LandingFieldGroup): boolean {
    return landingFieldGroups(rungIndex).includes(group);
}

/**
 * 某一天界面上该显示"第几级"（0 起）。
 *
 * 关键区别（真实 bug）：`currentRung` 读的是**光标**，而光标会在动作发生时立刻前进。
 * 于是"今天点了做完了"会让**同一天**的界面从第 1 级跳成第 2 级——
 * 但规则明明是"今天记的是第 1 级，明天才进第 2 级"。
 * 因此当天显示必须优先取**这一天已经记录的那一级**，没有记录时才回落到光标。
 */
export function rungNumberForDate(phase: LandingPhase, date: string): number | null {
    const logged = rungLogOnDate(phase, date);
    if (logged) return logged.rungIndex;
    const target = currentRung(phase);
    return target ? target.index : null;
}

/** 某一天界面上该显示的那一级内容（配合 rungNumberForDate 使用）。 */
export function rungForDate(phase: LandingPhase, date: string): { index: number; rung: (typeof LANDING_RUNGS)[number] } | null {
    const index = rungNumberForDate(phase, date);
    if (index === null || index >= LANDING_RUNGS.length) return null;
    return { index, rung: LANDING_RUNGS[index] };
}
