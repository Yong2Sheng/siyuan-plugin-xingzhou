/**
 * 「本次行动细则」的结构化内容。
 *
 * 为什么不再是单块文本：细则里混着三种性质完全不同的东西——
 * ① 复访时要立刻看到的状态（做到哪、卡在哪）；② 长期背景与提示词；③ 已经产出的成果条目。
 * 混在一起时，间隔一周回来必须重读全文才能接上，机器也无法区分「这次要做什么」和「上次做到哪」。
 *
 * 兼容：旧的单块文本（WorkItem.currentAction）在升级时映射到「行动指导与想法」，
 * 并在当前状态里留一行迁移标记；迁移是幂等的，不会覆盖任何已写内容。
 */

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
    /** 当前状态：复访第一眼看的内容（上次做到 / 卡在哪）。 */
    currentState: string;
    background: string;
    prompt: string;
    /** 阶段性成果，一条一条。 */
    outcomes: ActionOutcome[];
    /** 行动指导与想法；旧版细则文本迁移到这里。 */
    guidance: string;
    /** 事务级的完成定义。 */
    definition: string;
    updatedAt: number | null;
    /** 旧版细则已迁移的标记；null 表示没有迁移过。 */
    migratedFromCurrentActionAt: number | null;
};

export type ActionDetailField = "currentState" | "background" | "prompt" | "guidance" | "definition";

const MAX_LONG_FIELD = 50000;
const MAX_STATE_FIELD = 20000;
const MAX_OUTCOMES = 200;
const MAX_OUTCOME_TEXT = 2000;

export const ACTION_DETAIL_FIELDS: Array<{ key: ActionDetailField; label: string; hint: string; required?: boolean }> = [
    { key: "currentState", label: "当前状态", hint: "上次做到哪、卡在哪；复访第一眼看这里", required: true },
    { key: "background", label: "背景与约束", hint: "为什么有这件事、有哪些限制" },
    { key: "prompt", label: "Prompt", hint: "发给 AI 的提示词" },
    { key: "guidance", label: "行动指导与想法", hint: "打算怎么做、有什么想法" },
    { key: "definition", label: "完成定义", hint: "怎么算做完", },
];

export function createEmptyActionDetail(): ActionDetail {
    return {
        currentState: "",
        background: "",
        prompt: "",
        outcomes: [],
        guidance: "",
        definition: "",
        updatedAt: null,
        migratedFromCurrentActionAt: null,
    };
}

export function normalizeActionDetail(value: unknown): ActionDetail {
    if (!value || typeof value !== "object") return createEmptyActionDetail();
    const source = value as Partial<ActionDetail>;
    return {
        currentState: longText(source.currentState, MAX_STATE_FIELD),
        background: longText(source.background, MAX_LONG_FIELD),
        prompt: longText(source.prompt, MAX_LONG_FIELD),
        outcomes: normalizeOutcomes(source.outcomes),
        guidance: longText(source.guidance, MAX_LONG_FIELD),
        definition: longText(source.definition, MAX_STATE_FIELD),
        updatedAt: finiteNumber(source.updatedAt),
        migratedFromCurrentActionAt: finiteNumber(source.migratedFromCurrentActionAt),
    };
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

/** 是否有任何结构化内容——用于判断「要不要把旧文本迁进来」和「细则算不算写过」。 */
export function hasActionDetailContent(detail: ActionDetail): boolean {
    return Boolean(detail.currentState.trim() || detail.background.trim() || detail.prompt.trim()
        || detail.guidance.trim() || detail.definition.trim() || detail.outcomes.length > 0);
}

export function setActionDetailField(detail: ActionDetail, field: ActionDetailField, value: string, now = Date.now()): ActionDetail {
    const max = field === "currentState" || field === "definition" ? MAX_STATE_FIELD : MAX_LONG_FIELD;
    return { ...detail, [field]: longText(value, max), updatedAt: now };
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
 * 「下一步行动」仍在独立字段里，这里把它渲染成第一行，让兼容文本读起来仍然完整。
 * 保留了旧字段的读取方：图片清理扫描、图库体检、缺字段提示都还看得到图片与文字。
 * 空细则返回空串，调用方据此决定是否跳过写入。
 */
export function actionDetailToLegacyText(detail: ActionDetail, nextAction = ""): string {
    const blocks: string[] = [];
    const next = nextAction.trim();
    if (next) blocks.push(`下一步：${next}`);
    if (detail.currentState.trim()) blocks.push(detail.currentState.trim());
    const outcomes = outcomesForDisplay(detail);
    if (outcomes.length > 0) {
        blocks.push(["## 阶段性成果", ...outcomes.map((outcome) => `- ${outcome.text}`)].join("\n"));
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

export function createOutcomeId(now = Date.now()): string {
    return `outcome-${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function localDateKey(timestamp = Date.now()): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
