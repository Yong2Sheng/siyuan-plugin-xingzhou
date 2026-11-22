/**
 * 「本次行动细则」的结构化内容 + 断点时间轴。
 *
 * 为什么是时间轴而不是几个字段：细则里混着三种性质完全不同的东西——
 * ① 复访时要立刻看到的状态（做到哪、卡在哪）；② 长期背景与提示词；③ 已经产出的成果条目。
 * 混在一起时，间隔一周回来必须重读全文才能接上，机器也无法区分「这次要做什么」和「上次做到哪」。
 *
 * 更关键的是：**「当前状态」和「下一步」每次停手都会被覆盖，覆盖就丢历史**。
 * 所以这两样不再是可写字段，而是从最新一条断点派生的视图：
 *   - 当前状态 = 最新断点的 did（+ 自动行里的系统事实）
 *   - 下一步   = 最新断点的 next（留空即「待定」）
 *   - 阶段性成果 = 打了星标的断点
 * 一条断点同时带入口（从哪继续）和交接内容（下次开工要带走的东西）。
 *
 * 兼容：
 * - 旧的单块文本（WorkItem.currentAction）在升级时映射到「行动指导与想法」，并在当前状态里留迁移标记；
 * - 旧的 currentState / outcomes 在首次读取时迁移成断点（幂等，靠 checkpointMigrationAt 防复活），
 *   旧字段本身不删除，避免任何情况下丢内容；
 * - 旧字段仍在 normalize 里解析，只是不再参与展示。
 */

export type ActionEntryPoint = {
    /** 入口类型：vscode / chatgpt / jupyter / terminal / siyuan / browser / file / folder / other … */
    type: string;
    /** 显示名称，可改 */
    label: string;
    /** 位置：路径、网址、思源块 id；是入口的身份，不可编辑 */
    target: string;
};

export type ActionCheckpoint = {
    id: string;
    createdAt: number;
    /** 做到哪（必填；迁移过来的 entry 也一定有） */
    did: string;
    /** 卡在哪（可选） */
    stuck: string;
    /** 下一步（可选，空 = 待定） */
    next: string;
    /** 从哪继续（可选） */
    entry: ActionEntryPoint | null;
    /** 交接内容：下次开工要带走的东西（可以是给 AI 的提示词，也可以是自己的操作步骤） */
    payload: string;
    /** 阶段性成果星标 */
    starred: boolean;
};

export type ActionOutcome = {
    id: string;
    text: string;
    createdAt: number;
    /** 可选：这条成果由哪条待办带来。 */
    fromTodoId: string | null;
    /** 可选：成果对应的日期（YYYY-MM-DD），默认取创建当天。 */
    date: string | null;
};

export type ActionDetail = {
    /** 旧字段：首次读取时迁移成断点，之后只作为兼容数据保留。 */
    currentState: string;
    background: string;
    prompt: string;
    /** 旧字段：首次读取时迁移成带星标的断点。 */
    outcomes: ActionOutcome[];
    /** 行动指导与想法；旧版细则文本迁移到这里。 */
    guidance: string;
    /** 事务级的完成定义。 */
    definition: string;
    /** 断点时间轴：只追加，最新一条在最前由展示层排序决定。 */
    checkpoints: ActionCheckpoint[];
    updatedAt: number | null;
    /** 旧版细则已迁移的标记；null 表示没有迁移过。 */
    migratedFromCurrentActionAt: number | null;
    /** currentState / outcomes 已迁移成断点的时间；null 表示没有迁移过。 */
    checkpointMigrationAt: number | null;
};

/**
 * 可编辑、可展示的字段。`currentState` 不在其中——它已经变成「最新一条断点」的派生视图，
 * 不再是可以单独填写的字段（类型里仍保留它，供旧数据与兼容文本使用）。
 */
export type ActionDetailField = "currentState" | "background" | "prompt" | "guidance" | "definition";

const MAX_LONG_FIELD = 50000;
const MAX_STATE_FIELD = 20000;
const MAX_OUTCOMES = 200;
const MAX_OUTCOME_TEXT = 2000;

const MAX_CHECKPOINTS = 500;
const MAX_CHECKPOINT_TEXT = 20000;
const MAX_CHECKPOINT_LINE = 4000;
const MAX_ENTRY_TYPE = 32;
const MAX_ENTRY_LABEL = 200;
const MAX_ENTRY_TARGET = 2000;

export const ACTION_DETAIL_FIELDS: Array<{ key: ActionDetailField; label: string; hint: string; required?: boolean }> = [
    { key: "background", label: "背景与约束", hint: "为什么有这件事、有哪些限制" },
    { key: "prompt", label: "Prompt", hint: "发给 AI 的初始提示词（任务书，不是每次开工都要改的东西）" },
    { key: "guidance", label: "行动指导与想法", hint: "打算怎么做、有什么想法" },
    { key: "definition", label: "完成定义", hint: "怎么算做完" },
];

export function createEmptyActionDetail(): ActionDetail {
    return {
        currentState: "",
        background: "",
        prompt: "",
        outcomes: [],
        guidance: "",
        definition: "",
        checkpoints: [],
        updatedAt: null,
        migratedFromCurrentActionAt: null,
        checkpointMigrationAt: null,
    };
}

export function normalizeActionDetail(value: unknown): ActionDetail {
    if (!value || typeof value !== "object") return createEmptyActionDetail();
    const source = value as Partial<ActionDetail>;
    const base: ActionDetail = {
        currentState: longText(source.currentState, MAX_STATE_FIELD),
        background: longText(source.background, MAX_LONG_FIELD),
        prompt: longText(source.prompt, MAX_LONG_FIELD),
        outcomes: normalizeOutcomes(source.outcomes),
        guidance: longText(source.guidance, MAX_LONG_FIELD),
        definition: longText(source.definition, MAX_STATE_FIELD),
        checkpoints: normalizeCheckpoints(source.checkpoints),
        updatedAt: finiteNumber(source.updatedAt),
        migratedFromCurrentActionAt: finiteNumber(source.migratedFromCurrentActionAt),
        checkpointMigrationAt: finiteNumber(source.checkpointMigrationAt),
    };
    /* 每一次读取都会经过这里：旧数据在内存里就地升级成断点，写入时落盘（幂等，不复活已删的断点） */
    return migrateToCheckpoints(base).detail;
}

export function normalizeCheckpoints(value: unknown): ActionCheckpoint[] {
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    const result: ActionCheckpoint[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const candidate = raw as Partial<ActionCheckpoint>;
        const did = multiline(candidate.did, MAX_CHECKPOINT_TEXT).trim();
        const stuck = multiline(candidate.stuck, MAX_CHECKPOINT_LINE).trim();
        const next = multiline(candidate.next, MAX_CHECKPOINT_LINE).trim();
        const payload = multiline(candidate.payload, MAX_CHECKPOINT_TEXT);
        const entry = normalizeEntryPoint(candidate.entry);
        /* 什么内容都没有的断点不保留：它会变成时间轴上一行空白 */
        if (!did && !stuck && !next && !payload.trim() && !entry) continue;
        /* 显式 id 重复时丢弃该条，而不是换 id 再收进来：否则同一份数据每次解析都会多出条目 */
        if (typeof candidate.id === "string" && candidate.id && ids.has(candidate.id)) continue;
        const id = typeof candidate.id === "string" && candidate.id ? candidate.id : createCheckpointId();
        ids.add(id);
        result.push({
            id,
            createdAt: finiteNumber(candidate.createdAt) ?? Date.now(),
            did,
            stuck,
            next,
            entry,
            payload,
            starred: candidate.starred === true,
        });
        if (result.length >= MAX_CHECKPOINTS) break;
    }
    return result;
}

export function normalizeEntryPoint(value: unknown): ActionEntryPoint | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<ActionEntryPoint>;
    const type = longText(source.type, MAX_ENTRY_TYPE).trim();
    const label = longText(source.label, MAX_ENTRY_LABEL).trim();
    const target = longText(source.target, MAX_ENTRY_TARGET).trim();
    /* 没名称就没法在界面上指认，视为没有入口；位置可以为空（例如「其他」） */
    if (!type || !label) return null;
    return { type, label, target };
}

/** 是否有任何结构化内容——用于判断「要不要把旧文本迁进来」和「细则算不算写过」。 */
export function hasActionDetailContent(detail: ActionDetail): boolean {
    return Boolean(detail.currentState.trim() || detail.background.trim() || detail.prompt.trim()
        || detail.guidance.trim() || detail.definition.trim() || detail.outcomes.length > 0
        || detail.checkpoints.length > 0);
}

export function setActionDetailField(detail: ActionDetail, field: ActionDetailField, value: string, now = Date.now()): ActionDetail {
    const max = field === "currentState" || field === "definition" ? MAX_STATE_FIELD : MAX_LONG_FIELD;
    return { ...detail, [field]: longText(value, max), updatedAt: now };
}

/* ── 断点 ─────────────────────────────────────────────────────────────── */

export type NewCheckpointInput = {
    did: string;
    stuck?: string;
    next?: string;
    entry?: ActionEntryPoint | null;
    payload?: string;
    starred?: boolean;
};

export function addCheckpoint(detail: ActionDetail, input: NewCheckpointInput, now = Date.now()): ActionDetail {
    const did = multiline(input.did, MAX_CHECKPOINT_TEXT).trim();
    const next = multiline(input.next ?? "", MAX_CHECKPOINT_LINE).trim();
    const stuck = multiline(input.stuck ?? "", MAX_CHECKPOINT_LINE).trim();
    const payload = multiline(input.payload ?? "", MAX_CHECKPOINT_TEXT);
    const entry = normalizeEntryPoint(input.entry);
    if (!did && !next && !stuck && !payload.trim() && !entry) throw new Error("断点内容不能为空。");
    const checkpoint: ActionCheckpoint = {
        id: createCheckpointId(),
        createdAt: now,
        did,
        stuck,
        next,
        entry,
        payload,
        starred: input.starred === true,
    };
    return { ...detail, checkpoints: normalizeCheckpoints([...detail.checkpoints, checkpoint]), updatedAt: now };
}

export type CheckpointPatch = Partial<Pick<ActionCheckpoint, "did" | "stuck" | "next" | "payload" | "entry" | "starred">>;

export function updateCheckpoint(detail: ActionDetail, id: string, patch: CheckpointPatch, now = Date.now()): ActionDetail {
    if (!detail.checkpoints.some((item) => item.id === id)) throw new Error("没有找到要修改的断点。");
    return {
        ...detail,
        checkpoints: normalizeCheckpoints(detail.checkpoints.map((item) => (item.id === id
            ? {
                ...item,
                ...(patch.did !== undefined ? { did: multiline(patch.did, MAX_CHECKPOINT_TEXT).trim() } : {}),
                ...(patch.stuck !== undefined ? { stuck: multiline(patch.stuck, MAX_CHECKPOINT_LINE).trim() } : {}),
                ...(patch.next !== undefined ? { next: multiline(patch.next, MAX_CHECKPOINT_LINE).trim() } : {}),
                ...(patch.payload !== undefined ? { payload: multiline(patch.payload, MAX_CHECKPOINT_TEXT) } : {}),
                ...(patch.entry !== undefined ? { entry: normalizeEntryPoint(patch.entry) } : {}),
                ...(patch.starred !== undefined ? { starred: patch.starred === true } : {}),
            }
            : item))),
        updatedAt: now,
    };
}

export function removeCheckpoint(detail: ActionDetail, id: string, now = Date.now()): ActionDetail {
    return { ...detail, checkpoints: detail.checkpoints.filter((item) => item.id !== id), updatedAt: now };
}

export function toggleCheckpointStar(detail: ActionDetail, id: string, now = Date.now()): ActionDetail {
    return {
        ...detail,
        checkpoints: detail.checkpoints.map((item) => (item.id === id ? { ...item, starred: !item.starred } : item)),
        updatedAt: now,
    };
}

/** 最新一条断点（时间倒序的第一条）。当前状态、下一步、恢复包都由它派生。 */
export function latestCheckpoint(detail: ActionDetail): ActionCheckpoint | null {
    let latest: ActionCheckpoint | null = null;
    for (const item of detail.checkpoints) {
        if (!latest || item.createdAt > latest.createdAt) latest = item;
    }
    return latest;
}

/** 展示顺序：最新的在最上面。 */
export function checkpointsForDisplay(detail: ActionDetail): ActionCheckpoint[] {
    return [...detail.checkpoints].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

/** 派生字段：下一步（没有断点或断点没写就是空 = 待定）。 */
export function derivedNextAction(detail: ActionDetail): string {
    return latestCheckpoint(detail)?.next ?? "";
}

/* ── 旧数据迁移 ───────────────────────────────────────────────────────── */

export type MigrationResult = { detail: ActionDetail; changed: boolean };

/**
 * 旧字段 → 断点：outcomes 变成带星标的断点，currentState 变成一条普通断点。
 *
 * 幂等：`checkpointMigrationAt` 一旦写下，就不会再迁第二次——用户把断点删光后，
 * 旧字段也不会被「复活」成断点。旧字段本身不删除，任何情况下都不丢内容。
 */
export function migrateToCheckpoints(detail: ActionDetail, now = Date.now()): MigrationResult {
    if (detail.checkpoints.length > 0) return { detail, changed: false };
    if (detail.checkpointMigrationAt !== null) return { detail, changed: false };
    const legacyState = detail.currentState.trim();
    if (!legacyState && detail.outcomes.length === 0) return { detail, changed: false };

    const migrated: ActionCheckpoint[] = detail.outcomes.map((outcome) => ({
        id: `cp-${outcome.id}`,
        createdAt: outcome.createdAt,
        did: outcome.text,
        stuck: "",
        next: "",
        entry: null,
        payload: "",
        starred: true,
    }));
    if (legacyState) {
        migrated.push({
            id: createCheckpointId(),
            /* 当前状态没有自己的时间戳，用细则最后更新时间；再没有就取现在 */
            createdAt: detail.updatedAt ?? now,
            did: legacyState,
            stuck: "",
            next: "",
            entry: null,
            payload: "",
            starred: false,
        });
    }
    return {
        detail: {
            ...detail,
            checkpoints: normalizeCheckpoints(migrated),
            checkpointMigrationAt: now,
            /* 不覆盖 updatedAt：迁移不是一次用户编辑 */
        },
        changed: true,
    };
}

/**
 * 旧版单块细则文本 → 结构化字段。
 *
 * 规则：老文本整体进入「行动指导与想法」（它是"我打算怎么做"的原始记录，不丢内容），
 * 当前状态里留一行迁移标记，方便复访时知道细则换地方了。
 * 已有结构化内容时**不动**（幂等），因此可以安全地在每次解析时调用。
 */
export function migrateLegacyActionText(detail: ActionDetail, legacyText: string, now = Date.now()): ActionDetail {
    const text = typeof legacyText === "string" ? legacyText.trim() : "";
    if (!text) return detail;
    if (hasActionDetailContent(detail)) return detail;
    return {
        ...detail,
        guidance: text.slice(0, MAX_LONG_FIELD),
        currentState: "（旧版细则已迁移到下方「行动指导与想法」，可在那里继续编辑。）",
        migratedFromCurrentActionAt: now,
        updatedAt: detail.updatedAt ?? now,
    };
}

/**
 * 把结构化细则压成一段兼容文本，写回旧的 `currentAction` 字段。
 *
 * 有断点时以断点为准（旧 currentState/outcomes 不再重复进入，否则同一句话会出现两遍）；
 * 「下一步行动」仍是独立字段，这里把它渲染成第一行，让兼容文本读起来仍然完整。
 * 保留了旧字段的读取方：图片清理扫描、图库体检、缺字段提示都还看得到图片与文字。
 * 空细则返回空串，调用方据此决定是否跳过写入。
 */
export function actionDetailToLegacyText(detail: ActionDetail, nextAction = ""): string {
    const blocks: string[] = [];
    const next = nextAction.trim();
    if (next) blocks.push(`下一步：${next}`);

    if (detail.checkpoints.length > 0) {
        for (const checkpoint of checkpointsForDisplay(detail)) {
            const lines: string[] = [`## 断点 ${formatStamp(checkpoint.createdAt)}${checkpoint.starred ? " · 阶段性成果" : ""}`];
            if (checkpoint.did) lines.push(checkpoint.did);
            if (checkpoint.stuck) lines.push(`卡在：${checkpoint.stuck}`);
            if (checkpoint.next) lines.push(`下一步：${checkpoint.next}`);
            if (checkpoint.entry) lines.push(`入口：${checkpoint.entry.label}${checkpoint.entry.target ? `（${checkpoint.entry.target}）` : ""}`);
            if (checkpoint.payload.trim()) lines.push(`交接内容：\n${checkpoint.payload.trim()}`);
            blocks.push(lines.join("\n"));
        }
    } else {
        if (detail.currentState.trim()) blocks.push(detail.currentState.trim());
        const outcomes = outcomesForDisplay(detail);
        if (outcomes.length > 0) {
            blocks.push(["## 阶段性成果", ...outcomes.map((outcome) => `- ${outcome.text}`)].join("\n"));
        }
    }

    if (detail.guidance.trim()) blocks.push(["## 行动指导与想法", detail.guidance.trim()].join("\n"));
    if (detail.background.trim()) blocks.push(["## 背景与约束", detail.background.trim()].join("\n"));
    if (detail.prompt.trim()) blocks.push(["## Prompt", detail.prompt.trim()].join("\n"));
    if (detail.definition.trim()) blocks.push(["## 完成定义", detail.definition.trim()].join("\n"));
    return blocks.join("\n\n");
}

/**
 * 细则是否算「写过了」——整理页的「缺少行动细则」用这个判据。
 *
 * 只要结构化细则有任何内容、或者还有可用的下一步行动，都不再提示补细则；
 * 两条都空的条目才会出现在整理清单里，并且换到新字段后依然能被找出来。
 */
export function actionDetailMissing(detail: ActionDetail, nextAction: string): boolean {
    return !hasActionDetailContent(detail) && !nextAction.trim();
}

export function createCheckpointId(now = Date.now()): string {
    return `cp-${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createOutcomeId(now = Date.now()): string {
    return `outcome-${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function localDateKey(timestamp = Date.now()): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 兼容文本里的时间戳：YYYY-MM-DD HH:mm，便于日后从旧字段里找回断点。 */
function formatStamp(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function normalizeOutcomes(value: unknown): ActionOutcome[] {
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    const result: ActionOutcome[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const candidate = raw as Partial<ActionOutcome>;
        const text = multiline(candidate.text, MAX_OUTCOME_TEXT).trim();
        if (!text) continue;
        // 显式 id 重复时丢弃该条，而不是换一个 id 再收进来：否则同一份数据每次解析都会多出条目。
        if (typeof candidate.id === "string" && candidate.id && ids.has(candidate.id)) continue;
        const id = typeof candidate.id === "string" && candidate.id ? candidate.id : createOutcomeId();
        ids.add(id);
        const createdAt = finiteNumber(candidate.createdAt) ?? Date.now();
        result.push({
            id,
            text,
            createdAt,
            fromTodoId: typeof candidate.fromTodoId === "string" && candidate.fromTodoId ? candidate.fromTodoId : null,
            date: dateKey(candidate.date) ?? localDateKey(createdAt),
        });
        if (result.length >= MAX_OUTCOMES) break;
    }
    return result;
}

export function addOutcome(detail: ActionDetail, text: string, options: { fromTodoId?: string | null; date?: string | null } = {}, now = Date.now()): ActionDetail {
    const normalized = multiline(text, MAX_OUTCOME_TEXT).trim();
    if (!normalized) throw new Error("成果内容不能为空。");
    const outcome: ActionOutcome = {
        id: createOutcomeId(),
        text: normalized,
        createdAt: now,
        fromTodoId: options.fromTodoId ?? null,
        date: dateKey(options.date) ?? localDateKey(now),
    };
    return { ...detail, outcomes: normalizeOutcomes([...detail.outcomes, outcome]), updatedAt: now };
}

export function updateOutcome(detail: ActionDetail, id: string, text: string, now = Date.now()): ActionDetail {
    if (!detail.outcomes.some((outcome) => outcome.id === id)) throw new Error("没有找到要修改的成果条目。");
    return {
        ...detail,
        outcomes: normalizeOutcomes(detail.outcomes.map((outcome) => outcome.id === id
            ? { ...outcome, text: multiline(text, MAX_OUTCOME_TEXT).trim() || outcome.text }
            : outcome)),
        updatedAt: now,
    };
}

export function removeOutcome(detail: ActionDetail, id: string, now = Date.now()): ActionDetail {
    return { ...detail, outcomes: normalizeOutcomes(detail.outcomes.filter((outcome) => outcome.id !== id)), updatedAt: now };
}

/** 展示顺序：最新的成果在最上面。 */
export function outcomesForDisplay(detail: ActionDetail): ActionOutcome[] {
    return [...detail.outcomes].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

function longText(value: unknown, max: number): string {
    return typeof value === "string" ? value.slice(0, max) : "";
}

function multiline(value: unknown, max: number): string {
    if (typeof value !== "string") return "";
    return value.replace(/\r\n?/g, "\n").slice(0, max);
}

function dateKey(value: unknown): string | null {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
