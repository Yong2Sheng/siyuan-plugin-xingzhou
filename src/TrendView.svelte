<script lang="ts">
    import { onDestroy } from "svelte";
    import type { DailyRecord } from "./daily-records";
    import { createEmptyNutritionStore, type NutritionStore } from "./nutrition";
    import TrendChart from "./TrendChart.svelte";
    import {
        buildTrendChart,
        convertWeight,
        TREND_METRICS,
        trendDayIndex,
        type TrendChartData,
        type TrendViewSettings,
    } from "./trend-metrics";
    import {
        cloneTrendViewState,
        defaultTrendViewState,
        parseTrendViewFile,
        TREND_DAY_TYPE_LABELS,
        TREND_RANGE_LABELS,
        trendDayTypePreset,
        withTrendDayTypePreset,
        withWeightUnit,
        type TrendDayTypePreset,
    } from "./trend-view";

    export let records: DailyRecord[] = [];
    export let loadNutrition: () => Promise<NutritionStore> = async () => createEmptyNutritionStore();
    export let loadSettings: () => Promise<TrendViewSettings | null> = async () => null;
    export let saveSettings: (state: TrendViewSettings) => Promise<void> = async () => undefined;
    export let openRecord: (date: string) => void = () => undefined;
    export let goToday: () => void = () => undefined;
    export let today = localDateKey();

    const ranges = Object.keys(TREND_RANGE_LABELS) as Array<keyof typeof TREND_RANGE_LABELS>;
    const granularities: Array<{ id: TrendViewSettings["granularity"]; label: string }> = [
        { id: "auto", label: "自动" },
        { id: "day", label: "按日" },
        { id: "week", label: "按周" },
        { id: "month", label: "按月" },
    ];
    const stats: Array<{ id: TrendViewSettings["stat"]; label: string }> = [
        { id: "auto", label: "自动" },
        { id: "mean", label: "均值" },
        { id: "median", label: "中位数" },
    ];
    const dayTypePresets = Object.keys(TREND_DAY_TYPE_LABELS) as TrendDayTypePreset[];

    let settings: TrendViewSettings = defaultTrendViewState();
    let nutrition: NutritionStore | null = null;
    let loading = true;
    let error = "";
    let notice = "";
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let saveTask: Promise<void> = Promise.resolve();

    Promise.resolve().then(() => void initialize());

    onDestroy(() => {
        if (saveTimer !== null) clearTimeout(saveTimer);
        void saveTask;
    });

    $: todayIndex = trendDayIndex(today);
    $: charts = loading || error ? [] : settings.metricIds.map((id) => buildTrendChart(id, {
        records,
        nutrition,
        settings,
        today: Number.isNaN(todayIndex) ? trendDayIndex(localDateKey()) : todayIndex,
    }));
    $: dayTypePreset = trendDayTypePreset(settings);
    $: showWeightUnit = settings.metricIds.includes("weight");

    async function initialize() {
        loading = true;
        error = "";
        try {
            const [stored, nutritionStore] = await Promise.all([
                loadSettings().catch(() => null),
                loadNutrition().catch(() => null),
            ]);
            settings = stored ?? parseTrendViewFile(stored) ?? defaultTrendViewState();
            nutrition = nutritionStore;
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        } finally {
            loading = false;
        }
    }

    /** 设置是非关键 UI 数据：合并写、失败只提示，不影响任何正式数据。 */
    function apply(next: TrendViewSettings) {
        settings = cloneTrendViewState(next);
        notice = "";
        if (saveTimer !== null) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            const snapshot = cloneTrendViewState(settings);
            saveTask = saveTask
                .then(() => saveSettings(snapshot))
                .then(() => { notice = "已保存"; })
                .catch((caught) => { notice = `趋势设置保存失败：${caught instanceof Error ? caught.message : String(caught)}`; });
        }, 300);
    }

    function toggleMetric(id: TrendChartData["id"]) {
        const selected = new Set(settings.metricIds);
        if (selected.has(id)) {
            if (selected.size === 1) return;
            selected.delete(id);
        } else {
            selected.add(id);
        }
        apply({ ...settings, metricIds: TREND_METRICS.filter((metric) => selected.has(metric.id)).map((metric) => metric.id) });
    }

    function localDateKey(date = new Date()): string {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
</script>

<section class="xz-trend-view">
    <div class="xz-trend-toolbar">
        <div class="xz-trend-toolbar__row">
            <span class="xz-trend-toolbar__label">指标</span>
            {#each TREND_METRICS as metric (metric.id)}
                <button
                    class="xz-trend-chip"
                    class:xz-trend-chip--on={settings.metricIds.includes(metric.id)}
                    type="button"
                    aria-pressed={settings.metricIds.includes(metric.id)}
                    title={metric.description}
                    on:click={() => toggleMetric(metric.id)}
                >{metric.label}{settings.metricIds.includes(metric.id) ? " ✕" : " ＋"}</button>
            {/each}
        </div>
        <div class="xz-trend-toolbar__row">
            <span class="xz-trend-toolbar__label">范围</span>
            <span class="xz-trend-seg">
                {#each ranges as range}
                    <button class:active={settings.range === range} type="button" aria-pressed={settings.range === range} on:click={() => apply({ ...settings, range })}>{TREND_RANGE_LABELS[range]}</button>
                {/each}
            </span>
            {#if settings.range === "custom"}
                <input class="xz-trend-select" type="date" aria-label="起始日期" bind:value={settings.customFrom} on:change={() => apply({ ...settings })} />
                <input class="xz-trend-select" type="date" aria-label="结束日期" bind:value={settings.customTo} on:change={() => apply({ ...settings })} />
            {/if}
            <span class="xz-trend-toolbar__label">粒度</span>
            <span class="xz-trend-seg">
                {#each granularities as entry}
                    <button class:active={settings.granularity === entry.id} type="button" aria-pressed={settings.granularity === entry.id} on:click={() => apply({ ...settings, granularity: entry.id })}>{entry.label}</button>
                {/each}
            </span>
            <span class="xz-trend-toolbar__label">统计</span>
            <span class="xz-trend-seg">
                {#each stats as entry}
                    <button class:active={settings.stat === entry.id} type="button" aria-pressed={settings.stat === entry.id} on:click={() => apply({ ...settings, stat: entry.id })}>{entry.label}</button>
                {/each}
            </span>
            {#if showWeightUnit}
                <span class="xz-trend-toolbar__label">体重单位</span>
                <span class="xz-trend-seg">
                    <button class:active={settings.weightUnit === "kg"} type="button" aria-pressed={settings.weightUnit === "kg"} on:click={() => apply(withWeightUnit(settings, "kg"))}>kg</button>
                    <button class:active={settings.weightUnit === "lb"} type="button" aria-pressed={settings.weightUnit === "lb"} on:click={() => apply(withWeightUnit(settings, "lb"))}>lb</button>
                </span>
            {/if}
        </div>
        <div class="xz-trend-toolbar__row">
            <span class="xz-trend-toolbar__label">数据筛选</span>
            <span class="xz-trend-seg">
                {#each dayTypePresets as preset}
                    <button class:active={dayTypePreset === preset} type="button" aria-pressed={dayTypePreset === preset} on:click={() => apply(withTrendDayTypePreset(settings, preset))}>{TREND_DAY_TYPE_LABELS[preset]}</button>
                {/each}
            </span>
            <label class="xz-trend-toolbar__label"><input type="checkbox" checked={settings.ghostExcluded} on:change={(event) => apply({ ...settings, ghostExcluded: event.currentTarget.checked })} /> 被排除的点置灰保留（不参与均值）</label>
            {#if notice}<span class="xz-trend-notice" role="status">{notice}</span>{/if}
        </div>
    </div>

    {#if loading}
        <div class="xz-state"><h2>正在读取趋势设置……</h2></div>
    {:else if error}
        <div class="xz-state xz-error"><h2>暂时无法读取趋势数据</h2><p>{error}</p><button class="b3-button" type="button" on:click={() => void initialize()}>重试</button></div>
    {:else if !records.length}
        <div class="xz-trend-empty">
            <strong>还没有每日记录</strong>
            <span>先在「今日记录」里填几天睡眠、体重和评分，这里就会长出趋势。</span>
            <button type="button" on:click={() => goToday()}>去今日记录填写</button>
        </div>
    {:else}
        {#each charts as chart (chart.id)}
            <TrendChart
                data={chart}
                {openRecord}
                {goToday}
                editTarget={chart.id === "weight" ? (value) => apply({ ...settings, weightTargetKg: value === null ? null : Math.round(convertWeight(value, settings.weightUnit, "kg") * 100) / 100 }) : null}
            />
        {/each}
    {/if}
</section>
