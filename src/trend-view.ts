import type { DailyDayType, WeightUnit } from "./daily-records";
import {
    DEFAULT_TREND_METRIC_IDS,
    isTrendMetricId,
    TREND_METRICS,
    type TrendGranularitySetting,
    type TrendMetricId,
    type TrendRangePreset,
    type TrendStatSetting,
    type TrendViewSettings,
} from "./trend-metrics";

/**
 * 趋势视图设置（非关键 UI 数据）。
 *
 * 独立文件 trend-view.json，与 ui-state.json 同级同性质：
 * 保存失败、文件损坏或字段非法时一律回落默认值，绝不阻塞任何正式数据写入。
 */

export const TREND_VIEW_FILE = "trend-view.json";
export const TREND_VIEW_VERSION = 1;

const RANGES: TrendRangePreset[] = ["this-week", "last-week", "30d", "90d", "this-year", "all", "custom"];
const GRANULARITIES: TrendGranularitySetting[] = ["auto", "day", "week", "month"];
const STATS: TrendStatSetting[] = ["auto", "mean", "median"];
const DAY_TYPES: DailyDayType[] = ["research-workday", "conference-day", "saturday-reset", "sunday-half-day", "holiday"];

export const TREND_DAY_TYPE_PRESETS = {
    all: [] as DailyDayType[],
    workday: ["conference-day", "saturday-reset", "sunday-half-day", "holiday"] as DailyDayType[],
    "no-holiday": ["holiday"] as DailyDayType[],
    "no-weekend": ["saturday-reset", "sunday-half-day"] as DailyDayType[],
} as const;

export type TrendDayTypePreset = keyof typeof TREND_DAY_TYPE_PRESETS;

export const TREND_RANGE_LABELS: Record<TrendRangePreset, string> = {
    "this-week": "本周",
    "last-week": "上周",
    "30d": "近 30 天",
    "90d": "近 90 天",
    "this-year": "今年",
    all: "全部",
    custom: "自定义",
};

export const TREND_DAY_TYPE_LABELS: Record<TrendDayTypePreset, string> = {
    all: "全部",
    workday: "仅科研工作日",
    "no-holiday": "排除休假",
    "no-weekend": "排除周六日",
};

export function defaultTrendViewState(): TrendViewSettings {
    return {
        metricIds: [...DEFAULT_TREND_METRIC_IDS],
        range: "this-week",
        customFrom: "",
        customTo: "",
        granularity: "auto",
        stat: "auto",
        excludedDayTypes: [],
        ghostExcluded: true,
        weightUnit: "kg",
        weightTargetKg: 65,
    };
}

export function cloneTrendViewState(state: TrendViewSettings): TrendViewSettings {
    return { ...state, metricIds: [...state.metricIds], excludedDayTypes: [...state.excludedDayTypes] };
}

export function wrapTrendViewFile(state: TrendViewSettings): { version: number; trendViewState: TrendViewSettings } {
    return { version: TREND_VIEW_VERSION, trendViewState: cloneTrendViewState(state) };
}

function isDateKey(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00`));
}

function normalizeMetricIds(value: unknown): TrendMetricId[] {
    if (!Array.isArray(value)) return [...DEFAULT_TREND_METRIC_IDS];
    const wanted = new Set(value.filter(isTrendMetricId));
    const ordered = TREND_METRICS.filter((metric) => wanted.has(metric.id)).map((metric) => metric.id);
    return ordered.length ? ordered : [...DEFAULT_TREND_METRIC_IDS];
}

/**
 * 逐字段容错：单个字段非法只回落该字段，不整份丢弃。
 * 文件的包装结构与裸状态对象都接受（后者用于早期手写或手工修复的场景）。
 */
export function parseTrendViewState(value: unknown): TrendViewSettings | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Partial<TrendViewSettings>;
    const defaults = defaultTrendViewState();
    const target = typeof source.weightTargetKg === "number" && Number.isFinite(source.weightTargetKg) && source.weightTargetKg > 0 && source.weightTargetKg <= 500
        ? Math.round(source.weightTargetKg * 100) / 100
        : source.weightTargetKg === null ? null : defaults.weightTargetKg;
    return {
        metricIds: normalizeMetricIds(source.metricIds),
        range: RANGES.includes(source.range as TrendRangePreset) ? source.range as TrendRangePreset : defaults.range,
        customFrom: isDateKey(source.customFrom) ? source.customFrom : "",
        customTo: isDateKey(source.customTo) ? source.customTo : "",
        granularity: GRANULARITIES.includes(source.granularity as TrendGranularitySetting) ? source.granularity as TrendGranularitySetting : defaults.granularity,
        stat: STATS.includes(source.stat as TrendStatSetting) ? source.stat as TrendStatSetting : defaults.stat,
        excludedDayTypes: Array.isArray(source.excludedDayTypes)
            ? [...new Set(source.excludedDayTypes.filter((entry): entry is DailyDayType => DAY_TYPES.includes(entry as DailyDayType)))]
            : [],
        ghostExcluded: source.ghostExcluded !== false,
        weightUnit: source.weightUnit === "lb" ? "lb" : "kg",
        weightTargetKg: target,
    };
}

export function parseTrendViewFile(value: unknown): TrendViewSettings | null {
    if (value === null || value === undefined || value === "") return null;
    let parsed: unknown = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value);
        } catch {
            return null;
        }
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "trendViewState" in (parsed as Record<string, unknown>)) {
        return parseTrendViewState((parsed as Record<string, unknown>).trendViewState);
    }
    return parseTrendViewState(parsed);
}

export function toggleTrendMetric(state: TrendViewSettings, id: TrendMetricId): TrendViewSettings {
    const selected = new Set(state.metricIds);
    if (selected.has(id)) {
        if (selected.size === 1) return state;
        selected.delete(id);
    } else {
        selected.add(id);
    }
    return { ...cloneTrendViewState(state), metricIds: TREND_METRICS.filter((metric) => selected.has(metric.id)).map((metric) => metric.id) };
}

export function trendDayTypePreset(state: TrendViewSettings): TrendDayTypePreset | "custom" {
    const current = [...state.excludedDayTypes].sort().join(",");
    for (const [key, value] of Object.entries(TREND_DAY_TYPE_PRESETS)) {
        if ([...value].sort().join(",") === current) return key as TrendDayTypePreset;
    }
    return "custom";
}

export function withTrendDayTypePreset(state: TrendViewSettings, preset: TrendDayTypePreset): TrendViewSettings {
    return { ...cloneTrendViewState(state), excludedDayTypes: [...TREND_DAY_TYPE_PRESETS[preset]] };
}

export function trendRangeLabel(state: TrendViewSettings): string {
    if (state.range !== "custom") return TREND_RANGE_LABELS[state.range];
    if (isDateKey(state.customFrom) && isDateKey(state.customTo)) return `${state.customFrom} → ${state.customTo}`;
    return TREND_RANGE_LABELS.custom;
}

export function withWeightUnit(state: TrendViewSettings, unit: WeightUnit): TrendViewSettings {
    return { ...cloneTrendViewState(state), weightUnit: unit };
}
