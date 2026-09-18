/**
 * 日志的级别、scope 与配置结构。
 *
 * 独立成文件的原因：`log.ts` 是记录器本身，`config.ts`（插件设置）与日志面板都只需要
 * 级别/scope/配置形状，不需要把记录器实现拉进依赖链。
 */

export type LogLevel = "verbose" | "info" | "warn" | "error";

export const LOG_LEVELS: readonly LogLevel[] = ["verbose", "info", "warn", "error"];

export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
    verbose: "详细",
    info: "信息",
    warn: "警告",
    error: "错误",
};

/** 固定 scope 清单：面板逐项开关与筛选都以此为准；未知 scope 仍按全局级别记录。 */
export const LOG_SCOPES = [
    { id: "lifecycle", label: "生命周期", description: "插件加载/卸载、页签初始化、全局异常" },
    { id: "store", label: "内部数据", description: "读写、修订号、备份轮换、写后复核、恢复" },
    { id: "daily", label: "生活节律", description: "每日记录与自动保存" },
    { id: "checklist", label: "Checklist", description: "清单配置读写与复核" },
    { id: "nutrition", label: "营养记录", description: "营养数据读写与复核" },
    { id: "siyuan-api", label: "思源 API", description: "接口名、耗时、成功/失败原因" },
    { id: "editor", label: "编辑器", description: "大编辑窗口、行动细则保存" },
    { id: "asset", label: "图片资源", description: "上传、复制、清理" },
    { id: "ui", label: "界面操作", description: "按钮点击、筛选切换、模块切换" },
    { id: "settings", label: "设置", description: "设置读取与保存" },
] as const;

export type LogScopeId = (typeof LOG_SCOPES)[number]["id"];

export const LOG_SCOPE_IDS: readonly string[] = LOG_SCOPES.map((scope) => scope.id);

export type LogConfigInput = {
    minLevel?: LogLevel;
    scopes?: Record<string, LogLevel>;
    bufferSize?: number;
    allowTruncatedText?: boolean;
};

export type LogSettings = {
    /** 全局最低级别。 */
    minLevel: LogLevel;
    /** 按 scope 覆盖；未列出的 scope 跟随 minLevel。 */
    scopes: Record<string, LogLevel>;
    /** 环形缓冲容量（200–10000）。 */
    bufferSize: number;
    /** 是否保留截断后的文本（默认关闭，只记长度）。 */
    allowTruncatedText: boolean;
};

export const DEFAULT_LOG_BUFFER_SIZE = 2000;
export const MIN_LOG_BUFFER_SIZE = 200;
export const MAX_LOG_BUFFER_SIZE = 10000;
export const DEFAULT_LOG_MIN_LEVEL: LogLevel = "warn";

export const DEFAULT_LOG_CONFIG: LogSettings = {
    minLevel: DEFAULT_LOG_MIN_LEVEL,
    scopes: {},
    bufferSize: DEFAULT_LOG_BUFFER_SIZE,
    allowTruncatedText: false,
};

function isLogLevel(value: unknown): value is LogLevel {
    return value === "verbose" || value === "info" || value === "warn" || value === "error";
}

export function clampLogBufferSize(value: unknown): number {
    const size = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(size)) return DEFAULT_LOG_BUFFER_SIZE;
    return Math.min(MAX_LOG_BUFFER_SIZE, Math.max(MIN_LOG_BUFFER_SIZE, Math.trunc(size)));
}

/**
 * 规范化日志配置。
 * 只接受已知级别；非法 scope 条目丢弃，其余回落默认值——设置文件损坏不应影响记录能力。
 */
export function normalizeLogConfig(value: unknown): LogSettings {
    const source = value && typeof value === "object" ? value as Partial<LogSettings> : {};
    const scopes: Record<string, LogLevel> = {};
    if (source.scopes && typeof source.scopes === "object") {
        for (const [scope, level] of Object.entries(source.scopes)) {
            if (!scope || !isLogLevel(level)) continue;
            scopes[scope] = level;
        }
    }
    return {
        minLevel: isLogLevel(source.minLevel) ? source.minLevel : DEFAULT_LOG_CONFIG.minLevel,
        scopes,
        bufferSize: clampLogBufferSize(source.bufferSize ?? DEFAULT_LOG_CONFIG.bufferSize),
        allowTruncatedText: source.allowTruncatedText === true,
    };
}

/** 从插件设置里取出日志配置（设置缺省时回落默认值）。 */
export function logConfigForSettings(settings: { log?: unknown } | null | undefined): LogSettings {
    return normalizeLogConfig(settings?.log);
}
