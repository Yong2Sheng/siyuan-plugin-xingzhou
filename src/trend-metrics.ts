import {
    DAILY_RUBRICS,
    type DailyDayType,
    type DailyRecord,
    type DailyRecordFields,
    type DailyRubric,
    type WeightUnit,
} from "./daily-records";
import { nutritionTotalsForDate, type NutritionStore } from "./nutrition";

/**
 * 趋势指标注册表与取值。
 *
 * 这一层只做「纯数据」的事：把每日记录/营养记录里的数字字段，按统一口径变成折线点。
 * 三条口径约定（详见设计稿）：
 * 1. 夜晚归日：一条记录描述的是「记录日 − 1」那天傍晚开始的那一夜；凌晨的时刻不跨列。
 * 2. 24 点记法：时刻一律用「这一夜所属日零点起算的小时数」表示，01:00 → 25.0，13:10 → 37.2。
 * 3. 缺失不补：没有记录的日期不连线、不补 0；分桶时缺失日不参与分母，并标出覆盖度。
 */

const KG_TO_LB = 2.2046226218487757;
const DAY_MS = 86400000;

export type TrendMetricId =
    | "sleepWindow"
    | "weight"
    | "energy"
    | "sleepDuration"
    | "watchSleepScore"
    | "sleepQuality"
    | "depletingStress"
    | "promotingStress"
    | "workEfficiency"
    | "workBoundary"
    | "closureDuration"
    | "protein"
    | "calories";

export type TrendMetricGroup = "sleep" | "day" | "nutrition";
export type TrendAxisFormat = "clock" | "score" | "weight" | "hours" | "grams" | "kcal";
export type TrendValueFormat = TrendAxisFormat | "minutes";
export type TrendStat = "mean" | "median";
export type TrendStatSetting = TrendStat | "auto";
export type TrendTone = "good" | "bad" | "neutral";
export type TrendGranularity = "day" | "week" | "month";
export type TrendGranularitySetting = TrendGranularity | "auto";
export type TrendRangePreset = "this-week" | "last-week" | "30d" | "90d" | "this-year" | "all" | "custom";

export type TrendZone = { from: number; to: number; tone: TrendTone };
export type TrendGuideLine = { y: number; label: string; tone: TrendTone };
export type TrendTarget = { y: number; label: string };
export type TrendBand = { x: number; label: string; span: number };
export type TrendPoint = {
    /** X 轴锚点（夜晚归日或记录日的连续天序号）。 */
    x: number;
    y: number;
    /** 桶内样本不足 3 个时画空心点，避免冒充「周平均」。 */
    low?: boolean;
    /** 桶内样本数（按日粒度时为 1）。 */
    count: number;
    /** 该点对应的原始记录日期，点击时用它跳回当天记录。 */
    recordDate: string;
    meta?: string;
};

export type TrendSeries = {
    id: string;
    label: string;
    colorIndex: number;
    ghost?: boolean;
    points: TrendPoint[];
    /** 被 dayType 过滤掉的点：置灰保留，不参与均值。 */
    excluded: TrendPoint[];
};

export type TrendChartData = {
    id: TrendMetricId;
    title: string;
    subtitle: string;
    unitLabel: string;
    axisFormat: TrendAxisFormat;
    valueFormat: TrendValueFormat;
    stat: TrendStat;
    statLabel: string;
    granularity: TrendGranularity;
    xAnchor: "night" | "day";
    xDomain: [number, number];
    yDomain: [number, number];
    yTicks: number[];
    series: TrendSeries[];
    bands: TrendBand[];
    zones: TrendZone[];
    lines: TrendGuideLine[];
    target: TrendTarget | null;
    coverage: string;
    notes: string[];
    /** 全部序列里可见（未置灰）的聚合点数。 */
    pointCount: number;
    /** 窗口内真正有数据的天数（聚合前）：空状态按它判断，不能按聚合点数判断。 */
    rawDayCount: number;
};

export type TrendViewSettings = {
    metricIds: TrendMetricId[];
    range: TrendRangePreset;
    customFrom: string;
    customTo: string;
    granularity: TrendGranularitySetting;
    stat: TrendStatSetting;
    excludedDayTypes: DailyDayType[];
    ghostExcluded: boolean;
    weightUnit: WeightUnit;
    weightTargetKg: number | null;
};

export type TrendChartContext = {
    records: DailyRecord[];
    nutrition: NutritionStore | null;
    settings: TrendViewSettings;
    /** 今天的连续天序号，用于本周/今年这类相对范围。 */
    today: number;
};

type RawSeries = {
    id: string;
    label: string;
    colorIndex: number;
    ghost?: boolean;
    markers?: boolean;
    points: Array<{ anchor: number; value: number; recordDate: string; meta?: string; dayType: DailyDayType; band?: boolean }>;
};

type RawBand = { anchor: number; dayType: DailyDayType };

type MetricBuild = {
    series: RawSeries[];
    bands: RawBand[];
    notes: string[];
    zones: TrendZone[];
    lines: TrendGuideLine[];
    target: TrendTarget | null;
    yDomain: [number, number];
    yTicks: number[];
    padLeft?: number;
    statDefault?: TrendStat;
};

export type TrendMetricDefinition = {
    id: TrendMetricId;
    label: string;
    group: TrendMetricGroup;
    unitLabel: string;
    axisFormat: TrendAxisFormat;
    valueFormat: TrendValueFormat;
    defaultChecked: boolean;
    statDefault: TrendStat;
    description: string;
};

// ---------------------------------------------------------------- 基础换算

export function trendDayIndex(dateKey: string): number {
    const [year, month, day] = dateKey.split("-").map(Number);
    if (!year || !month || !day) return Number.NaN;
    return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function trendDateKey(index: number): string {
    const date = new Date(index * DAY_MS);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function trendShiftDate(dateKey: string, days: number): string {
    return trendDateKey(trendDayIndex(dateKey) + days);
}

function weekdayOf(index: number): number {
    return new Date(index * DAY_MS).getUTCDay();
}

function clockHours(value: string): number {
    return Number(value.slice(0, 2)) + Number(value.slice(3, 5)) / 60;
}

/**
 * 时刻 → 夜轴上的 Y：以「这一夜所属日」的零点为原点，跨过午夜继续累加。
 * 同时刻的 23:30 与 00:30 会得到 23.5 与 24.5，求平均才有意义。
 */
export function trendNightValue(stamp: string, night: number): number {
    return clockHours(stamp.slice(11)) + 24 * (trendDayIndex(stamp.slice(0, 10)) - night);
}

export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
    if (from === to) return value;
    return from === "kg" ? value * KG_TO_LB : value / KG_TO_LB;
}

export function trendWeekStart(index: number): number {
    return index - ((weekdayOf(index) + 6) % 7);
}

export function trendMonthStart(index: number): number {
    const date = new Date(index * DAY_MS);
    return trendDayIndex(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`);
}

// ---------------------------------------------------------------- 指标注册表

export const TREND_METRICS: readonly TrendMetricDefinition[] = [
    {
        id: "sleepWindow", label: "睡眠窗口", group: "sleep", unitLabel: "时刻（24 点记法）",
        axisFormat: "clock", valueFormat: "clock", defaultChecked: true, statDefault: "mean",
        description: "熄灯 / 起床 / 计划熄灯同图；红区 24:00–05:00 为熬夜危险区，绿区 06:00–08:00 为起床目标。",
    },
    {
        id: "weight", label: "晨起体重", group: "day", unitLabel: "kg",
        axisFormat: "weight", valueFormat: "weight", defaultChecked: true, statDefault: "mean",
        description: "每日一次；目标线可在图上直接改，改完写进趋势设置。",
    },
    {
        id: "energy", label: "白天精力", group: "day", unitLabel: "分",
        axisFormat: "score", valueFormat: "score", defaultChecked: true, statDefault: "median",
        description: "1–5 分，越高越好；4–5 绿、3 灰、1–2 红，默认取中位数。",
    },
    {
        id: "sleepDuration", label: "睡眠时长", group: "sleep", unitLabel: "小时",
        axisFormat: "hours", valueFormat: "hours", defaultChecked: false, statDefault: "mean",
        description: "手表实际睡眠，并对照卧床跨度（熄灯→起床）；两者差额 = 入睡潜伏 + 夜醒。",
    },
    {
        id: "watchSleepScore", label: "手表睡眠评分", group: "day", unitLabel: "分",
        axisFormat: "score", valueFormat: "score", defaultChecked: false, statDefault: "mean",
        description: "0–100 分，条件填写；不设红绿区，只看走势。",
    },
    {
        id: "sleepQuality", label: "主观睡眠质量", group: "day", unitLabel: "分",
        axisFormat: "score", valueFormat: "score", defaultChecked: false, statDefault: "median",
        description: "1–5 分，越高越好。",
    },
    {
        id: "depletingStress", label: "损耗性压力", group: "day", unitLabel: "分",
        axisFormat: "score", valueFormat: "score", defaultChecked: false, statDefault: "median",
        description: "1–5 分，越低越好；3 分为界线，以上为损耗区。",
    },
    {
        id: "promotingStress", label: "促进性压力", group: "day", unitLabel: "分",
        axisFormat: "score", valueFormat: "score", defaultChecked: false, statDefault: "median",
        description: "1–5 分，3–4 为适度区间；过低没有动力、过高变成损耗。",
    },
    {
        id: "workEfficiency", label: "工作效率", group: "day", unitLabel: "分",
        axisFormat: "score", valueFormat: "score", defaultChecked: false, statDefault: "median",
        description: "1–5 分，越高越好。",
    },
    {
        id: "workBoundary", label: "下班边界", group: "day", unitLabel: "时刻",
        axisFormat: "clock", valueFormat: "clock", defaultChecked: false, statDefault: "mean",
        description: "计划下班 vs 实际下班；16:00–17:00 为合适区间。",
    },
    {
        id: "closureDuration", label: "工作闭环时长", group: "day", unitLabel: "分钟",
        axisFormat: "hours", valueFormat: "minutes", defaultChecked: false, statDefault: "mean",
        description: "计划 vs 实际；30 分钟以内为宜。",
    },
    {
        id: "protein", label: "已记录摄入 · 蛋白质", group: "nutrition", unitLabel: "g",
        axisFormat: "grams", valueFormat: "grams", defaultChecked: false, statDefault: "mean",
        description: "早+午自制餐的可估计部分，晚餐在食堂不记；看与目标之间的缺口。",
    },
    {
        id: "calories", label: "已记录摄入 · 热量", group: "nutrition", unitLabel: "kcal",
        axisFormat: "kcal", valueFormat: "kcal", defaultChecked: false, statDefault: "mean",
        description: "同上；数值只代表已记录的部分，不代表全天摄入。",
    },
] as const;

export const DEFAULT_TREND_METRIC_IDS: TrendMetricId[] = TREND_METRICS.filter((metric) => metric.defaultChecked).map((metric) => metric.id);

export function trendMetricById(id: TrendMetricId): TrendMetricDefinition {
    return TREND_METRICS.find((metric) => metric.id === id) ?? TREND_METRICS[0];
}

export function isTrendMetricId(value: unknown): value is TrendMetricId {
    return typeof value === "string" && TREND_METRICS.some((metric) => metric.id === value);
}

// ---------------------------------------------------------------- 范围与分桶

export function trendRangeWindow(settings: TrendViewSettings, today: number, dataDays: number[]): [number, number] {
    const last = dataDays.length ? Math.max(...dataDays) : today;
    switch (settings.range) {
        case "this-week": {
            const start = trendWeekStart(today);
            return [start, start + 6];
        }
        case "last-week": {
            const start = trendWeekStart(today) - 7;
            return [start, start + 6];
        }
        case "30d": return [today - 29, today];
        case "90d": return [today - 89, today];
        case "this-year": return [trendDayIndex(`${trendDateKey(today).slice(0, 4)}-01-01`), today];
        case "all": return [Math.min(today, ...(dataDays.length ? dataDays : [today])), Math.max(last, today)];
        case "custom": {
            const from = trendDayIndex(settings.customFrom);
            const to = trendDayIndex(settings.customTo);
            if (Number.isNaN(from) || Number.isNaN(to)) return [today - 29, today];
            return from <= to ? [from, to] : [to, from];
        }
        default: return [today - 29, today];
    }
}

export function trendGranularityFor(from: number, to: number, setting: TrendGranularitySetting): TrendGranularity {
    if (setting !== "auto") return setting;
    const span = Math.abs(to - from) + 1;
    if (span <= 45) return "day";
    if (span <= 180) return "week";
    return "month";
}

/**
 * 自动粒度还要看数据的实际分布：
 * 「今年」窗口下的月度聚合会把只有一个月数据的指标压成 1 个点（看起来像没数据），
 * 所以当窗口内的非空桶 ≤ 1 时逐级退回更细的粒度。显式选了粒度的不干预。
 */
export function trendEffectiveGranularity(
    setting: TrendGranularitySetting,
    from: number,
    to: number,
    anchorDays: number[],
): { granularity: TrendGranularity; fellBack: boolean } {
    const planned = trendGranularityFor(from, to, setting);
    if (setting !== "auto" || planned === "day") return { granularity: planned, fellBack: false };
    const inWindow = anchorDays.filter((day) => day >= from && day <= to);
    let granularity: TrendGranularity = planned;
    while (granularity !== "day") {
        const bins = new Set(inWindow.map((day) => binStart(day, granularity)));
        if (bins.size > 1) break;
        granularity = granularity === "month" ? "week" : "day";
    }
    return { granularity, fellBack: granularity !== planned };
}

function binStart(index: number, granularity: TrendGranularity): number {
    if (granularity === "week") return trendWeekStart(index);
    if (granularity === "month") return trendMonthStart(index);
    return index;
}

function binEnd(index: number, granularity: TrendGranularity): number {
    if (granularity === "week") return trendWeekStart(index) + 6;
    if (granularity === "month") {
        const start = trendMonthStart(index);
        const date = new Date(start * DAY_MS);
        return trendDayIndex(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 2).padStart(2, "0")}-01`) - 1;
    }
    return index;
}

export function mergeTrendStat(values: number[], stat: TrendStat): number {
    if (!values.length) return Number.NaN;
    if (stat === "median") {
        const sorted = values.slice().sort((left, right) => left - right);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// ---------------------------------------------------------------- 取值辅助

function fieldNumber(record: DailyRecord, key: keyof DailyRecord["fields"]): number | null {
    const value = record.fields[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function scoreZones(rubricId: DailyRubric["id"]): { zones: TrendZone[]; lines: TrendGuideLine[] } {
    const direction = DAILY_RUBRICS.find((rubric) => rubric.id === rubricId)?.direction ?? "higher-is-better";
    if (direction === "lower-is-better") {
        return {
            zones: [{ from: 0.6, to: 3, tone: "good" }, { from: 3, to: 5.4, tone: "bad" }],
            lines: [{ y: 3, label: "3 分界线：以上为损耗区", tone: "bad" }],
        };
    }
    if (direction === "balanced") {
        return {
            zones: [{ from: 0.6, to: 3, tone: "bad" }, { from: 3, to: 4, tone: "good" }, { from: 4, to: 5.4, tone: "bad" }],
            lines: [{ y: 3, label: "3–4 为适度区间", tone: "good" }],
        };
    }
    return {
        zones: [{ from: 0.6, to: 3, tone: "bad" }, { from: 3, to: 4, tone: "neutral" }, { from: 4, to: 5.4, tone: "good" }],
        lines: [{ y: 4, label: "达标方向 ≥4", tone: "good" }],
    };
}

/** 评分指标 id → 记录字段名（同时也正好是 DAILY_RUBRICS 的 id）。 */
const SCORE_FIELDS: Partial<Record<TrendMetricId, keyof DailyRecordFields>> = {
    energy: "daytimeEnergy",
    sleepQuality: "subjectiveSleepQuality",
    workEfficiency: "workEfficiency",
    promotingStress: "promotingStress",
    depletingStress: "depletingStress",
};

const SCORE_DOMAIN: [number, number] = [0.6, 5.4];
const SCORE_TICKS = [1, 2, 3, 4, 5];

/** 数值型指标的 Y 轴：按数据范围取整到好看的步长，并留出上下边距。 */
export function niceTrendScale(min: number, max: number, step: number, options: { zeroBased?: boolean } = {}): { domain: [number, number]; ticks: number[] } {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { domain: [0, step], ticks: [0, step] };
    let low = Math.floor(min / step) * step;
    let high = Math.ceil(max / step) * step;
    if (options.zeroBased) low = Math.min(0, low);
    if (low === high) high = low + step;
    const ticks: number[] = [];
    for (let value = low; value <= high + step / 2; value += step) ticks.push(Math.round(value * 100) / 100);
    return { domain: [low, high], ticks };
}

// ---------------------------------------------------------------- 各指标取值

function sleepSeries(context: TrendChartContext): RawSeries[] {
    const points = { off: [] as RawSeries["points"], wake: [] as RawSeries["points"], span: [] as RawSeries["points"], plan: [] as RawSeries["points"] };
    const planByNight = new Map<number, { value: number; recordDate: string; meta: string; dayType: DailyDayType }>();
    for (const record of context.records) {
        const night = trendDayIndex(record.date) - 1;
        const fields = record.fields;
        if (fields.wakeAt) {
            points.wake.push({ anchor: night, value: trendNightValue(fields.wakeAt, night), recordDate: record.date, dayType: record.dayType });
        }
        if (fields.lightsOffAt) {
            points.off.push({ anchor: night, value: trendNightValue(fields.lightsOffAt, night), recordDate: record.date, dayType: record.dayType });
        }
        if (fields.wakeAt && fields.lightsOffAt) {
            const span = (Date.parse(fields.wakeAt) - Date.parse(fields.lightsOffAt)) / 3600000;
            if (Number.isFinite(span) && span > 0) {
                points.span.push({ anchor: night, value: Math.round(span * 100) / 100, recordDate: record.date, dayType: record.dayType });
            }
        }
        // 「今晚计划熄灯」属于从今天傍晚开始的那一夜，归日 = 记录日
        if (fields.plannedLightsOffAt) {
            const planNight = trendDayIndex(record.date);
            planByNight.set(planNight, {
                value: trendNightValue(fields.plannedLightsOffAt, planNight),
                recordDate: record.date,
                meta: fields.plannedLightsOffAt.slice(11),
                dayType: record.dayType,
            });
        }
    }
    for (const [night, plan] of [...planByNight.entries()].sort((left, right) => left[0] - right[0])) {
        points.plan.push({ anchor: night, value: plan.value, recordDate: plan.recordDate, dayType: plan.dayType });
    }
    return [
        { id: "off", label: "熄灯（关灯上床）", colorIndex: 0, points: points.off },
        { id: "wake", label: "起床", colorIndex: 1, points: points.wake },
        { id: "plan", label: "计划熄灯", colorIndex: 2, ghost: true, points: points.plan },
    ];
}

function simpleSeries(
    context: TrendChartContext,
    id: string,
    label: string,
    colorIndex: number,
    pick: (record: DailyRecord) => number | null,
    options: { anchor?: "night" | "day"; ghost?: boolean; transform?: (value: number, record: DailyRecord) => number } = {},
): RawSeries {
    const anchor = options.anchor ?? "day";
    const points: RawSeries["points"] = [];
    for (const record of context.records) {
        const value = pick(record);
        if (value === null || !Number.isFinite(value)) continue;
        points.push({
            anchor: anchor === "night" ? trendDayIndex(record.date) - 1 : trendDayIndex(record.date),
            value: options.transform ? options.transform(value, record) : value,
            recordDate: record.date,
            dayType: record.dayType,
        });
    }
    return { id, label, colorIndex, ghost: options.ghost, points };
}

function nutritionSeries(context: TrendChartContext, id: string, label: string, pick: (totals: ReturnType<typeof nutritionTotalsForDate>) => number): RawSeries {
    const points: RawSeries["points"] = [];
    if (!context.nutrition) return { id, label, colorIndex: 0, points };
    const dates = [...new Set(context.nutrition.entries.map((entry) => entry.date))].sort();
    for (const date of dates) {
        const totals = nutritionTotalsForDate(context.nutrition, date);
        const record = context.records.find((candidate) => candidate.date === date);
        points.push({
            anchor: trendDayIndex(date),
            value: Math.round(pick(totals) * 10) / 10,
            recordDate: date,
            meta: `${totals.entries} 条记录`,
            dayType: record?.dayType ?? "research-workday",
        });
    }
    return { id, label, colorIndex: 0, points };
}

/**
 * 时刻型 Y 轴：范围按整点取整，刻度按跨度选步长。
 * 跨夜窗口通常有 15 小时以上，逐小时铺刻度会在窄屏重叠，所以跨度超过 8 小时就两小时一条。
 */
function clockDomain(values: number[], min: number, max: number): { domain: [number, number]; ticks: number[] } {
    const finite = values.filter((value) => Number.isFinite(value));
    const low = Math.floor(Math.min(min, ...finite));
    const high = Math.ceil(Math.max(max, ...finite));
    const step = high - low > 8 ? 2 : 1;
    const ticks: number[] = [];
    for (let value = Math.ceil(low / step) * step; value <= high; value += step) ticks.push(value);
    return { domain: [low, high], ticks };
}

// ---------------------------------------------------------------- 图表构建

/** 睡眠类指标用夜晚归日，其余按记录日。 */
export function trendUsesNightAnchor(metricId: TrendMetricId): boolean {
    return metricId === "sleepWindow" || metricId === "sleepDuration";
}

export function buildTrendChart(metricId: TrendMetricId, context: TrendChartContext): TrendChartData {
    const definition = trendMetricById(metricId);
    const build = metricBuild(metricId, context);
    const night = trendUsesNightAnchor(metricId);

    // 窗口按「记录锚点」而不是「已绘制的点」计算：只标了时段、没记时刻的夜晚也要算进数据范围。
    const anchorDays = context.records.map((record) => night ? trendDayIndex(record.date) - 1 : trendDayIndex(record.date));
    if (metricId === "sleepWindow") anchorDays.push(...context.records.map((record) => trendDayIndex(record.date)));
    if (definition.group === "nutrition" && context.nutrition) {
        anchorDays.push(...context.nutrition.entries.map((entry) => trendDayIndex(entry.date)));
    }
    const [windowFrom, windowTo] = trendRangeWindow(context.settings, context.today, anchorDays);
    const { granularity, fellBack } = trendEffectiveGranularity(context.settings.granularity, windowFrom, windowTo, anchorDays);
    const stat: TrendStat = context.settings.stat === "auto" ? (build.statDefault ?? definition.statDefault) : context.settings.stat;
    const excluded = new Set(context.settings.excludedDayTypes);
    const windowRecords = context.records.filter((record) => {
        const index = trendDayIndex(record.date);
        return index >= windowFrom && index <= windowTo;
    }).length;

    const keptRaw = new Map<string, RawSeries["points"]>();
    const series: TrendSeries[] = build.series.map((raw) => {
        const kept: RawSeries["points"] = [];
        const dropped: RawSeries["points"] = [];
        for (const point of raw.points) {
            if (point.anchor < windowFrom || point.anchor > windowTo) continue;
            if (excluded.has(point.dayType)) dropped.push(point);
            else kept.push(point);
        }
        keptRaw.set(raw.id, kept);
        return {
            id: raw.id,
            label: raw.label,
            colorIndex: raw.colorIndex,
            ghost: raw.ghost,
            points: binPoints(kept, granularity, stat),
            excluded: context.settings.ghostExcluded ? binPoints(dropped, granularity, stat, true) : [],
        };
    });

    const primaryId = series.find((entry) => !entry.ghost)?.id ?? series[0]?.id ?? "";
    const rawDayCount = new Set((keptRaw.get(primaryId) ?? []).map((point) => point.anchor)).size;
    const values = series.filter((entry) => !entry.ghost).flatMap((entry) => entry.points.map((point) => point.y));
    const scale = build.yTicks.length && build.yDomain[0] === SCORE_DOMAIN[0]
        ? { domain: build.yDomain, ticks: build.yTicks }
        : scaleForMetric(metricId, context, build, values);
    // 竖带同样要过滤、同样要分桶：否则切到按周/按月时，逐夜竖带会全叠在同一格上
    const rawBands = build.bands.filter((band) => band.anchor >= windowFrom && band.anchor <= windowTo && !excluded.has(band.dayType));
    const bands = aggregateBands(rawBands, granularity);

    return {
        id: metricId,
        title: definition.label,
        subtitle: series.map((entry) => entry.label).join(" · "),
        unitLabel: metricId === "weight" ? context.settings.weightUnit : definition.unitLabel,
        axisFormat: definition.axisFormat,
        valueFormat: definition.valueFormat,
        stat,
        statLabel: stat === "median" ? "中位数" : "均值",
        granularity,
        xAnchor: night ? "night" : "day",
        xDomain: [windowFrom, windowTo],
        yDomain: scale.domain,
        yTicks: scale.ticks,
        series,
        bands,
        zones: build.zones,
        lines: build.lines,
        target: build.target,
        coverage: coverageFor(metricId, keptRaw, context, windowRecords, granularity, rawBands.length),
        notes: fellBack
            ? [...build.notes, `窗口内数据只落在 1 个${granularity === "week" ? "月" : "周"}里，已自动改用按${granularity === "week" ? "周" : "日"}聚合；也可以手动切粒度看细节。`]
            : build.notes,
        pointCount: series.reduce((total, entry) => total + entry.points.length, 0),
        rawDayCount,
    };
}

/** 覆盖度按「过滤后真正参与绘制的原始天数」生成：窗口外的记录不算，被排除的昼夜类型也不算。 */
function coverageFor(
    metricId: TrendMetricId,
    keptRaw: Map<string, RawSeries["points"]>,
    context: TrendChartContext,
    windowRecords: number,
    granularity: TrendGranularity,
    bandNights: number,
): string {
    const days = (id: string) => new Set((keptRaw.get(id) ?? []).map((point) => point.anchor)).size;
    const first = keptRaw.keys().next().value as string | undefined;
    const granularityLabel = granularity === "day" ? "按日" : granularity === "week" ? "按周" : "按月";
    switch (metricId) {
        case "sleepWindow":
            return `熄灯时刻 ${days("off")}/${windowRecords} 晚 · 另有 ${bandNights} 晚只标「12 点后」 · ${granularityLabel}`;
        case "sleepDuration":
            return `手表 ${days("watch")}/${windowRecords} 晚 · 卧床跨度 ${days("span")} 晚 · ${granularityLabel}`;
        case "weight":
            return `${days("weight")}/${windowRecords} 天称重 · 单位 ${context.settings.weightUnit} · ${granularityLabel}`;
        case "protein":
        case "calories": {
            const dates = new Set((context.nutrition?.entries ?? []).map((entry) => entry.date));
            const perDay = dates.size ? Math.round((context.nutrition?.entries.length ?? 0) / dates.size) : 0;
            return `${first ? days(first) : 0} 天有记录 · 平均每天 ${perDay} 条 · ${granularityLabel}`;
        }
        default:
            return `${first ? days(first) : 0}/${windowRecords} 天 · ${granularityLabel}`;
    }
}

/** 竖带跟着粒度分桶：按日 = 一晚一条；按周/按月 = 一格一条，标签写明一共几晚。 */
function aggregateBands(raw: RawBand[], granularity: TrendGranularity): TrendBand[] {
    if (granularity === "day") {
        return raw
            .map((band) => ({ x: band.anchor, label: "熬夜", span: 1 }))
            .sort((left, right) => left.x - right.x);
    }
    const bins = new Map<number, number>();
    for (const band of raw) {
        const start = binStart(band.anchor, granularity);
        bins.set(start, (bins.get(start) ?? 0) + 1);
    }
    return [...bins.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([start, count]) => ({ x: start, label: `${count} 晚`, span: binEnd(start, granularity) - start + 1 }));
}

function countWindowDays(kept: RawSeries["points"], granularity: TrendGranularity, from: number, to: number): number {
    if (granularity === "day") return kept.length;
    const bins = new Set(kept.map((point) => binStart(point.anchor, granularity)));
    let total = 0;
    for (const bin of bins) total += Math.min(to, binEnd(bin, granularity)) - Math.max(from, bin) + 1;
    return total;
}

function binPoints(points: RawSeries["points"], granularity: TrendGranularity, stat: TrendStat, forceLow = false): TrendPoint[] {
    if (granularity === "day") {
        return points
            .slice()
            .sort((left, right) => left.anchor - right.anchor)
            .map((point) => ({
                x: point.anchor,
                y: Math.round(point.value * 100) / 100,
                count: 1,
                recordDate: point.recordDate,
                meta: point.meta,
                low: forceLow ? true : undefined,
            }));
    }
    const bins = new Map<number, RawSeries["points"]>();
    for (const point of points) {
        const start = binStart(point.anchor, granularity);
        const bucket = bins.get(start);
        if (bucket) bucket.push(point);
        else bins.set(start, [point]);
    }
    return [...bins.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([start, bucket]) => ({
            x: start,
            y: Math.round(mergeTrendStat(bucket.map((point) => point.value), stat) * 100) / 100,
            count: bucket.length,
            low: forceLow || bucket.length < 3 ? true : undefined,
            recordDate: bucket[bucket.length - 1].recordDate,
            meta: granularity === "week" ? `${bucket.length}/7 天` : `${bucket.length} 天`,
        }));
}

function scaleForMetric(metricId: TrendMetricId, context: TrendChartContext, build: MetricBuild, values: number[]): { domain: [number, number]; ticks: number[] } {
    if (build.yTicks.length && build.yDomain[1] > build.yDomain[0]) return { domain: build.yDomain, ticks: build.yTicks };
    const finite = values.filter((value) => Number.isFinite(value));
    if (!finite.length) return { domain: build.yDomain, ticks: build.yTicks };
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    switch (metricId) {
        case "weight": return niceTrendScale(min - 0.2, max + 0.2, 0.5);
        case "sleepDuration": return niceTrendScale(min - 0.5, max + 0.5, 1);
        case "closureDuration": return niceTrendScale(Math.min(0, min - 10), max + 10, 30, { zeroBased: true });
        case "protein": return niceTrendScale(0, Math.max(max + 10, context.nutrition?.goals.proteinGrams ?? 0), 40, { zeroBased: true });
        case "calories": return niceTrendScale(0, Math.max(max + 100, context.nutrition?.goals.caloriesKcal ?? 0), 500, { zeroBased: true });
        case "watchSleepScore": return niceTrendScale(Math.max(0, min - 5), Math.min(100, max + 5), 10);
        default: return niceTrendScale(min, max, 1);
    }
}

function metricBuild(metricId: TrendMetricId, context: TrendChartContext): MetricBuild {
    switch (metricId) {
        case "sleepWindow": {
            const series = sleepSeries(context);
            const offCount = series[0].points.length;
            const bandNights = context.records.filter((record) => !record.fields.lightsOffTime && record.fields.lightsOffBand === "after-midnight");
            const values = series.flatMap((entry) => entry.points.map((point) => point.value));
            const scale = clockDomain(values, 21, 38);
            return {
                series,
                bands: bandNights.map((record) => ({ anchor: trendDayIndex(record.date) - 1, dayType: record.dayType })),
                notes: [
                    "X = 夜晚所属日（晚上算当天、凌晨算前一天）：这一格 = 当天傍晚到次日早上的一整夜。晨起体重按记录日，比本图晚一格。",
                    "红色 = 24:00–05:00 熬夜危险区；绿色 = 06:00–08:00 起床目标。",
                    "只标「12 点后」没记具体时刻的那几晚画成红色竖带，不猜时间。",
                ],
                zones: [{ from: 21, to: 24, tone: "good" }, { from: 24, to: 29, tone: "bad" }, { from: 30, to: 32, tone: "good" }],
                lines: [{ y: 24, label: "熬夜界限 24:00", tone: "bad" }, { y: 30, label: "起床目标 06:00–08:00", tone: "good" }],
                target: null,
                yDomain: [Math.min(21, scale.domain[0]), Math.max(38, scale.domain[1])],
                yTicks: scale.ticks.filter((tick) => tick >= 20 && tick <= Math.max(38, scale.domain[1])),
                statDefault: "mean",
            };
        }
        case "sleepDuration": {
            const watch = simpleSeries(context, "watch", "手表实际睡眠", 0, (record) => fieldNumber(record, "sleepDurationMinutes") === null ? null : fieldNumber(record, "sleepDurationMinutes")! / 60, { anchor: "night" });
            const span = simpleSeries(context, "span", "卧床跨度（熄灯→起床）", 1, (record) => {
                if (!record.fields.wakeAt || !record.fields.lightsOffAt) return null;
                const hours = (Date.parse(record.fields.wakeAt) - Date.parse(record.fields.lightsOffAt)) / 3600000;
                return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 100) / 100 : null;
            }, { anchor: "night", ghost: true });
            return {
                series: [watch, span],
                bands: [],
                notes: ["手表睡眠是实际睡着的时间，卧床跨度是关灯到起床；两者差额 = 入睡潜伏 + 夜醒。"],
                zones: [],
                lines: [],
                target: null,
                yDomain: [0, 12],
                yTicks: [],
                statDefault: "mean",
            };
        }
        case "weight": {
            const unit = context.settings.weightUnit;
            const series = simpleSeries(context, "weight", "晨起体重", 0, (record) => fieldNumber(record, "morningWeight"), {
                transform: (value, record) => Math.round(convertWeight(value, record.fields.weightUnit, unit) * 100) / 100,
            });
            const targetKg = context.settings.weightTargetKg;
            const target = targetKg === null ? null : { y: Math.round(convertWeight(targetKg, "kg", unit) * 100) / 100, label: `目标 ${convertWeight(targetKg, "kg", unit).toFixed(1)} ${unit} · 点击可改` };
            const values = series.points.map((point) => point.value);
            const scale = niceTrendScale(Math.min(...values, target?.y ?? Number.POSITIVE_INFINITY) - 0.2, Math.max(...values, target?.y ?? 0) + 0.2, 0.5);
            return {
                series: [series],
                bands: [],
                notes: ["目标值在看图时就能改：点目标线上的数值 → 就地输入 → 立即重画。", "源数据若混用 kg/lb，先折算成当前显示单位再入线。"],
                zones: target ? [{ from: scale.domain[0], to: target.y, tone: "good" }] : [],
                lines: [],
                target,
                yDomain: scale.domain,
                yTicks: scale.ticks,
                statDefault: "mean",
            };
        }
        case "workBoundary": {
            const planned = simpleSeries(context, "planned", "计划下班", 2, (record) => record.fields.plannedWorkEndTime ? clockHours(record.fields.plannedWorkEndTime) : null, { ghost: true });
            const actual = simpleSeries(context, "actual", "实际下班", 0, (record) => record.fields.actualWorkEndTime ? clockHours(record.fields.actualWorkEndTime) : null);
            return {
                series: [actual, planned],
                bands: [],
                notes: ["绿区 16:00–17:00 是合适下班区间；早于 16:00 不涂色（不评判），晚于 17:00 落在区外。"],
                zones: [{ from: 16, to: 17, tone: "good" }],
                lines: [{ y: 17, label: "17:00 上限", tone: "bad" }, { y: 16, label: "16:00 起点", tone: "good" }],
                target: null,
                yDomain: [15, 19],
                yTicks: [15, 16, 17, 18, 19],
                statDefault: "mean",
            };
        }
        case "closureDuration": {
            const planned = simpleSeries(context, "planned", "计划闭环", 2, (record) => fieldNumber(record, "closurePlannedMinutes"), { ghost: true });
            const actual = simpleSeries(context, "actual", "实际闭环", 0, (record) => fieldNumber(record, "closureActualMinutes"));
            return {
                series: [actual, planned],
                bands: [],
                notes: ["绿区 0–30 分钟：清单里的建议上限；超过说明闭环变成了执行。"],
                zones: [{ from: 0, to: 30, tone: "good" }],
                lines: [{ y: 30, label: "30 分钟建议上限", tone: "good" }],
                target: null,
                yDomain: [0, 60],
                yTicks: [],
                statDefault: "mean",
            };
        }
        case "protein":
        case "calories": {
            const isProtein = metricId === "protein";
            const series = nutritionSeries(context, isProtein ? "protein" : "calories", isProtein ? "已记录蛋白质" : "已记录热量", (totals) => isProtein ? totals.proteinGrams : totals.caloriesKcal);
            const goal = isProtein ? context.nutrition?.goals.proteinGrams ?? null : context.nutrition?.goals.caloriesKcal ?? null;
            const entriesPerDay = context.nutrition ? Math.round(context.nutrition.entries.length / Math.max(1, new Set(context.nutrition.entries.map((entry) => entry.date)).size)) : 0;
            return {
                series: [series],
                bands: [],
                notes: [
                    "标签是「已记录」不是「每日摄入」：早+午自制餐可估计，晚餐在食堂故意不记。",
                    goal === null ? "还没有设置目标值，设置后会画目标线。" : `曲线与目标线之间的缺口 = 晚上还该补多少。`,
                ],
                zones: [],
                lines: goal === null ? [] : [{ y: goal, label: `目标 ${goal} ${isProtein ? "g" : "kcal"}`, tone: "good" }],
                target: null,
                yDomain: [0, isProtein ? 160 : 2000],
                yTicks: [],
                statDefault: "mean",
            };
        }
        case "watchSleepScore": {
            const series = simpleSeries(context, "watchScore", "手表睡眠评分", 0, (record) => record.fields.hasWatchSleepScore === "yes" ? fieldNumber(record, "watchSleepScore") : null);
            return { series: [series], bands: [], notes: ["0–100 分，不设红绿区，只看走势。"], zones: [], lines: [], target: null, yDomain: [0, 100], yTicks: [0, 20, 40, 60, 80, 100], statDefault: "mean" };
        }
        default: {
            const field = SCORE_FIELDS[metricId];
            const rubric = field ? DAILY_RUBRICS.find((entry) => entry.id === field) : undefined;
            const series = simpleSeries(context, metricId, trendMetricById(metricId).label, 0, (record) => (field ? fieldNumber(record, field as keyof DailyRecordFields) : null));
            const zones = rubric ? scoreZones(rubric.id) : { zones: [], lines: [] };
            return {
                series: [series],
                bands: [],
                notes: [trendMetricById(metricId).description],
                zones: zones.zones,
                lines: zones.lines,
                target: null,
                yDomain: SCORE_DOMAIN,
                yTicks: SCORE_TICKS,
                statDefault: "median",
            };
        }
    }
}

export type TrendSummary = {
    latest: number | null;
    latestDate: string;
    statValue: number | null;
    min: number | null;
    max: number | null;
    count: number;
    lowBins: number;
};

export function trendSummary(chart: TrendChartData): TrendSummary {
    const main = chart.series.find((series) => !series.ghost) ?? chart.series[0];
    const points = main ? main.points : [];
    const values = points.map((point) => point.y).filter((value) => Number.isFinite(value));
    return {
        latest: values.length ? values[values.length - 1] : null,
        latestDate: points.length ? points[points.length - 1].recordDate : "",
        statValue: values.length ? mergeTrendStat(values, chart.stat) : null,
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null,
        count: values.length,
        lowBins: points.filter((point) => point.low).length,
    };
}
