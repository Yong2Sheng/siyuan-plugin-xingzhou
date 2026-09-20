import { describe, expect, it } from "vitest";
import {
    createDailyRecord,
    createEmptyDailyStore,
    upsertDailyRecord,
    type DailyDayType,
    type DailyRecord,
    type DailyRecordFields,
} from "../src/daily-records";
import { createEmptyNutritionStore, type NutritionStore } from "../src/nutrition";
import {
    buildTrendChart,
    convertWeight,
    trendDayIndex,
    trendGranularityFor,
    trendNightValue,
    trendRangeWindow,
    trendSummary,
    type TrendChartContext,
    type TrendViewSettings,
} from "../src/trend-metrics";
import { defaultTrendViewState } from "../src/trend-view";

function record(date: string, overrides: Partial<DailyRecordFields> = {}, dayType: DailyDayType = "research-workday"): DailyRecord {
    const base = createDailyRecord(date, dayType, 1000);
    return { ...base, fields: { ...base.fields, ...overrides } };
}

/** 走真实保存路径（upsertDailyRecord）以便 resolveSleepDateTimes 生成 lightsOffAt / wakeAt。 */
function storeOf(...records: DailyRecord[]) {
    return records.reduce((store, entry) => upsertDailyRecord(store, entry, 1000), createEmptyDailyStore(1000));
}

function settings(overrides: Partial<TrendViewSettings> = {}): TrendViewSettings {
    // 默认范围固定为「全部」，让每个用例只关心自己那几天
    return { ...defaultTrendViewState(), range: "all", ...overrides };
}

function context(records: DailyRecord[], overrides: Partial<TrendViewSettings> = {}, nutrition: NutritionStore | null = null, today = "2026-09-18"): TrendChartContext {
    return { records: storeOf(...records).records, nutrition, settings: settings(overrides), today: trendDayIndex(today) };
}

describe("趋势指标：夜晚归日与 24 点记法", () => {
    it("凌晨熄灯算进前一天的夜晚，不跨列", () => {
        const ctx = context([record("2026-09-11", { lightsOffTime: "02:30", wakeTime: "10:30" })]);
        const chart = buildTrendChart("sleepWindow", ctx);
        const off = chart.series.find((series) => series.id === "off")!;
        expect(off.points).toHaveLength(1);
        expect(off.points[0].x).toBe(trendDayIndex("2026-09-10"));
        expect(off.points[0].y).toBe(26.5);
        expect(off.points[0].recordDate).toBe("2026-09-11");
    });

    it("起床时间按同一夜计算，13:10 也不会折返", () => {
        const ctx = context([record("2026-09-12", { lightsOffTime: "", wakeTime: "13:10", lightsOffBand: "after-midnight" }, "saturday-reset")]);
        const chart = buildTrendChart("sleepWindow", ctx);
        const wake = chart.series.find((series) => series.id === "wake")!;
        expect(wake.points[0].x).toBe(trendDayIndex("2026-09-11"));
        expect(wake.points[0].y).toBeCloseTo(37.17, 2);
    });

    it("23:30 与 00:30 在连续坐标里求平均得到 00:00，而不是 12:00", () => {
        expect(trendNightValue("2026-09-10T23:30", trendDayIndex("2026-09-10"))).toBeCloseTo(23.5, 5);
        expect(trendNightValue("2026-09-11T00:30", trendDayIndex("2026-09-10"))).toBeCloseTo(24.5, 5);
    });

    it("切到按月聚合时，逐夜竖带聚成一条并写明一共几晚", () => {
        const records = [
            record("2026-09-05", { lightsOffTime: "", lightsOffBand: "after-midnight" }, "saturday-reset"),
            record("2026-09-06", { lightsOffTime: "", lightsOffBand: "after-midnight" }),
            record("2026-09-09", { lightsOffTime: "", lightsOffBand: "after-midnight" }),
            record("2026-09-10", { lightsOffTime: "", lightsOffBand: "after-midnight" }),
            record("2026-09-12", { lightsOffTime: "", lightsOffBand: "after-midnight" }, "saturday-reset"),
            record("2026-09-15", { lightsOffTime: "23:14", wakeTime: "08:30" }),
        ];
        const chart = buildTrendChart("sleepWindow", context(records, { range: "custom", customFrom: "2026-09-01", customTo: "2026-09-30", granularity: "month" }));
        expect(chart.granularity).toBe("month");
        expect(chart.bands).toHaveLength(1);
        expect(chart.bands[0].x).toBe(trendDayIndex("2026-09-01"));
        expect(chart.bands[0].label).toBe("5 晚");
        expect(chart.bands[0].span).toBe(30);
    });

    it("按周聚合成一条时只算这一周里的夜晚", () => {
        const records = [
            record("2026-09-08", { lightsOffTime: "", lightsOffBand: "after-midnight" }),
            record("2026-09-09", { lightsOffTime: "", lightsOffBand: "after-midnight" }),
            record("2026-09-15", { lightsOffTime: "", lightsOffBand: "after-midnight" }),
        ];
        const chart = buildTrendChart("sleepWindow", context(records, { range: "custom", customFrom: "2026-09-01", customTo: "2026-09-30", granularity: "week" }));
        expect(chart.bands.map((band) => [band.x, band.label])).toEqual([
            [trendDayIndex("2026-09-07"), "2 晚"],
            [trendDayIndex("2026-09-14"), "1 晚"],
        ]);
    });

    it("被排除的昼夜类型连竖带一起排除", () => {
        const records = [
            record("2026-09-12", { lightsOffTime: "", lightsOffBand: "after-midnight" }, "saturday-reset"),
            record("2026-09-15", { lightsOffTime: "", lightsOffBand: "after-midnight" }),
        ];
        const filtered = buildTrendChart("sleepWindow", context(records, { range: "all", excludedDayTypes: ["saturday-reset"] }));
        expect(filtered.bands).toHaveLength(1);
        expect(filtered.bands[0].x).toBe(trendDayIndex("2026-09-14"));
        expect(filtered.coverage).toContain("另有 1 晚只标「12 点后」");
    });

    it("只标了「12 点后」没记时刻的晚上给出红色竖带，不猜时间", () => {
        const ctx = context([record("2026-09-12", { lightsOffTime: "", lightsOffBand: "after-midnight" }, "saturday-reset")]);
        const chart = buildTrendChart("sleepWindow", ctx);
        expect(chart.series.find((series) => series.id === "off")!.points).toHaveLength(0);
        expect(chart.bands).toEqual([{ x: trendDayIndex("2026-09-11"), label: "熬夜", span: 1 }]);
    });
});

describe("趋势指标：计划熄灯与实际熄灯配对", () => {
    it("计划来自前一条记录，与实际熄灯落在同一夜", () => {
        const records = [
            record("2026-09-10", { plannedLightsOffTime: "01:00" }),
            record("2026-09-11", { lightsOffTime: "01:00", wakeTime: "07:07" }),
        ];
        const chart = buildTrendChart("sleepWindow", context(records));
        const night = trendDayIndex("2026-09-10");
        const plan = chart.series.find((series) => series.id === "plan")!.points;
        const off = chart.series.find((series) => series.id === "off")!.points;
        expect(plan).toHaveLength(1);
        expect(plan[0].x).toBe(night);
        expect(plan[0].y).toBe(25);
        expect(off[0].x).toBe(night);
        expect(off[0].y).toBe(25);
    });

    it("当天傍晚的计划归今天那一夜，而不是昨天", () => {
        const chart = buildTrendChart("sleepWindow", context([record("2026-09-10", { plannedLightsOffTime: "23:00" })]));
        const plan = chart.series.find((series) => series.id === "plan")!.points;
        expect(plan[0].x).toBe(trendDayIndex("2026-09-10"));
        expect(plan[0].y).toBe(23);
    });
});

describe("趋势指标：区间与聚合", () => {
    it("本周按周一到周日取窗口", () => {
        const [from, to] = trendRangeWindow(settings({ range: "this-week" }), trendDayIndex("2026-09-18"), []);
        expect(from).toBe(trendDayIndex("2026-09-14"));
        expect(to).toBe(trendDayIndex("2026-09-20"));
    });

    it("粒度自动切换：45 天内按日、半年内按周、更长按月", () => {
        expect(trendGranularityFor(0, 30, "auto")).toBe("day");
        expect(trendGranularityFor(0, 120, "auto")).toBe("week");
        expect(trendGranularityFor(0, 400, "auto")).toBe("month");
        expect(trendGranularityFor(0, 400, "day")).toBe("day");
    });

    it("按周聚合取窗口内每日原值的均值，缺失日不参与分母", () => {
        const records = [
            record("2026-09-07", { daytimeEnergy: 4 }),
            record("2026-09-08", { daytimeEnergy: 2 }),
            record("2026-09-10", { daytimeEnergy: 3 }),
        ];
        const chart = buildTrendChart("energy", context(records, { range: "custom", customFrom: "2026-09-07", customTo: "2026-09-13", granularity: "week" }));
        expect(chart.granularity).toBe("week");
        expect(chart.series[0].points).toHaveLength(1);
        expect(chart.series[0].points[0].y).toBe(3);
        expect(chart.series[0].points[0].count).toBe(3);
        expect(chart.series[0].points[0].low).toBeUndefined();
    });

    it("桶内样本少于 3 天标成空心点，不冒充周平均", () => {
        const records = [record("2026-09-07", { daytimeEnergy: 4 }), record("2026-09-08", { daytimeEnergy: 2 })];
        const chart = buildTrendChart("energy", context(records, { range: "custom", customFrom: "2026-09-07", customTo: "2026-09-13", granularity: "week" }));
        expect(chart.series[0].points[0].low).toBe(true);
    });

    it("中位数统计与均值可切换，评分默认中位数", () => {
        const records = [record("2026-09-07", { daytimeEnergy: 5 }), record("2026-09-08", { daytimeEnergy: 1 }), record("2026-09-09", { daytimeEnergy: 2 })];
        const auto = buildTrendChart("energy", context(records, { range: "custom", customFrom: "2026-09-07", customTo: "2026-09-13", granularity: "week" }));
        expect(auto.stat).toBe("median");
        expect(auto.series[0].points[0].y).toBe(2);
        const mean = buildTrendChart("energy", context(records, { range: "custom", customFrom: "2026-09-07", customTo: "2026-09-13", granularity: "week", stat: "mean" }));
        expect(mean.series[0].points[0].y).toBeCloseTo(2.67, 2);
    });

    it("自动粒度遇到「数据只落在少数几格」时逐级退回，不把一个月压成一个点", () => {
        // 数据跨三周：按月只有 1 个非空桶 → 退回按周（3 个桶）
        const spread = [
            record("2026-09-03", { hasMorningWeight: "yes", morningWeight: 66.4 }),
            record("2026-09-08", { hasMorningWeight: "yes", morningWeight: 66.1 }),
            record("2026-09-15", { hasMorningWeight: "yes", morningWeight: 65.8 }),
        ];
        const weekly = buildTrendChart("weight", context(spread, { range: "this-year" }));
        expect(weekly.granularity).toBe("week");
        expect(weekly.pointCount).toBe(3);
        expect(weekly.rawDayCount).toBe(3);
        expect(weekly.notes.join(" ")).toContain("已自动改用按周聚合");

        // 数据全在同一周：退回按日
        const tight = [
            record("2026-09-15", { hasMorningWeight: "yes", morningWeight: 66.4 }),
            record("2026-09-16", { hasMorningWeight: "yes", morningWeight: 66.1 }),
            record("2026-09-17", { hasMorningWeight: "yes", morningWeight: 65.8 }),
        ];
        const daily = buildTrendChart("weight", context(tight, { range: "this-year" }));
        expect(daily.granularity).toBe("day");
        expect(daily.pointCount).toBe(3);
    });

    it("显式选定的粒度不自动退回，并如实报告原始天数", () => {
        const records = [
            record("2026-09-15", { hasMorningWeight: "yes", morningWeight: 66.4 }),
            record("2026-09-16", { hasMorningWeight: "yes", morningWeight: 66.1 }),
            record("2026-09-17", { hasMorningWeight: "yes", morningWeight: 65.8 }),
        ];
        const chart = buildTrendChart("weight", context(records, { range: "this-year", granularity: "month" }));
        expect(chart.granularity).toBe("month");
        expect(chart.pointCount).toBe(1);
        expect(chart.rawDayCount).toBe(3);
        expect(chart.notes.join(" ")).not.toContain("已自动改用");
    });

    it("窗口外的记录不参与", () => {
        const records = [record("2026-09-01", { daytimeEnergy: 5 }), record("2026-09-15", { daytimeEnergy: 3 })];
        const chart = buildTrendChart("energy", context(records, { range: "custom", customFrom: "2026-09-14", customTo: "2026-09-20" }));
        expect(chart.series[0].points).toHaveLength(1);
        expect(chart.series[0].points[0].x).toBe(trendDayIndex("2026-09-15"));
    });
});

describe("趋势指标：评分区带跟着评分口径", () => {
    it("损耗性压力：3 分界，下绿上红", () => {
        const chart = buildTrendChart("depletingStress", context([record("2026-09-15", { depletingStress: 4 })]));
        expect(chart.zones).toEqual([
            { from: 0.6, to: 3, tone: "good" },
            { from: 3, to: 5.4, tone: "bad" },
        ]);
        expect(chart.lines[0].y).toBe(3);
    });

    it("促进性压力：3–4 是绿色区间，两侧都不是达标方向", () => {
        const chart = buildTrendChart("promotingStress", context([record("2026-09-15", { promotingStress: 3 })]));
        expect(chart.zones).toEqual([
            { from: 0.6, to: 3, tone: "bad" },
            { from: 3, to: 4, tone: "good" },
            { from: 4, to: 5.4, tone: "bad" },
        ]);
    });

    it("精力/效率/睡眠质量：4–5 绿、3 灰、1–2 红", () => {
        const chart = buildTrendChart("energy", context([record("2026-09-15", { daytimeEnergy: 2 })]));
        expect(chart.zones).toEqual([
            { from: 0.6, to: 3, tone: "bad" },
            { from: 3, to: 4, tone: "neutral" },
            { from: 4, to: 5.4, tone: "good" },
        ]);
        expect(chart.lines[0].label).toContain("≥4");
    });
});

describe("趋势指标：体重与单位", () => {
    it("lb 记录按显示单位折算后再入线", () => {
        const records = [record("2026-09-15", { hasMorningWeight: "yes", morningWeight: 145, weightUnit: "lb" })];
        const kg = buildTrendChart("weight", context(records, { weightUnit: "kg" }));
        expect(kg.series[0].points[0].y).toBeCloseTo(65.77, 2);
        const lb = buildTrendChart("weight", context(records, { weightUnit: "lb" }));
        expect(lb.series[0].points[0].y).toBe(145);
        expect(lb.unitLabel).toBe("lb");
    });

    it("目标值按公斤保存、按显示单位画线，并可清除", () => {
        const records = [record("2026-09-15", { hasMorningWeight: "yes", morningWeight: 66, weightUnit: "kg" })];
        const withTarget = buildTrendChart("weight", context(records, { weightUnit: "lb", weightTargetKg: 65 }));
        expect(withTarget.target!.y).toBeCloseTo(143.3, 1);
        const withoutTarget = buildTrendChart("weight", context(records, { weightTargetKg: null }));
        expect(withoutTarget.target).toBeNull();
        expect(withoutTarget.zones).toEqual([]);
    });

    it("公斤与磅互转是往返一致的", () => {
        expect(convertWeight(convertWeight(66.5, "kg", "lb"), "lb", "kg")).toBeCloseTo(66.5, 6);
    });
});

describe("趋势指标：数据筛选与覆盖度", () => {
    it("排除的昼夜类型默认不参与，开启置灰时保留为空心点", () => {
        const records = [
            record("2026-09-12", { daytimeEnergy: 5 }, "saturday-reset"),
            record("2026-09-15", { daytimeEnergy: 3 }),
        ];
        const ghosted = buildTrendChart("energy", context(records, { range: "all", ghostExcluded: true, excludedDayTypes: ["saturday-reset"] }));
        expect(ghosted.series[0].points.map((point) => point.x)).toEqual([trendDayIndex("2026-09-15")]);
        expect(ghosted.series[0].excluded.map((point) => point.x)).toEqual([trendDayIndex("2026-09-12")]);
        const hidden = buildTrendChart("energy", context(records, { range: "all", ghostExcluded: false, excludedDayTypes: ["saturday-reset"] }));
        expect(hidden.series[0].excluded).toEqual([]);
    });

    it("点太少时报告覆盖度与点数，界面据此走空状态", () => {
        const chart = buildTrendChart("weight", context([record("2026-09-15", { hasMorningWeight: "yes", morningWeight: 66 })]));
        expect(chart.pointCount).toBe(1);
        expect(chart.coverage).toContain("1/1 天称重");
        const summary = trendSummary(chart);
        expect(summary.count).toBe(1);
        expect(summary.latest).toBe(66);
    });

    it("摘要给出最近值、均值/中位数、最低最高", () => {
        const records = [
            record("2026-09-14", { hasMorningWeight: "yes", morningWeight: 66.4 }),
            record("2026-09-15", { hasMorningWeight: "yes", morningWeight: 65.6 }),
            record("2026-09-16", { hasMorningWeight: "yes", morningWeight: 66 }),
        ];
        const summary = trendSummary(buildTrendChart("weight", context(records, { range: "all" })));
        expect(summary.latest).toBe(66);
        expect(summary.min).toBe(65.6);
        expect(summary.max).toBe(66.4);
        expect(summary.statValue).toBeCloseTo(66, 2);
    });
});

describe("趋势指标：营养口径", () => {
    it("已记录摄入只统计记录到的部分，并显示目标线", () => {
        const nutrition = createEmptyNutritionStore(1000);
        nutrition.goals.proteinGrams = 140;
        const template = {
            id: "t1", name: "蒸蛋", baseAmount: 1, unit: "份", createdAt: 1000, updatedAt: 1000,
            values: { caloriesKcal: 100, proteinGrams: 12, carbsGrams: 1, fatGrams: 7 },
        };
        nutrition.templates.push(template);
        nutrition.entries.push(
            { id: "e1", date: "2026-09-15", templateId: "t1", nameSnapshot: "蒸蛋", baseAmountSnapshot: 1, unitSnapshot: "份", valuesPerServing: { ...template.values }, consumedAmount: 2, createdAt: 1000, updatedAt: 1000 },
            { id: "e2", date: "2026-09-16", templateId: "t1", nameSnapshot: "蒸蛋", baseAmountSnapshot: 1, unitSnapshot: "份", valuesPerServing: { ...template.values }, consumedAmount: 1, createdAt: 1000, updatedAt: 1000 },
        );
        const chart = buildTrendChart("protein", context([record("2026-09-15", {}), record("2026-09-16", {})], { range: "all" }, nutrition));
        expect(chart.series[0].points.map((point) => point.y)).toEqual([24, 12]);
        expect(chart.lines[0]).toEqual({ y: 140, label: "目标 140 g", tone: "good" });
        expect(chart.coverage).toContain("2 天有记录");
    });

    it("没有目标值时不给目标线", () => {
        const nutrition = createEmptyNutritionStore(1000);
        const chart = buildTrendChart("protein", context([record("2026-09-15", {})], { range: "all" }, nutrition));
        expect(chart.lines).toEqual([]);
    });
});
