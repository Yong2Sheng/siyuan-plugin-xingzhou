import { DEFAULT_LOG_CONFIG, normalizeLogConfig, type LogSettings } from "./log-config";

export const DEFAULT_ATTRIBUTE_VIEW_ID = "20260825232623-6ukk2rc";
export const DEFAULT_DATABASE_BLOCK_ID = "20260825232623-58nsl9x";
export const DEFAULT_ALL_ITEMS_VIEW_NAME = "全部工作项";
export const DEFAULT_INBOX_VIEW_NAME = "快速收件箱";

export type XingzhouSettings = {
    attributeViewId: string;
    databaseBlockId: string;
    /** 日志配置（级别、按 scope 覆盖、缓冲容量）跟随插件设置持久化，不另建存储。 */
    log: LogSettings;
};

export const DEFAULT_SETTINGS: XingzhouSettings = {
    attributeViewId: DEFAULT_ATTRIBUTE_VIEW_ID,
    databaseBlockId: DEFAULT_DATABASE_BLOCK_ID,
    log: DEFAULT_LOG_CONFIG,
};

export function normalizeSettings(value: unknown): XingzhouSettings {
    const source = value && typeof value === "object" ? value as Partial<XingzhouSettings> : {};
    return {
        attributeViewId: source.attributeViewId?.trim() || DEFAULT_ATTRIBUTE_VIEW_ID,
        databaseBlockId: source.databaseBlockId?.trim() || DEFAULT_DATABASE_BLOCK_ID,
        log: normalizeLogConfig(source.log),
    };
}
