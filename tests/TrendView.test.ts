import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import DailyRhythm from "../src/DailyRhythm.svelte";
import TrendView from "../src/TrendView.svelte";
import {
    createDailyRecord,
    createEmptyDailyStore,
    upsertDailyRecord,
    type DailyRecord,
    type DailyRecordFields,
} from "../src/daily-records";
import { createEmptyNutritionStore } from "../src/nutrition";
import { defaultTrendViewState } from "../src/trend-view";
import { trendDayIndex, type TrendViewSettings } from "../src/trend-metrics";

function record(date: string, overrides: Partial<DailyRecordFields> = {}): DailyRecord {
    const base = createDailyRecord(date, "research-workday", 1000);
    return { ...base, fields: { ...base.fields, ...overrides } };
}

function storeOf(...records: DailyRecord[]) {
    return records.reduce((store, entry) => upsertDailyRecord(store, entry, 1000), createEmptyDailyStore(1000));
}

/** 本周（2026-09-14 周一 ~ 09-20 周日）：夜晚归日下的有效锚点是 09-14 ~ 09-20。 */
const sampleRecords = [
    record("2026-09-15", { hasMorningWeight: "yes", morningWeight: 66.4, daytimeEnergy: 3, lightsOffTime: "01:00", wakeTime: "07:07" }),
    record("2026-09-16", { hasMorningWeight: "yes", morningWeight: 66, daytimeEnergy: 4, lightsOffTime: "23:14", wakeTime: "08:30" }),
    record("2026-09-17", { hasMorningWeight: "yes", morningWeight: 65.8, daytimeEnergy: 3, lightsOffTime: "01:00", wakeTime: "07:07" }),
];

type MountOverrides = {
    records?: DailyRecord[];
    loadSettings?: () => Promise<TrendViewSettings | null>;
    goToday?: () => void;
};

function mount(props: MountOverrides = {}) {
    const saveSettings = vi.fn(async (_state: TrendViewSettings) => undefined);
    const openRecord = vi.fn();
    const state: TrendViewSettings = { ...defaultTrendViewState(), range: "all" };
    const component = new TrendView({
        target: document.body,
        props: {
            records: storeOf(...sampleRecords).records,
            loadNutrition: async () => createEmptyNutritionStore(1000),
            loadSettings: async () => state,
            saveSettings,
            openRecord,
            today: "2026-09-18",
            ...props,
        },
    });
    return { component, saveSettings, openRecord };
}

function clickButton(label: string, root: ParentNode = document.body) {
    const button = [...root.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
    if (!button) throw new Error(`没有找到按钮：${label}`);
    (button as HTMLButtonElement).click();
}

describe("趋势视图：默认渲染", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("按设置渲染默认三张图，未勾选的指标不出现", async () => {
        component = mount().component;
        await vi.waitFor(() => expect(document.querySelectorAll(".xz-trend-card").length).toBe(3));
        const ids = [...document.querySelectorAll(".xz-trend-card")].map((card) => card.getAttribute("data-trend-metric"));
        expect(ids).toEqual(["sleepWindow", "weight", "energy"]);
        expect(document.querySelector('[data-trend-metric="sleepDuration"]')).toBeNull();
    });

    it("每张图给出摘要、覆盖度与几何自检过的 SVG", async () => {
        component = mount().component;
        await vi.waitFor(() => expect(document.querySelectorAll(".xz-trend-svg").length).toBe(3));
        const weight = document.querySelector('[data-trend-metric="weight"]')!;
        expect(weight.querySelector(".xz-trend-summary")?.textContent).toContain("最近");
        expect(weight.querySelector(".xz-trend-summary")?.textContent).toContain("65.80 kg");
        expect(weight.querySelector(".xz-trend-foot")?.textContent).toContain("3/3 天称重");
        expect(weight.querySelectorAll("path.xz-trend-series").length).toBeGreaterThan(0);
    });

    it("勾选睡眠时长后追加一张图，并把设置写回", async () => {
        const mounted = mount();
        component = mounted.component;
        await vi.waitFor(() => expect(document.querySelectorAll(".xz-trend-card").length).toBe(3));
        clickButton("睡眠时长");
        await vi.waitFor(() => expect(document.querySelector('[data-trend-metric="sleepDuration"]')).not.toBeNull());
        await vi.waitFor(() => expect(mounted.saveSettings).toHaveBeenCalled());
        expect(mounted.saveSettings.mock.calls.at(-1)?.[0]?.metricIds).toContain("sleepDuration");
    });

    it("取消勾选后图表消失，最后一张不允许关掉", async () => {
        component = mount({ loadSettings: async () => ({ ...defaultTrendViewState(), range: "all", metricIds: ["weight", "energy"] }) }).component;
        await vi.waitFor(() => expect(document.querySelectorAll(".xz-trend-card").length).toBe(2));
        clickButton("白天精力");
        await vi.waitFor(() => expect(document.querySelectorAll(".xz-trend-card").length).toBe(1));
        clickButton("晨起体重");
        await tick();
        expect(document.querySelectorAll(".xz-trend-card").length).toBe(1);
    });
});

describe("趋势视图：夜晚归日与跳转", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("凌晨 1 点的熄灯画在前一天那一格，点它跳到当天记录", async () => {
        const mounted = mount();
        component = mounted.component;
        await vi.waitFor(() => expect(document.querySelector('[data-trend-metric="sleepWindow"] .xz-trend-hit')).not.toBeNull());
        const hits = [...document.querySelectorAll<SVGCircleElement>('[data-trend-metric="sleepWindow"] .xz-trend-hit')];
        const early = hits.find((hit) => hit.getAttribute("aria-label")?.startsWith("9-14"))!;
        expect(early.getAttribute("aria-label")).toContain("01:00");
        early.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(mounted.openRecord).toHaveBeenCalledWith("2026-09-15");
    });

    it("图例写明哪条是虚线，且虚线色块带系列颜色", async () => {
        component = mount().component;
        await vi.waitFor(() => expect(document.querySelector('[data-trend-metric="sleepWindow"] .xz-trend-legend')).not.toBeNull());
        const legend = document.querySelector('[data-trend-metric="sleepWindow"] .xz-trend-legend')!;
        expect(legend.textContent).toContain("计划熄灯（虚线）");
        const dashed = legend.querySelector<HTMLElement>("i.dash")!;
        expect(dashed.getAttribute("style")).toContain("--xz-chart-3");
    });

    it("睡眠窗口的说明写清归日口径与早于 05:00 的红区", async () => {
        component = mount().component;
        await vi.waitFor(() => expect(document.querySelector('[data-trend-metric="sleepWindow"]')).not.toBeNull());
        const foot = document.querySelector('[data-trend-metric="sleepWindow"] .xz-trend-foot')!.textContent ?? "";
        expect(foot).toContain("夜晚所属日");
        expect(foot).toContain("24:00–05:00");
        expect(foot).toContain("06:00–08:00");
    });
});

describe("趋势视图：体重目标就地修改", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("改目标后按公斤保存，切换单位时显示值跟着换算", async () => {
        const mounted = mount({ loadSettings: async () => ({ ...defaultTrendViewState(), range: "all", weightUnit: "lb" }) });
        component = mounted.component;
        await vi.waitFor(() => expect(document.querySelector('[data-trend-metric="weight"] .xz-trend-target-row')).not.toBeNull());
        const row = document.querySelector('[data-trend-metric="weight"] .xz-trend-target-row')!;
        expect(row.textContent).toContain("143.3");
        clickButton("修改目标", row);
        await tick();
        const input = row.querySelector<HTMLInputElement>(".xz-trend-target-input")!;
        input.value = "140";
        // 真实输入先触发 input（Svelte 的 bind:value 在这里同步），再触发 change 提交
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await vi.waitFor(() => expect(mounted.saveSettings).toHaveBeenCalled());
        const saved = mounted.saveSettings.mock.calls.at(-1)?.[0];
        expect(saved?.weightTargetKg).toBeCloseTo(63.5, 1);
    });
});

describe("趋势视图：空状态", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("只有一个点时只给空状态与去填写的入口", async () => {
        const goToday = vi.fn();
        component = mount({ records: storeOf(sampleRecords[0]).records, goToday }).component;
        await vi.waitFor(() => expect(document.querySelector('[data-trend-metric="weight"] .xz-trend-empty')).not.toBeNull());
        const empty = document.querySelector('[data-trend-metric="weight"] .xz-trend-empty')!;
        expect(empty.textContent).toContain("再记 1 天");
        clickButton("去今日记录填写", empty);
        expect(goToday).toHaveBeenCalled();
    });

    it("按月聚合压成一个点时照样画图，并提示可以切细粒度", async () => {
        component = mount({
            loadSettings: async () => ({ ...defaultTrendViewState(), range: "this-year", granularity: "month", metricIds: ["weight"] }),
        }).component;
        await vi.waitFor(() => expect(document.querySelector('[data-trend-metric="weight"] .xz-trend-svg')).not.toBeNull());
        const card = document.querySelector('[data-trend-metric="weight"]')!;
        expect(card.querySelector(".xz-trend-empty")).toBeNull();
        expect(card.querySelector(".xz-trend-summary")?.textContent).toContain("覆盖 3 天 · 1 个聚合点");
        expect(card.querySelector(".xz-trend-foot")?.textContent).toContain("把粒度切到「按日」");
    });

    it("完全没有记录时给整页空状态", async () => {
        component = mount({ records: [] }).component;
        await vi.waitFor(() => expect(document.querySelector(".xz-trend-empty")).not.toBeNull());
        expect(document.body.textContent).toContain("还没有每日记录");
    });
});

describe("趋势视图：接入生活节律", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("生活节律的第 7 个视图可以打开趋势，并带着每日记录渲染", async () => {
        const store = storeOf(...sampleRecords);
        const saveTrendView = vi.fn(async () => undefined);
        component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: async () => store,
                saveDaily: async (record: DailyRecord) => upsertDailyRecord(store, record, 2000),
                loadTrendView: async () => ({ ...defaultTrendViewState(), range: "all" }),
                saveTrendView,
            },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-view-nav")).not.toBeNull());
        const labels = [...document.querySelectorAll(".xz-daily-view-nav button")].map((button) => button.textContent?.trim());
        expect(labels).toContain("趋势");
        clickButton("趋势");
        await vi.waitFor(() => expect(document.querySelector(".xz-trend-view")).not.toBeNull());
        expect(document.querySelectorAll(".xz-trend-card").length).toBe(3);
        expect(document.querySelector('[data-trend-metric="energy"] .xz-trend-foot')?.textContent).toContain("3/3 天");
    });

    it("趋势视图读写的是趋势设置，不动每日记录", async () => {
        const store = storeOf(...sampleRecords);
        const saveDaily = vi.fn(async (record: DailyRecord) => upsertDailyRecord(store, record, 2000));
        const saveTrendView = vi.fn(async () => undefined);
        component = new DailyRhythm({
            target: document.body,
            props: { loadDaily: async () => store, saveDaily, loadTrendView: async () => null, saveTrendView },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-view-nav")).not.toBeNull());
        clickButton("趋势");
        await vi.waitFor(() => expect(document.querySelector(".xz-trend-view")).not.toBeNull());
        clickButton("近 90 天");
        await vi.waitFor(() => expect(saveTrendView).toHaveBeenCalled());
        expect(saveDaily).not.toHaveBeenCalled();
        expect(trendDayIndex("2026-09-15")).toBeGreaterThan(0);
    });
});
