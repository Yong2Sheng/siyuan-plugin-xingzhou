import { describe, expect, it } from "vitest";
import {
    cloneTrendViewState,
    defaultTrendViewState,
    parseTrendViewFile,
    parseTrendViewState,
    toggleTrendMetric,
    TREND_DAY_TYPE_PRESETS,
    trendDayTypePreset,
    trendRangeLabel,
    withTrendDayTypePreset,
    withWeightUnit,
    wrapTrendViewFile,
} from "../src/trend-view";
import { TREND_METRICS } from "../src/trend-metrics";

describe("趋势设置：默认值", () => {
    it("默认三张图、本周、自动粒度、自动统计、65 kg 目标", () => {
        const state = defaultTrendViewState();
        expect(state.metricIds).toEqual(["sleepWindow", "weight", "energy"]);
        expect(state.range).toBe("this-week");
        expect(state.granularity).toBe("auto");
        expect(state.stat).toBe("auto");
        expect(state.excludedDayTypes).toEqual([]);
        expect(state.ghostExcluded).toBe(true);
        expect(state.weightUnit).toBe("kg");
        expect(state.weightTargetKg).toBe(65);
    });

    it("默认勾选的指标就是注册表里标了 defaultChecked 的那些", () => {
        expect(defaultTrendViewState().metricIds).toEqual(TREND_METRICS.filter((metric) => metric.defaultChecked).map((metric) => metric.id));
    });
});

describe("趋势设置：落盘与解析", () => {
    it("包装结构往返一致", () => {
        const state = { ...defaultTrendViewState(), metricIds: ["weight", "protein"] as const, range: "90d" as const, weightUnit: "lb" as const };
        const file = wrapTrendViewFile({ ...state, metricIds: [...state.metricIds] });
        expect(file.version).toBe(1);
        expect(parseTrendViewFile(file)).toEqual({ ...state, metricIds: [...state.metricIds] });
    });

    it("裸对象、JSON 字符串、空值都能处理", () => {
        const bare = { ...defaultTrendViewState(), range: "all" };
        expect(parseTrendViewFile(bare)?.range).toBe("all");
        expect(parseTrendViewFile(JSON.stringify(bare))?.range).toBe("all");
        expect(parseTrendViewFile(null)).toBeNull();
        expect(parseTrendViewFile("")).toBeNull();
        expect(parseTrendViewFile("{坏掉的 json")).toBeNull();
        expect(parseTrendViewFile(42)).toBeNull();
    });

    it("未知指标 id 被丢弃，全部未知时回落默认三张", () => {
        expect(parseTrendViewState({ metricIds: ["weight", "不存在", "protein"] })?.metricIds).toEqual(["weight", "protein"]);
        expect(parseTrendViewState({ metricIds: ["不存在"] })?.metricIds).toEqual(["sleepWindow", "weight", "energy"]);
        expect(parseTrendViewState({ metricIds: [] })?.metricIds).toEqual(["sleepWindow", "weight", "energy"]);
        expect(parseTrendViewState({ metricIds: "weight" })?.metricIds).toEqual(["sleepWindow", "weight", "energy"]);
    });

    it("非法字段逐项回落，不整份丢弃", () => {
        const parsed = parseTrendViewState({
            metricIds: ["energy"],
            range: "上一世纪",
            granularity: "每半小时",
            stat: "众数",
            weightUnit: "斤",
            excludedDayTypes: ["holiday", "不存在的类型"],
            customFrom: "2026-13-45",
            customTo: "2026-09-18",
            ghostExcluded: false,
        })!;
        expect(parsed.metricIds).toEqual(["energy"]);
        expect(parsed.range).toBe("this-week");
        expect(parsed.granularity).toBe("auto");
        expect(parsed.stat).toBe("auto");
        expect(parsed.weightUnit).toBe("kg");
        expect(parsed.excludedDayTypes).toEqual(["holiday"]);
        expect(parsed.customFrom).toBe("");
        expect(parsed.customTo).toBe("2026-09-18");
        expect(parsed.ghostExcluded).toBe(false);
    });

    it("体重目标只接受合理正数，null 表示不画目标线", () => {
        expect(parseTrendViewState({ weightTargetKg: null })?.weightTargetKg).toBeNull();
        expect(parseTrendViewState({ weightTargetKg: 65.432 })?.weightTargetKg).toBe(65.43);
        expect(parseTrendViewState({ weightTargetKg: 0 })?.weightTargetKg).toBe(65);
        expect(parseTrendViewState({ weightTargetKg: -3 })?.weightTargetKg).toBe(65);
        expect(parseTrendViewState({ weightTargetKg: 900 })?.weightTargetKg).toBe(65);
        expect(parseTrendViewState({ weightTargetKg: "65" })?.weightTargetKg).toBe(65);
    });

    it("克隆不改动原对象", () => {
        const state = defaultTrendViewState();
        const copy = cloneTrendViewState(state);
        copy.metricIds.push("protein");
        copy.excludedDayTypes.push("holiday");
        expect(state.metricIds).toHaveLength(3);
        expect(state.excludedDayTypes).toHaveLength(0);
    });
});

describe("趋势设置：指标开关与筛选口径", () => {
    it("开关指标时保持注册表顺序，且不会把最后一张关掉", () => {
        const state = defaultTrendViewState();
        const added = toggleTrendMetric(state, "protein");
        expect(added.metricIds).toEqual(["sleepWindow", "weight", "energy", "protein"]);
        const removed = toggleTrendMetric(added, "weight");
        expect(removed.metricIds).toEqual(["sleepWindow", "energy", "protein"]);
        const single = { ...state, metricIds: ["weight"] as const };
        expect(toggleTrendMetric({ ...single, metricIds: ["weight"] }, "weight").metricIds).toEqual(["weight"]);
    });

    it("昼夜类型预设可往返，手改后识别为自定义", () => {
        const state = defaultTrendViewState();
        expect(trendDayTypePreset(state)).toBe("all");
        const workday = withTrendDayTypePreset(state, "workday");
        expect(workday.excludedDayTypes).toEqual(TREND_DAY_TYPE_PRESETS.workday);
        expect(trendDayTypePreset(workday)).toBe("workday");
        expect(trendDayTypePreset({ ...workday, excludedDayTypes: ["holiday"] })).toBe("no-holiday");
        expect(trendDayTypePreset({ ...workday, excludedDayTypes: ["saturday-reset", "holiday"] })).toBe("custom");
    });

    it("自定义范围有明确标签，缺失日期时退回「自定义」", () => {
        const state = defaultTrendViewState();
        expect(trendRangeLabel(state)).toBe("本周");
        expect(trendRangeLabel({ ...state, range: "custom", customFrom: "2026-09-01", customTo: "2026-09-18" })).toBe("2026-09-01 → 2026-09-18");
        expect(trendRangeLabel({ ...state, range: "custom" })).toBe("自定义");
    });

    it("切换体重单位不改动其他设置", () => {
        const state = { ...defaultTrendViewState(), range: "90d" as const, weightTargetKg: 70 };
        const switched = withWeightUnit(state, "lb");
        expect(switched.weightUnit).toBe("lb");
        expect(switched.range).toBe("90d");
        expect(switched.weightTargetKg).toBe(70);
        expect(state.weightUnit).toBe("kg");
    });
});
