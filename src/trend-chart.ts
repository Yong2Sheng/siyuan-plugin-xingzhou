import type {
    TrendAxisFormat,
    TrendBand,
    TrendChartData,
    TrendGuideLine,
    TrendPoint,
    TrendSeries,
    TrendTone,
    TrendValueFormat,
} from "./trend-metrics";

/**
 * 趋势图「规格 → 几何」。
 *
 * 纯函数：给定图表数据与容器实测宽度，算出所有绘制坐标（刻度、区带、参考线、断线分段、点）。
 * 组件只负责把结果画成 SVG，测试直接在 jsdom 里断言这些坐标，不依赖任何布局引擎。
 */

export const TREND_PAD = { top: 12, right: 20, bottom: 24, left: 52 };

export type TrendRect = { x: number; y: number; w: number; h: number };
export type TrendTick = { value: number; position: number; label: string };
export type TrendZoneGeometry = TrendRect & { tone: TrendTone };
export type TrendLineGeometry = { y: number; label: string; tone: TrendTone };
export type TrendTargetGeometry = { y: number; label: string };
export type TrendBandGeometry = TrendRect & {
    label: string;
    /** 标签位置由几何层算好：画在数据点之上、带衬底、并自动避开数据点。 */
    labelX: number;
    labelY: number;
    labelW: number;
};
export type TrendDot = {
    x: number;
    y: number;
    radius: number;
    low: boolean;
    ghost: boolean;
    muted: boolean;
    recordDate: string;
    label: string;
};
export type TrendSeriesGeometry = {
    id: string;
    label: string;
    colorIndex: number;
    ghost: boolean;
    /** 按日期连续性分段后的 path，缺记录处断开。 */
    paths: string[];
    dots: TrendDot[];
    /** 被 dayType 过滤、仅置灰保留的点。 */
    excludedDots: TrendDot[];
};

export type TrendGeometry = {
    width: number;
    height: number;
    plot: TrendRect;
    yTicks: TrendTick[];
    xTicks: TrendTick[];
    zones: TrendZoneGeometry[];
    lines: TrendLineGeometry[];
    target: TrendTargetGeometry | null;
    bands: TrendBandGeometry[];
    series: TrendSeriesGeometry[];
};

export function trendChartHeight(width: number): number {
    return width < 520 ? 168 : 186;
}

function clockTickLabel(value: number): string {
    const hour = Math.round(value) % 24;
    return hour === 0 ? "24点(0点)" : `${hour}点`;
}

export function formatTrendTick(value: number, format: TrendAxisFormat): string {
    switch (format) {
        case "clock": return clockTickLabel(value);
        case "score": return String(Math.round(value));
        case "weight": return value.toFixed(1);
        case "hours": return `${value}h`;
        case "grams": return String(Math.round(value));
        case "kcal": return String(Math.round(value));
        default: return String(value);
    }
}

export function formatTrendValue(value: number | null, format: TrendValueFormat, unit = ""): string {
    if (value === null || !Number.isFinite(value)) return "—";
    switch (format) {
        case "clock": {
            const total = Math.round(value * 60);
            const hour = Math.floor(total / 60) % 24;
            const minute = total % 60;
            return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        }
        case "weight": return `${value.toFixed(2)} ${unit || "kg"}`;
        case "hours": {
            const hours = Math.floor(value);
            const minutes = Math.round((value - hours) * 60);
            return `${hours} 小时 ${String(minutes).padStart(2, "0")} 分`;
        }
        case "minutes": return `${Math.round(value)} 分钟`;
        case "score": return `${value} 分`;
        case "grams": return `${Math.round(value)} g`;
        case "kcal": return `${Math.round(value)} kcal`;
        default: return String(value);
    }
}

export function formatTrendDate(index: number, granularity: TrendChartData["granularity"]): string {
    const date = new Date(index * 86400000);
    if (granularity === "month") return `${date.getUTCMonth() + 1} 月`;
    return `${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
}

/** 日期刻度：从窗口起点按固定步长铺开，步长由实测宽度决定，避免窄屏文字重叠。 */
export function trendDateTicks(from: number, to: number, granularity: TrendChartData["granularity"], plotWidth: number): TrendTick[] {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
    const minLabel = granularity === "month" ? 56 : 46;
    const maxTicks = Math.max(2, Math.floor(plotWidth / minLabel));
    const ticks: TrendTick[] = [];
    if (granularity === "month") {
        const first = new Date(from * 86400000);
        let cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
        if (Math.round(cursor / 86400000) < from) cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
        const stepMonths = Math.max(1, Math.ceil(monthSpan(from, to) / maxTicks));
        for (let cursorIndex = Math.round(cursor / 86400000); cursorIndex <= to; ) {
            ticks.push({ value: cursorIndex, position: cursorIndex, label: formatTrendDate(cursorIndex, "month") });
            const date = new Date(cursorIndex * 86400000);
            cursorIndex = Math.round(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + stepMonths, 1) / 86400000);
        }
        return ticks;
    }
    const span = to - from + 1;
    const step = Math.max(1, Math.ceil(span / maxTicks));
    for (let index = from; index <= to; index += step) {
        ticks.push({ value: index, position: index, label: formatTrendDate(index, granularity) });
    }
    return ticks;
}

function monthSpan(from: number, to: number): number {
    const start = new Date(from * 86400000);
    const end = new Date(to * 86400000);
    return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()) + 1;
}

/** 折线分段：只在相邻日期（含分桶步长）之间连线；缺记录的日期断开，不画假直线。 */
export function trendSeriesPaths(points: TrendPoint[], x: (value: number) => number, y: (value: number) => number, step: number): string[] {
    const paths: string[] = [];
    let current: string[] = [];
    let previousX: number | null = null;
    for (const point of points) {
        if (!Number.isFinite(point.y)) continue;
        const px = x(point.x);
        const py = y(point.y);
        if (previousX !== null && point.x - previousX > step) {
            if (current.length) paths.push(current.join(" "));
            current = [];
        }
        current.push(`${current.length ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`);
        previousX = point.x;
    }
    if (current.length) paths.push(current.join(" "));
    return paths;
}

/** 竖带太密时不再逐个写标签，否则文字会互相压住；图例里已经有说明。 */
function shouldLabelBands(bands: TrendBand[], x: (value: number) => number): boolean {
    if (!bands.length) return false;
    if (bands.length === 1) return true;
    const positions = bands.map((band) => x(band.x));
    let minGap = Number.POSITIVE_INFINITY;
    for (let index = 1; index < positions.length; index += 1) {
        minGap = Math.min(minGap, positions[index] - positions[index - 1]);
    }
    return minGap >= 26;
}

function granularityStep(granularity: TrendChartData["granularity"]): number {
    if (granularity === "week") return 7;
    if (granularity === "month") return 32;
    return 1;
}

export function buildTrendGeometry(chart: TrendChartData, rawWidth: number, options: { height?: number; padLeft?: number } = {}): TrendGeometry {
    const width = Math.max(240, Math.round(rawWidth));
    const height = options.height ?? trendChartHeight(width);
    const padLeft = options.padLeft ?? (chart.axisFormat === "clock" ? 64 : TREND_PAD.left);
    const plot: TrendRect = {
        x: padLeft,
        y: TREND_PAD.top,
        w: Math.max(60, width - padLeft - TREND_PAD.right),
        h: Math.max(60, height - TREND_PAD.top - TREND_PAD.bottom),
    };
    const [x0, x1] = chart.xDomain;
    const [y0, y1] = chart.yDomain;
    const x = (value: number) => plot.x + (x1 === x0 ? plot.w / 2 : (value - x0) / (x1 - x0) * plot.w);
    const y = (value: number) => plot.y + plot.h - (value - y0) / (y1 - y0) * plot.h;
    const clampY = (value: number) => Math.min(plot.y + plot.h, Math.max(plot.y, y(value)));

    const yTicks: TrendTick[] = chart.yTicks.map((value) => ({ value, position: clampY(value), label: formatTrendTick(value, chart.axisFormat) }));
    const xTicks: TrendTick[] = trendDateTicks(x0, x1, chart.granularity, plot.w).map((tick) => ({ ...tick, position: x(tick.value) }));

    const zones: TrendZoneGeometry[] = chart.zones.map((zone: { from: number; to: number; tone: TrendTone }) => ({
        x: plot.x,
        y: clampY(zone.to),
        w: plot.w,
        h: Math.max(0, clampY(zone.from) - clampY(zone.to)),
        tone: zone.tone,
    }));
    const lines: TrendLineGeometry[] = chart.lines.map((line: TrendGuideLine) => ({ y: clampY(line.y), label: line.label, tone: line.tone }));
    const target = chart.target ? { y: clampY(chart.target.y), label: chart.target.label } : null;
    // 竖带宽度：按日是一晚的窄条；按周/按月要覆盖整格，否则聚合成一条后看不出跨了多久。
    const pixelsPerDay = plot.w / Math.max(1, x1 - x0);
    const bandLabelShown = shouldLabelBands(chart.bands, x);
    const bands: TrendBandGeometry[] = chart.bands.map((band: TrendBand) => {
        const bandWidth = band.span > 1
            ? Math.max(8, Math.min(72, band.span * pixelsPerDay * 0.7))
            : Math.max(8, Math.min(16, plot.w / 16));
        return {
            x: x(band.x) - bandWidth / 2,
            y: clampY(24),
            w: bandWidth,
            h: Math.max(6, plot.y + plot.h - clampY(24)),
            label: bandLabelShown ? band.label : "",
            labelX: x(band.x),
            labelY: clampY(24) + 11,
            labelW: estimateLabelWidth(band.label),
        };
    });

    const step = granularityStep(chart.granularity);
    const series: TrendSeriesGeometry[] = chart.series.map((entry: TrendSeries) => ({
        id: entry.id,
        label: entry.label,
        colorIndex: entry.colorIndex,
        ghost: Boolean(entry.ghost),
        paths: trendSeriesPaths(entry.points, x, y, step),
        dots: entry.points.map((point) => ({
            x: x(point.x),
            y: clampY(point.y),
            radius: point.low ? 3 : 2.6,
            low: Boolean(point.low),
            ghost: Boolean(entry.ghost),
            muted: false,
            recordDate: point.recordDate,
            label: `${formatTrendDate(point.x, chart.granularity)} · ${entry.label} ${formatTrendValue(point.y, chart.valueFormat, chart.unitLabel)}${point.meta ? `（${point.meta}）` : ""}`,
        })),
        excludedDots: entry.excluded.map((point) => ({
            x: x(point.x),
            y: clampY(point.y),
            radius: 2.6,
            low: false,
            ghost: Boolean(entry.ghost),
            muted: true,
            recordDate: point.recordDate,
            label: `${formatTrendDate(point.x, chart.granularity)} · 已排除 ${entry.label} ${formatTrendValue(point.y, chart.valueFormat, chart.unitLabel)}`,
        })),
    }));

    placeBandLabels(bands, series, plot);

    return { width, height, plot, yTicks, xTicks, zones, lines, target, bands, series };
}

/** 标签宽度估算（中文按 9px、其余按 5.5px，外加左右内边距），只用于避让计算。 */
function estimateLabelWidth(label: string): number {
    let width = 8;
    for (const char of label) width += /[\u4e00-\u9fa5]/.test(char) ? 9 : 5.5;
    return Math.round(width);
}

function boxesOverlap(
    left: { x: number; y: number; w: number; h: number },
    right: { x: number; y: number; w: number; h: number },
): boolean {
    return left.x < right.x + right.w && right.x < left.x + left.w && left.y < right.y + right.h && right.y < left.y + left.h;
}

/**
 * 竖带标签自动避让：默认贴在 24:00 线下方，但那一带正是熄灯数据点扎堆的地方，
 * 所以逐个试下方偏移，取第一个既不压数据点、也不压其它标签的位置。
 */
function placeBandLabels(bands: TrendBandGeometry[], series: TrendSeriesGeometry[], plot: TrendRect): void {
    const dots = series.flatMap((entry) => entry.dots.map((dot) => ({ x: dot.x - dot.radius - 3, y: dot.y - dot.radius - 3, w: dot.radius * 2 + 6, h: dot.radius * 2 + 6 })));
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    const minY = plot.y + 10;
    const maxY = plot.y + plot.h - 6;
    for (const band of bands) {
        if (!band.label) continue;
        const candidates = [band.labelY, band.labelY + 13, band.labelY + 26, band.labelY - 13, band.labelY + 39, band.labelY - 26];
        for (const candidate of candidates) {
            const y = Math.min(maxY, Math.max(minY, candidate));
            const box = { x: band.labelX - band.labelW / 2 - 2, y: y - 9, w: band.labelW + 4, h: 12 };
            if (dots.some((dot) => boxesOverlap(box, dot)) || placed.some((entry) => boxesOverlap(box, entry))) continue;
            band.labelY = y;
            placed.push(box);
            break;
        }
    }
}
