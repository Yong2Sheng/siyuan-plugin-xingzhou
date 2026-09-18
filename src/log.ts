/**
 * 行舟通用日志工具（单例）。
 *
 * 设计目标：出问题后能按时间线还原"哪一步做了什么、结果如何、耗时多少、错误是什么"。
 * 因此它不是为某个功能定制的探针，而是所有模块共用的记录器：
 *
 * - 每条日志自动带：单调递增序号、时间戳、级别、scope、事件、结构化 detail、可选耗时；
 * - 环形缓冲（默认 2000 条，可配置），只在内存里，不写盘、不发网络，避免影响性能与隐私；
 * - 默认只记 warn/error（日常低开销）；调试时可在日志面板里按 scope 打开 verbose；
 * - 正文类字段按字段名屏蔽，只留长度与类型；其余字符串一律截断。日志里不出现笔记正文。
 *
 * 调用约定：
 * - 级别划分：verbose = 加载/API 成功/队列/筛选等高频信息；info = 用户可见动作的结果；
 *   warn = 已降级但可继续；error = 失败、数据风险、未捕获异常。
 * - 开销：被级别过滤掉时只做一次 scope 查表与比较，不构造 detail、不拼接字符串。
 *   若 detail 的构造本身很贵（例如遍历比对结果），先用 `log.isEnabled(scope, level)` 守卫。
 */
import {
    DEFAULT_LOG_BUFFER_SIZE,
    DEFAULT_LOG_MIN_LEVEL,
    LOG_SCOPES,
    clampLogBufferSize,
    type LogConfigInput,
    type LogLevel,
    type LogScopeId,
} from "./log-config";

export {
    LOG_SCOPES,
    LOG_SCOPE_IDS,
    LOG_LEVELS,
    LOG_LEVEL_LABELS,
    DEFAULT_LOG_CONFIG,
    DEFAULT_LOG_BUFFER_SIZE,
    MIN_LOG_BUFFER_SIZE,
    MAX_LOG_BUFFER_SIZE,
    clampLogBufferSize,
    normalizeLogConfig,
    logConfigForSettings,
} from "./log-config";
export type { LogConfigInput, LogLevel, LogScopeId, LogSettings } from "./log-config";

export type LogDetailValue = string | number | boolean | null | LogDetailValue[] | { [key: string]: LogDetailValue };
export type LogDetail = { [key: string]: unknown };
export type LogScope = LogScopeId | (string & {});

export type LogEntry = {
    /** 单调递增序号：清空缓冲后继续递增，便于跨清空比对时间线。 */
    seq: number;
    /** 记录时刻（毫秒时间戳）。 */
    time: number;
    level: LogLevel;
    scope: string;
    event: string;
    detail?: LogDetail;
    /** 可选耗时（毫秒），由 log.time 或 API 封装填入。 */
    ms?: number;
};

export type LogConfig = {
    /** 全局最低级别：低于它的记录直接丢弃，不构造 detail。 */
    minLevel: LogLevel;
    /** 按 scope 覆盖全局级别；未列出的 scope 跟随 minLevel。 */
    scopes: Record<string, LogLevel>;
    /** 环形缓冲容量。 */
    bufferSize: number;
    /** 是否允许在日志里保留截断后的文本（默认关闭：只记长度）。 */
    allowTruncatedText: boolean;
};

export type LogStats = {
    /** 进入缓冲的总条数（含已覆盖的）。 */
    total: number;
    /** 当前缓冲条数。 */
    size: number;
    /** 因级别过滤被丢弃的条数：据此看出"当时 verbose 没开"。 */
    dropped: number;
    /** 打开日志面板后新产生的 warn/error 条数。 */
    unread: number;
    /** 各错误级别条数（按已进入缓冲的记录统计）。 */
    counts: Record<LogLevel, number>;
    /** 最早/最新一条的时间（缓冲为空时为 null）。 */
    firstTime: number | null;
    lastTime: number | null;
};

export type LogExportMeta = {
    /** 思源内核版本：导出的日志要能说明"当时跑在哪个版本上"。 */
    kernelVersion?: string;
    exportedAt?: number;
    note?: string;
    [key: string]: unknown;
};

export const LOG_EXPORT_KIND = "xingzhou-log";
export const LOG_EXPORT_VERSION = 1;

export const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = { verbose: 10, info: 20, warn: 30, error: 40 };

const IS_LEVEL: Record<string, true> = { verbose: true, info: true, warn: true, error: true };

/** 字段名命中这些词（不区分大小写）时按正文处理：只记长度与类型，不记内容。 */
const BODY_FIELD_WORDS = [
    "content", "contents", "text", "body", "html", "markdown", "md", "kramdown", "dom",
    "title", "draft", "snapshot", "note", "notes", "memo", "value", "excerpt", "snippet",
    "currentaction", "nextaction", "preview", "query", "sql",
];

/** 事件名里命中这些词时也不写出内容（避免调用方把正文塞进事件短语）。 */
const BODY_EVENT_WORDS = ["content", "body", "markdown", "正文", "内容"];

const MAX_FIELD_TEXT = 160;
const TRUNCATED_TEXT_PREVIEW = 60;
const MAX_DETAIL_DEPTH = 4;
const MAX_DETAIL_ITEMS = 20;
const MAX_ERROR_STACK = 400;
const MAX_EVENT_LENGTH = 120;

let config: LogConfig = {
    minLevel: DEFAULT_LOG_MIN_LEVEL,
    scopes: {},
    bufferSize: DEFAULT_LOG_BUFFER_SIZE,
    allowTruncatedText: false,
};

let buffer: Array<LogEntry | undefined> = new Array(DEFAULT_LOG_BUFFER_SIZE);
let start = 0;
let count = 0;
let total = 0;
let dropped = 0;
let seq = 0;
let lastReadSeq = 0;
let counts: Record<LogLevel, number> = { verbose: 0, info: 0, warn: 0, error: 0 };
const listeners = new Set<() => void>();

function notify(): void {
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch {
            // 订阅者自身的异常不能影响记录流程
        }
    }
}

function levelOf(scope: string): LogLevel {
    return config.scopes[scope] ?? config.minLevel;
}

function push(entry: LogEntry): void {
    if (count < buffer.length) {
        buffer[(start + count) % buffer.length] = entry;
        count += 1;
    } else {
        buffer[start] = entry;
        start = (start + 1) % buffer.length;
    }
    total += 1;
    counts[entry.level] += 1;
}

/** 按时间顺序（最旧在前）返回当前缓冲。 */
function list(): LogEntry[] {
    const result: LogEntry[] = [];
    iterate((entry) => {
        result.push(entry);
    });
    return result;
}

/** 直接遍历环形缓冲（最旧在前），用于统计这类不想先建数组的场景。 */
function iterate(visit: (entry: LogEntry) => boolean | void): number {
    let seen = 0;
    for (let index = 0; index < count; index += 1) {
        const entry = buffer[(start + index) % buffer.length];
        if (!entry) continue;
        seen += 1;
        if (visit(entry) === false) return seen;
    }
    return seen;
}

function unreadCount(): number {
    let unread = 0;
    iterate((entry) => {
        if (entry.seq > lastReadSeq && (entry.level === "warn" || entry.level === "error")) unread += 1;
    });
    return unread;
}

function resizeBuffer(size: number): void {
    const next = clampLogBufferSize(size);
    if (next === buffer.length) return;
    const kept = list().slice(-next);
    buffer = new Array(next);
    start = 0;
    count = kept.length;
    for (let index = 0; index < kept.length; index += 1) buffer[index] = kept[index];
}

function record(scope: string, level: LogLevel, event: string, detail?: LogDetail, ms?: number): void {
    let sanitized: LogDetail | undefined;
    try {
        sanitized = sanitizeDetail(detail);
    } catch {
        sanitized = { detailError: "detail 无法序列化" };
    }
    const entry: LogEntry = {
        seq: ++seq,
        time: Date.now(),
        level,
        scope: String(scope || "unknown"),
        event: sanitizeEvent(event),
        ...(sanitized ? { detail: sanitized } : {}),
        ...(typeof ms === "number" && Number.isFinite(ms) ? { ms: Math.round(ms * 100) / 100 } : {}),
    };
    push(entry);
    notify();
}

/**
 * 判断某个 scope 的某个级别当前是否会被记录。
 * 用于在构造昂贵的 detail 之前先短路（默认级别下这些分支完全不执行）。
 */
function isEnabled(scope: LogScope, level: LogLevel = "verbose"): boolean {
    return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[levelOf(String(scope))];
}

function emit(scope: LogScope, level: LogLevel, event: string, detail?: LogDetail, ms?: number): void {
    if (!isEnabled(scope, level)) {
        dropped += 1;
        return;
    }
    record(String(scope), level, event, detail, ms);
}

function startTimer(scope: LogScope, event: string, detail?: LogDetail): (result?: { ok?: boolean; detail?: LogDetail }) => number {
    const started = now();
    return (result = {}) => {
        const elapsed = now() - started;
        const merged: LogDetail = { ...(detail ?? {}), ...(result.detail ?? {}) };
        if (result.ok !== undefined) merged.ok = result.ok;
        if (isEnabled(scope, result.ok === false ? "warn" : "verbose")) {
            record(String(scope), result.ok === false ? "warn" : "verbose", `${event}.done`, merged, elapsed);
        } else {
            dropped += 1;
        }
        return elapsed;
    };
}

/**
 * 需要计时但又不希望"没开日志也付计时成本"时使用：
 * 级别未开启时直接返回原值（不构造计时闭包），开启后返回 `{ ms, result }`。
 */
function measure<T>(scope: LogScope, level: LogLevel, run: () => T): T | { ms: number; result: T } {
    if (!isEnabled(scope, level)) return run();
    const started = now();
    const result = run();
    return { ms: now() - started, result };
}

/** 值是否来自 measure（用于把耗时和结果拆出来）。 */
export function isMeasurement<T>(value: T | { ms: number; result: T }): value is { ms: number; result: T } {
    return Boolean(value) && typeof value === "object" && "ms" in (value as object) && "result" in (value as object);
}

function now(): number {
    const perf = (globalThis as { performance?: { now?: () => number } }).performance;
    return typeof perf?.now === "function" ? perf.now() : Date.now();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function stats(): LogStats {
    let firstTime: number | null = null;
    let lastTime: number | null = null;
    let unread = 0;
    iterate((entry) => {
        if (firstTime === null) firstTime = entry.time;
        lastTime = entry.time;
        if (entry.seq > lastReadSeq && (entry.level === "warn" || entry.level === "error")) unread += 1;
    });
    return {
        total,
        size: count,
        dropped,
        unread,
        counts: { ...counts },
        firstTime,
        lastTime,
    };
}

/** 面板打开即视为已读。 */
function markRead(): void {
    let latest = lastReadSeq;
    iterate((entry) => {
        if (entry.seq > latest) latest = entry.seq;
    });
    if (latest === lastReadSeq) return;
    lastReadSeq = latest;
    notify();
}

function clear(): void {
    buffer = new Array(buffer.length);
    start = 0;
    count = 0;
    counts = { verbose: 0, info: 0, warn: 0, error: 0 };
    notify();
}

/**
 * 清空后把指定条目放回缓冲（保留序号与时间）。
 * 用途：清空日志这个动作本身必须留在时间线里，否则"日志为什么是空的"无从判断。
 */
function restore(entries: LogEntry[]): void {
    if (entries.length === 0) return;
    for (const entry of [...entries].sort((a, b) => a.seq - b.seq)) {
        push(entry);
        if (entry.seq > lastReadSeq && (entry.level === "warn" || entry.level === "error")) lastReadSeq = entry.seq;
    }
    notify();
}

/** 卸载或测试用：清空缓冲并复位序号。 */
function reset(): void {
    clear();
    seq = 0;
    total = 0;
    dropped = 0;
    lastReadSeq = 0;
    config = {
        minLevel: DEFAULT_LOG_MIN_LEVEL,
        scopes: {},
        bufferSize: DEFAULT_LOG_BUFFER_SIZE,
        allowTruncatedText: false,
    };
    buffer = new Array(DEFAULT_LOG_BUFFER_SIZE);
}

function getConfig(): LogConfig {
    return { minLevel: config.minLevel, scopes: { ...config.scopes }, bufferSize: config.bufferSize, allowTruncatedText: config.allowTruncatedText };
}

function configure(next: LogConfigInput): LogConfig {
    if (typeof next.minLevel === "string" && IS_LEVEL[next.minLevel]) config.minLevel = next.minLevel;
    if (next.allowTruncatedText !== undefined) config.allowTruncatedText = Boolean(next.allowTruncatedText);
    if (next.bufferSize !== undefined) {
        const size = clampLogBufferSize(Number(next.bufferSize));
        if (size !== buffer.length) resizeBuffer(size);
        config.bufferSize = size;
    }
    if (next.scopes && typeof next.scopes === "object") {
        const scopes: Record<string, LogLevel> = { ...config.scopes };
        for (const [scope, level] of Object.entries(next.scopes)) {
            if (typeof level === "string" && IS_LEVEL[level]) scopes[scope] = level;
        }
        config.scopes = scopes;
    }
    notify();
    return getConfig();
}

/** 面板逐 scope 开关：level 为 null 时恢复"跟随全局"。 */
function setScopeLevel(scope: string, level: LogLevel | null): void {
    const scopes = { ...config.scopes };
    if (level === null) delete scopes[scope];
    else if (IS_LEVEL[level]) scopes[scope] = level;
    config.scopes = scopes;
    notify();
}

function setMinLevel(level: LogLevel): void {
    if (!IS_LEVEL[level]) return;
    config.minLevel = level;
    notify();
}

function setAllowTruncatedText(allow: boolean): void {
    config.allowTruncatedText = Boolean(allow);
    notify();
}

function sanitizeEvent(event: string): string {
    // 事件名必须能一行放下：压平空白，过长截断
    let text = String(event ?? "").replace(/\s+/g, " ").trim();
    if (text.length > MAX_EVENT_LENGTH) text = `${text.slice(0, MAX_EVENT_LENGTH)}…`;
    if (containsBodyWord(text)) return "[已隐藏含正文的事件名]";
    return text;
}

function containsBodyWord(value: string): boolean {
    const lower = value.toLowerCase();
    return BODY_EVENT_WORDS.some((word) => lower.includes(word));
}

function isBodyField(field: string): boolean {
    const lower = field.toLowerCase();
    return BODY_FIELD_WORDS.some((word) => lower.includes(word));
}

/** 结构化 detail 的隐私过滤：正文类字段只留长度，其余字符串截断。 */
function sanitizeDetail(detail: LogDetail | undefined, depth = 0, seen = new WeakSet<object>()): LogDetail | undefined {
    if (!detail || typeof detail !== "object") return undefined;
    const source = Array.isArray(detail) ? { items: detail } : detail;
    const target: LogDetail = {};
    const keys = Object.keys(source);
    for (const key of keys.slice(0, MAX_DETAIL_ITEMS)) {
        target[key] = sanitizeValue((source as Record<string, unknown>)[key], key, depth, seen);
    }
    if (keys.length > MAX_DETAIL_ITEMS) target.__moreKeys = keys.length - MAX_DETAIL_ITEMS;
    return target;
}

function sanitizeValue(value: unknown, field: string, depth: number, seen: WeakSet<object>): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (typeof value === "bigint") return `${value.toString()}n`;
    if (typeof value === "function") return "[function]";
    if (typeof value === "symbol") return String(value);
    if (typeof value === "string") return sanitizeText(value, field);
    if (value instanceof Error) return describeError(value);
    if (value instanceof Date) return value.toISOString();
    if (depth >= MAX_DETAIL_DEPTH) return "[深层对象已省略]";
    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_DETAIL_ITEMS).map((item, index) => sanitizeValue(item, `${field}[${index}]`, depth + 1, seen));
        if (value.length > MAX_DETAIL_ITEMS) items.push(`…共 ${value.length} 项`);
        return items;
    }
    if (typeof value === "object") {
        if (seen.has(value)) return "[循环引用]";
        seen.add(value);
        const result = sanitizeDetail(value as LogDetail, depth + 1, seen);
        seen.delete(value);
        return result ?? {};
    }
    return String(value);
}

function sanitizeText(value: string, field: string): LogDetailValue {
    const length = value.length;
    if (isBodyField(field)) {
        if (!config.allowTruncatedText) return { kind: "正文", length };
        return { kind: "正文", length, preview: `${value.slice(0, TRUNCATED_TEXT_PREVIEW)}…` };
    }
    if (length <= MAX_FIELD_TEXT) return value;
    if (!config.allowTruncatedText) return `${value.slice(0, TRUNCATED_TEXT_PREVIEW)}…（共 ${length} 字符）`;
    return `${value.slice(0, MAX_FIELD_TEXT)}…（共 ${length} 字符）`;
}

/** 把任意异常转成可读、可导出的结构（栈截断，正文不进入日志）。 */
export function describeError(error: unknown): LogDetail {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: sanitizeText(error.message ?? "", "err"),
            ...(error.stack ? { stack: truncateText(error.stack, MAX_ERROR_STACK) } : {}),
        };
    }
    if (error && typeof error === "object") {
        const record = error as Record<string, unknown>;
        const code = record.code;
        const msg = record.msg ?? record.message;
        if (code !== undefined || msg !== undefined) {
            return {
                ...(code !== undefined ? { code: typeof code === "number" ? code : String(code) } : {}),
                ...(msg !== undefined ? { message: sanitizeText(String(msg), "err") } : {}),
            };
        }
    }
    return { message: sanitizeText(error === undefined ? "undefined" : String(error), "err") };
}

function truncateText(value: string, max: number): string {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max)}…（共 ${text.length} 字符）` : text;
}

function exportMeta(extra: LogExportMeta = {}): LogExportMeta {
    const current: LogStats = stats();
    return {
        kind: LOG_EXPORT_KIND,
        exportVersion: LOG_EXPORT_VERSION,
        exportedAt: Date.now(),
        bufferSize: config.bufferSize,
        minLevel: config.minLevel,
        scopes: { ...config.scopes },
        allowTruncatedText: config.allowTruncatedText,
        entries: current.size,
        totalRecorded: current.total,
        droppedByLevel: current.dropped,
        rangeFrom: current.firstTime,
        rangeTo: current.lastTime,
        levels: { ...current.counts },
        ...extra,
    };
}

/** 面向人的文本导出：头部元信息 + 一行一条时间线。 */
function exportText(extra: LogExportMeta = {}): string {
    const meta = exportMeta(extra);
    const lines: string[] = [
        "# 行舟日志",
        `# 导出时间：${formatTime(Number(meta.exportedAt ?? Date.now()))}`,
        `# 思源内核版本：${meta.kernelVersion ?? "未知"}`,
        `# 生效级别：${meta.minLevel}${Object.keys(config.scopes).length ? `（按 scope 覆盖：${Object.entries(config.scopes).map(([scope, level]) => `${scope}=${level}`).join("、")}）` : ""}`,
        `# 缓冲：${meta.entries} 条 / 上限 ${meta.bufferSize}；累计记录 ${meta.totalRecorded} 条；因级别丢弃 ${meta.droppedByLevel} 条`,
        `# 级别统计：verbose=${counts.verbose} info=${counts.info} warn=${counts.warn} error=${counts.error}`,
        "# 说明：正文类字段只记录长度，不记录内容。",
        "",
    ];
    for (const entry of redactEntries(list())) {
        lines.push(formatEntryLine(entry));
    }
    return lines.join("\n");
}

/** 机器可读导出：{ meta, entries }。 */
function exportJson(extra: LogExportMeta = {}): string {
    return JSON.stringify({ meta: exportMeta(extra), entries: redactEntries(list()) }, null, 2);
}

/** 导出的最后一道防线：即便某条 detail 里混进了正文类字符串，也不写进导出结果。 */
function redactEntries(entries: LogEntry[]): LogEntry[] {
    return entries.map((entry) => ({
        ...entry,
        ...(entry.detail ? { detail: redactDetail(entry.detail) } : {}),
    }));
}

function redactDetail(detail: LogDetail): LogDetail {
    const target: LogDetail = {};
    for (const [key, value] of Object.entries(detail)) {
        target[key] = redactValue(value, key);
    }
    return target;
}

function redactValue(value: unknown, field: string): unknown {
    if (typeof value === "string") {
        if (isBodyField(field) || containsBodyWord(value)) return sanitizeText(value, field);
        return value;
    }
    if (Array.isArray(value)) return value.map((item, index) => redactValue(item, `${field}[${index}]`));
    if (value && typeof value === "object") return redactDetail(value as LogDetail);
    return value;
}

function formatEntryLine(entry: LogEntry): string {
    const head = `${formatTime(entry.time)} #${entry.seq} ${entry.level.toUpperCase().padEnd(7)} ${entry.scope} ${entry.event}`;
    const time = entry.ms === undefined ? "" : ` ms=${entry.ms}`;
    const detail = entry.detail && Object.keys(entry.detail).length > 0 ? ` ${JSON.stringify(entry.detail)}` : "";
    return `${head}${time}${detail}`;
}

/** 面板与导出共用的时间格式：本地时间 + 毫秒。 */
export function formatTime(time: number): string {
    const date = new Date(time);
    const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export type LogSink = {
    verbose: (scope: LogScope, event: string, detail?: LogDetail, ms?: number) => void;
    info: (scope: LogScope, event: string, detail?: LogDetail, ms?: number) => void;
    warn: (scope: LogScope, event: string, detail?: LogDetail, ms?: number) => void;
    error: (scope: LogScope, event: string, detail?: LogDetail, ms?: number) => void;
};

export const log: LogSink & {
    time: typeof startTimer;
    measure: typeof measure;
    isMeasurement: typeof isMeasurement;
    isEnabled: typeof isEnabled;
    configure: typeof configure;
    getConfig: typeof getConfig;
    setMinLevel: typeof setMinLevel;
    setScopeLevel: typeof setScopeLevel;
    setAllowTruncatedText: typeof setAllowTruncatedText;
    levelOf: (scope: LogScope) => LogLevel;
    entries: typeof list;
    stats: typeof stats;
    subscribe: typeof subscribe;
    markRead: typeof markRead;
    clear: typeof clear;
    restore: typeof restore;
    reset: typeof reset;
    exportText: typeof exportText;
    exportJson: typeof exportJson;
    exportMeta: typeof exportMeta;
    formatEntryLine: typeof formatEntryLine;
} = {
    verbose: (scope: LogScope, event: string, detail?: LogDetail, ms?: number) => emit(scope, "verbose", event, detail, ms),
    info: (scope: LogScope, event: string, detail?: LogDetail, ms?: number) => emit(scope, "info", event, detail, ms),
    warn: (scope: LogScope, event: string, detail?: LogDetail, ms?: number) => emit(scope, "warn", event, detail, ms),
    error: (scope: LogScope, event: string, detail?: LogDetail, ms?: number) => emit(scope, "error", event, detail, ms),
    time: startTimer,
    measure,
    isMeasurement,
    isEnabled,
    configure,
    getConfig,
    setMinLevel,
    setScopeLevel,
    setAllowTruncatedText,
    levelOf: (scope: LogScope) => levelOf(String(scope)),
    entries: list,
    stats,
    subscribe,
    markRead,
    clear,
    restore,
    reset,
    exportText,
    exportJson,
    exportMeta,
    formatEntryLine,
};

export type LogRecorder = typeof log;
