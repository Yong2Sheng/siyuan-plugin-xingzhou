import { describe, expect, it } from "vitest";
import {
    buildTrendGeometry,
    formatTrendTick,
    formatTrendValue,
    trendDateTicks,
    trendSeriesPaths,
} from "../src/trend-chart";
import {
    buildTrendChart,
    trendDayIndex,
    type TrendChartData,
    type TrendPoint,
} from "../src/trend-metrics";
import { createDailyRecord, createEmptyDailyStore, upsertDailyRecord, type DailyDayType, type DailyRecord, type DailyRecordFields } from "../src/daily-records";
import { defaultTrendViewState } from "../src/trend-view";

function record(date: string, overrides: Partial<DailyRecordFields> = {}, dayType: DailyDayType = "research-workday"): DailyRecord {
    const base = createDailyRecord(date, dayType, 1000);
    return { ...base, fields: { ...base.fields, ...overrides } };
}

function chartOf(metricId: Parameters<typeof buildTrendChart>[0], records: DailyRecord[], today = "2026-09-18"): TrendChartData {
    const store = records.reduce((current, entry) => upsertDailyRecord(current, entry, 1000), createEmptyDailyStore(1000));
    return buildTrendChart(metricId, {
        records: store.records,
        nutrition: null,
        settings: { ...defaultTrendViewState(), range: "all" },
        today: trendDayIndex(today),
    });
}

function point(x: number, y: number): TrendPoint {
    return { x, y, count: 1, recordDate: "2026-09-15" };
}

describe("趋势图：数值与刻度格式", () => {
    it("时轴用 24 点记法显示，午夜标成 24点(0点)", () => {
        expect(formatTrendTick(22, "clock")).toBe("22点");
        expect(formatTrendTick(24, "clock")).toBe("24点(0点)");
        expect(formatTrendTick(25, "clock")).toBe("1点");
        expect(formatTrendTick(36, "clock")).toBe("12点");
    });

    it("读数格式覆盖时刻、时长、体重、评分与分钟", () => {
        expect(formatTrendValue(26.5, "clock")).toBe("02:30");
        expect(formatTrendValue(23.5, "clock")).toBe("23:30");
        expect(formatTrendValue(5.9667, "hours")).toBe("5 小时 58 分");
        expect(formatTrendValue(65.766, "weight", "kg")).toBe("65.77 kg");
        expect(formatTrendValue(143.3, "weight", "lb")).toBe("143.30 lb");
        expect(formatTrendValue(3, "score")).toBe("3 分");
        expect(formatTrendValue(120, "minutes")).toBe("120 分钟");
        expect(formatTrendValue(null, "score")).toBe("—");
    });

    it("日期刻度密度跟着实测宽度走，窄屏不会挤成一团", () => {
        const from = trendDayIndex("2026-09-03");
        const to = trendDayIndex("2026-09-18");
        const wide = trendDateTicks(from, to, "day", 1200);
        const narrow = trendDateTicks(from, to, "day", 300);
        expect(wide.length).toBeGreaterThan(narrow.length);
        expect(wide[0].label).toBe("9-3");
        expect(narrow.every((tick) => tick.position >= 0)).toBe(true);
    });
});

describe("趋势图：折线分段", () => {
    it("相邻日期连成一条线", () => {
        const paths = trendSeriesPaths([point(100, 1), point(101, 2), point(102, 3)], (value) => value, (value) => value, 1);
        expect(paths).toHaveLength(1);
        expect(paths[0].startsWith("M100.0,1.0")).toBe(true);
    });

    it("缺记录的日期断开，不画假直线", () => {
        const paths = trendSeriesPaths([point(100, 1), point(101, 2), point(104, 3), point(105, 4)], (value) => value, (value) => value, 1);
        expect(paths).toHaveLength(2);
    });

    it("按周聚合时相邻的桶仍然连线（步长 7 天）", () => {
        const paths = trendSeriesPaths([point(100, 1), point(107, 2), point(121, 3)], (value) => value, (value) => value, 7);
        expect(paths).toHaveLength(2);
    });
});

describe("趋势图：几何", () => {
    it("刻度、区带、参考线与点都落在绘图区内", () => {
        const chart = chartOf("sleepWindow", [
            record("2026-09-15", { lightsOffTime: "01:00", wakeTime: "07:07", plannedLightsOffTime: "23:00" }),
            record("2026-09-16", { lightsOffTime: "23:14", wakeTime: "08:30" }),
        ]);
        const geometry = buildTrendGeometry(chart, 900);
        const bottom = geometry.plot.y + geometry.plot.h;
        expect(geometry.plot.y).toBeGreaterThan(0);
        expect(geometry.plot.x + geometry.plot.w).toBeLessThanOrEqual(geometry.width);
        for (const tick of geometry.yTicks) {
            expect(tick.position).toBeGreaterThanOrEqual(geometry.plot.y - 0.001);
            expect(tick.position).toBeLessThanOrEqual(bottom + 0.001);
        }
        for (const zone of geometry.zones) {
            expect(zone.y).toBeGreaterThanOrEqual(geometry.plot.y - 0.001);
            expect(zone.y + zone.h).toBeLessThanOrEqual(bottom + 0.001);
        }
        for (const line of geometry.lines) {
            expect(line.y).toBeGreaterThanOrEqual(geometry.plot.y - 0.001);
            expect(line.y).toBeLessThanOrEqual(bottom + 0.001);
        }
        for (const series of geometry.series) {
            for (const dot of series.dots) {
                expect(dot.y).toBeGreaterThanOrEqual(geometry.plot.y - 0.001);
                expect(dot.y).toBeLessThanOrEqual(bottom + 0.001);
            }
        }
    });

    it("刻度值越大越靠上：屏幕坐标随数值增大而减小", () => {
        const chart = chartOf("energy", [record("2026-09-15", { daytimeEnergy: 4 })]);
        const geometry = buildTrendGeometry(chart, 800);
        expect(geometry.yTicks.map((tick) => tick.value)).toEqual([1, 2, 3, 4, 5]);
        const positions = geometry.yTicks.map((tick) => tick.position);
        for (let index = 1; index < positions.length; index += 1) {
            expect(positions[index]).toBeLessThan(positions[index - 1]);
        }
    });

    it("熬夜竖带贴在 24:00 线下方，宽度固定不随窗口缩放变形", () => {
        const chart = chartOf("sleepWindow", [
            record("2026-09-15", { lightsOffTime: "", lightsOffBand: "after-midnight" }),
            record("2026-09-16", { lightsOffTime: "23:14", wakeTime: "08:30" }),
        ]);
        const geometry = buildTrendGeometry(chart, 900);
        const narrow = buildTrendGeometry(chart, 420);
        expect(geometry.bands).toHaveLength(1);
        const line24 = geometry.lines.find((line) => line.label.includes("24:00"))!;
        expect(geometry.bands[0].y).toBeCloseTo(line24.y, 3);
        expect(geometry.bands[0].h).toBeGreaterThan(6);
        expect(narrow.bands[0].w).toBeLessThanOrEqual(16);
    });

    it("聚合成一格后竖带跟着变宽，密集时不再逐条写标签", () => {
        const records = [
            record("2026-09-04", { lightsOffTime: "", lightsOffBand: "after-midnight" }, "saturday-reset"),
            record("2026-09-08", { lightsOffTime: "", lightsOffBand: "after-midnight" }),
            record("2026-09-09", { lightsOffTime: "", lightsOffBand: "after-midnight" }),
            record("2026-09-11", { lightsOffTime: "23:14", wakeTime: "08:30" }),
        ];
        const store = records.reduce((current, entry) => upsertDailyRecord(current, entry, 1000), createEmptyDailyStore(1000));
        const monthChart = buildTrendChart("sleepWindow", {
            records: store.records,
            nutrition: null,
            settings: { ...defaultTrendViewState(), range: "custom", customFrom: "2026-09-01", customTo: "2026-09-30", granularity: "month" },
            today: trendDayIndex("2026-09-18"),
        });
        const dayChart = buildTrendChart("sleepWindow", {
            records: store.records,
            nutrition: null,
            settings: { ...defaultTrendViewState(), range: "custom", customFrom: "2026-09-01", customTo: "2026-09-30", granularity: "day" },
            today: trendDayIndex("2026-09-18"),
        });
        const monthBand = buildTrendGeometry(monthChart, 900).bands[0];
        const dayBands = buildTrendGeometry(dayChart, 900).bands;
        expect(monthChart.bands[0].label).toBe("3 晚");
        expect(monthBand.w).toBeGreaterThan(dayBands[0].w);
        expect(monthBand.label).toBe("3 晚");
        expect(dayBands).toHaveLength(3);
    });

    it("竖带标签不会压在数据点上：同一格里 23:59 的聚合点会自动避让", () => {
        // 三条 23:59 的熄灯落在同一周（周起点 09-07），09-11 那一夜只标了「12 点后」→ 同格同 x
        const records = [
            record("2026-09-09", { lightsOffTime: "23:59", wakeTime: "07:10" }),
            record("2026-09-10", { lightsOffTime: "23:59", wakeTime: "09:30" }),
            record("2026-09-12", { lightsOffTime: "", lightsOffBand: "after-midnight" }, "saturday-reset"),
        ];
        const store = records.reduce((current, entry) => upsertDailyRecord(current, entry, 1000), createEmptyDailyStore(1000));
        const chart = buildTrendChart("sleepWindow", {
            records: store.records,
            nutrition: null,
            settings: { ...defaultTrendViewState(), range: "custom", customFrom: "2026-09-01", customTo: "2026-09-30", granularity: "week" },
            today: trendDayIndex("2026-09-18"),
        });
        const geometry = buildTrendGeometry(chart, 900);
        const band = geometry.bands[0];
        expect(band.label).toBe("1 晚");
        const dots = geometry.series.flatMap((series) => series.dots);
        // 场景成立：确实有数据点和竖带在同一列上
        expect(dots.filter((dot) => Math.abs(dot.x - band.labelX) < 1).length).toBeGreaterThan(0);
        const labelBox = { x: band.labelX - band.labelW / 2, y: band.labelY - 9, w: band.labelW, h: 12 };
        for (const dot of dots) {
            const dotBox = { x: dot.x - dot.radius - 3, y: dot.y - dot.radius - 3, w: dot.radius * 2 + 6, h: dot.radius * 2 + 6 };
            const overlaps = labelBox.x < dotBox.x + dotBox.w && dotBox.x < labelBox.x + labelBox.w
                && labelBox.y < dotBox.y + dotBox.h && dotBox.y < labelBox.y + labelBox.h;
            expect(overlaps).toBe(false);
        }
    });

    it("低样本点画成空心（半径、标记与图例一致）", () => {
        const records = [record("2026-09-15", { daytimeEnergy: 4 }), record("2026-09-16", { daytimeEnergy: 2 })];
        const store = records.reduce((current, entry) => upsertDailyRecord(current, entry, 1000), createEmptyDailyStore(1000));
        const chart = buildTrendChart("energy", {
            records: store.records,
            nutrition: null,
            settings: { ...defaultTrendViewState(), range: "custom", customFrom: "2026-09-14", customTo: "2026-09-20", granularity: "week" },
            today: trendDayIndex("2026-09-18"),
        });
        const geometry = buildTrendGeometry(chart, 800);
        expect(geometry.series[0].dots[0].low).toBe(true);
        expect(geometry.series[0].dots[0].radius).toBe(3);
        expect(geometry.series[0].dots[0].label).toContain("2/7 天");
    });

    it("窄屏用更短的左边距给时刻刻度让位", () => {
        const chart = chartOf("sleepWindow", [record("2026-09-15", { lightsOffTime: "23:14", wakeTime: "08:30" })]);
        const clock = buildTrendGeometry(chart, 900);
        const score = buildTrendGeometry(chartOf("energy", [record("2026-09-15", { daytimeEnergy: 3 })]), 900);
        expect(clock.plot.x).toBeGreaterThan(score.plot.x);
    });
});
