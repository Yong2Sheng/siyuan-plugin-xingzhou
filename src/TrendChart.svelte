<script lang="ts">
    import { buildTrendGeometry, formatTrendValue, type TrendDot } from "./trend-chart";
    import { trendSummary, type TrendChartData } from "./trend-metrics";

    export let data: TrendChartData;
    export let openRecord: ((date: string) => void) | null = null;
    export let goToday: (() => void) | null = null;
    /** 只有体重这类带目标的指标会拿到这个回调，用来在看图时就地改目标值。 */
    export let editTarget: ((value: number | null) => void) | null = null;

    let width = 0;
    let activeIndex: number | null = null;
    let editingTarget = false;
    let targetDraft = "";

    /** jsdom 与首帧拿不到 clientWidth 时按 640 渲染，避免出现空白；真实布局一量到就换成实测宽度。 */
    $: effectiveWidth = width > 0 ? width : 640;
    $: geometry = buildTrendGeometry(data, effectiveWidth);
    $: summary = trendSummary(data);
    $: mainSeriesIndex = Math.max(0, data.series.findIndex((series) => !series.ghost));
    $: hitDots = geometry ? geometry.series[mainSeriesIndex]?.dots ?? [] : [];
    $: activeDot = activeIndex === null ? null : hitDots[activeIndex] ?? null;
    $: legendSeries = data.series;
    $: zoneTones = [...new Set(data.zones.map((zone) => zone.tone))];
    $: lowNote = summary.lowBins > 0 ? `${summary.lowBins} 个桶样本不足 3 天（空心点）` : "";
    /** 空状态按「有数据的天数」判断：按月聚合后 12 天只剩 1 个点，但数据其实够画。 */
    $: empty = data.rawDayCount < 2;
    /** 覆盖度只报主序列：把三条线的桶数加起来（睡眠窗口曾出现「10 天 · 9 个聚合点」）没有意义。 */
    $: mainPointCount = data.series[mainSeriesIndex]?.points.length ?? 0;
    $: coverageText = data.granularity === "day" || mainPointCount === data.rawDayCount
        ? `${data.rawDayCount} 天`
        : `${data.rawDayCount} 天 · ${mainPointCount} 个聚合点`;
    $: singleBinHint = !empty && data.pointCount < 2 && data.granularity !== "day"
        ? `当前按${data.granularity === "week" ? "周" : "月"}聚合，窗口内只有 1 个聚合点；把粒度切到「按日」可以看细节。`
        : "";

    function startEditTarget() {
        if (!data.target || !editTarget) return;
        targetDraft = data.target.y.toFixed(1);
        editingTarget = true;
    }

    function commitTarget() {
        if (!editTarget) return;
        const value = Number(targetDraft);
        editTarget(Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null);
        editingTarget = false;
    }

    function activate(index: number) {
        activeIndex = index;
    }

    function open(dot: TrendDot | null) {
        if (dot && openRecord && dot.recordDate) openRecord(dot.recordDate);
    }

    function handleKey(event: KeyboardEvent, dot: TrendDot) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open(dot);
    }
</script>

<article class="xz-trend-card" data-trend-metric={data.id}>
    <div class="xz-trend-card__head">
        <h3>{data.title}</h3>
        <span>{data.subtitle}</span>
        <span class="xz-trend-unit">{data.unitLabel}</span>
    </div>

    {#if empty}
        <div class="xz-trend-empty">
            <strong>还不够画出趋势</strong>
            <span>「{data.title}」目前只有 {data.rawDayCount} 天有数据，再记 {2 - data.rawDayCount} 天就能连线。</span>
            {#if goToday}<button type="button" on:click={() => goToday?.()}>去今日记录填写</button>{/if}
        </div>
    {:else}
        <div class="xz-trend-summary">
            <span><b>最近</b> {formatTrendValue(summary.latest, data.valueFormat, data.unitLabel)}</span>
            <span><b>{data.statLabel}</b> {formatTrendValue(summary.statValue, data.valueFormat, data.unitLabel)}</span>
            <span><b>最低</b> {formatTrendValue(summary.min, data.valueFormat, data.unitLabel)}</span>
            <span><b>最高</b> {formatTrendValue(summary.max, data.valueFormat, data.unitLabel)}</span>
            <span><b>覆盖</b> {coverageText}</span>
            {#if lowNote}<span>{lowNote}</span>{/if}
        </div>

        <div class="xz-trend-legend">
            {#each legendSeries as series, index (series.id)}
                <span>
                    <i
                        class={series.ghost ? "dash" : ""}
                        style={series.ghost ? `color: var(--xz-chart-${series.colorIndex + 1})` : `background: var(--xz-chart-${series.colorIndex + 1})`}
                    ></i>{series.ghost ? `${series.label}（虚线）` : series.label}
                </span>
                {#if index === legendSeries.length - 1}
                    {#if zoneTones.includes("good")}<span><i class="zone" style="background: var(--xz-chart-zone-good)"></i>达标方向</span>{/if}
                    {#if zoneTones.includes("bad")}<span><i class="zone" style="background: var(--xz-chart-zone-bad)"></i>反方向 / 熬夜区</span>{/if}
                    {#if data.bands.length}<span><i class="zone" style="background: var(--xz-chart-band)"></i>只标了时段、没记时刻</span>{/if}
                {/if}
            {/each}
        </div>

        <div class="xz-trend-plot" bind:clientWidth={width}>
            {#if geometry}
                <svg
                    class="xz-trend-svg"
                    viewBox={`0 0 ${geometry.width} ${geometry.height}`}
                    width="100%"
                    height={geometry.height}
                    role="group"
                    aria-label={`${data.title}趋势图，${summary.count} 个数据点`}
                    on:mouseleave={() => (activeIndex = null)}
                    on:blur={() => (activeIndex = null)}
                >
                    {#each geometry.zones as zone}
                        <rect class={`xz-trend-zone xz-trend-zone--${zone.tone}`} x={zone.x} y={zone.y} width={zone.w} height={zone.h} />
                    {/each}

                    {#each geometry.yTicks as tick}
                        <line class="xz-trend-grid" x1={geometry.plot.x} x2={geometry.plot.x + geometry.plot.w} y1={tick.position} y2={tick.position} />
                        <text class="xz-trend-tick" x={geometry.plot.x - 7} y={tick.position + 3.5} text-anchor="end">{tick.label}</text>
                    {/each}

                    {#each geometry.bands as band}
                        <rect class="xz-trend-band" x={band.x} y={band.y} width={band.w} height={band.h} />
                    {/each}

                    {#each geometry.lines as line}
                        <line class={`xz-trend-line xz-trend-line--${line.tone}`} x1={geometry.plot.x} x2={geometry.plot.x + geometry.plot.w} y1={line.y} y2={line.y} />
                        <text class={`xz-trend-line-label xz-trend-line-label--${line.tone}`} x={geometry.plot.x + geometry.plot.w} y={line.y - 5} text-anchor="end">{line.label}</text>
                    {/each}

                    {#if geometry.target}
                        <line class="xz-trend-target" x1={geometry.plot.x} x2={geometry.plot.x + geometry.plot.w} y1={geometry.target.y} y2={geometry.target.y} />
                        <text class="xz-trend-target-label" x={geometry.plot.x + geometry.plot.w} y={geometry.target.y + 13} text-anchor="end">{geometry.target.label}</text>
                    {/if}

                    {#each geometry.series as series (series.id)}
                        {#each series.paths as path}
                            <path class={`xz-trend-series${series.ghost ? " xz-trend-series--ghost" : ""}`} d={path} stroke={`var(--xz-chart-${series.colorIndex + 1})`} />
                        {/each}
                        {#each series.dots as dot}
                            <circle
                                class={`xz-trend-dot${dot.ghost ? " xz-trend-dot--ghost" : ""}${dot.low ? " xz-trend-dot--low" : ""}`}
                                cx={dot.x}
                                cy={dot.y}
                                r={dot.radius}
                                fill={`var(--xz-chart-${series.colorIndex + 1})`}
                            />
                        {/each}
                        {#each series.excludedDots as dot}
                            <circle class="xz-trend-dot xz-trend-dot--muted" cx={dot.x} cy={dot.y} r={dot.radius} />
                        {/each}
                    {/each}

                    {#each geometry.bands as band}
                        {#if band.label}
                            <g class="xz-trend-band-tag">
                                <rect x={band.labelX - band.labelW / 2} y={band.labelY - 9} width={band.labelW} height={12} rx="3" />
                                <text class="xz-trend-band-label" x={band.labelX} y={band.labelY} text-anchor="middle">{band.label}</text>
                            </g>
                        {/if}
                    {/each}

                    {#each geometry.xTicks as tick}
                        <text class="xz-trend-xtick" x={tick.position} y={geometry.plot.y + geometry.plot.h + 15} text-anchor="middle">{tick.label}</text>
                    {/each}

                    {#each hitDots as dot, index}
                        <circle
                            class="xz-trend-hit"
                            cx={dot.x}
                            cy={dot.y}
                            r="11"
                            role="button"
                            tabindex="0"
                            aria-label={`${dot.label}，点击查看当天记录`}
                            on:mouseenter={() => activate(index)}
                            on:focus={() => activate(index)}
                            on:click={() => open(dot)}
                            on:keydown={(event) => handleKey(event, dot)}
                        />
                    {/each}

                    {#if activeDot}
                        <g class="xz-trend-tip">
                            <rect
                                x={Math.min(Math.max(geometry.plot.x + 2, activeDot.x - 62), geometry.plot.x + geometry.plot.w - 126)}
                                y={activeDot.y - 44 < geometry.plot.y + 2 ? activeDot.y + 12 : activeDot.y - 44}
                                width="124"
                                height="36"
                                rx="5"
                            />
                            <text
                                x={Math.min(Math.max(geometry.plot.x + 2, activeDot.x - 62), geometry.plot.x + geometry.plot.w - 126) + 8}
                                y={(activeDot.y - 44 < geometry.plot.y + 2 ? activeDot.y + 12 : activeDot.y - 44) + 15}
                            >{activeDot.label.split("（")[0]}</text>
                            <text
                                class="xz-trend-tip__hint"
                                x={Math.min(Math.max(geometry.plot.x + 2, activeDot.x - 62), geometry.plot.x + geometry.plot.w - 126) + 8}
                                y={(activeDot.y - 44 < geometry.plot.y + 2 ? activeDot.y + 12 : activeDot.y - 44) + 28}
                            >点击打开当天记录</text>
                            <circle class="xz-trend-tip-anchor" cx={activeDot.x} cy={activeDot.y} r="4" />
                        </g>
                    {/if}
                </svg>
            {/if}
        </div>

        <div class="xz-trend-foot">
            {#each data.notes as note}<p>{note}</p>{/each}
            {#if singleBinHint}<p>{singleBinHint}</p>{/if}
            <p>{data.coverage}</p>
            {#if data.target && editTarget}
                <p class="xz-trend-target-row">
                    目标 {data.target.y.toFixed(1)} {data.unitLabel}
                    {#if editingTarget}
                        <input
                            class="xz-trend-target-input"
                            type="number"
                            step="0.1"
                            min="0"
                            aria-label="体重目标值"
                            bind:value={targetDraft}
                            on:change={commitTarget}
                            on:keydown={(event) => { if (event.key === "Enter") commitTarget(); if (event.key === "Escape") editingTarget = false; }}
                        />
                        <button type="button" on:click={commitTarget}>保存目标</button>
                        <button type="button" on:click={() => { editTarget(null); editingTarget = false; }}>清除目标</button>
                    {:else}
                        <button type="button" on:click={startEditTarget}>修改目标</button>
                    {/if}
                </p>
            {/if}
            {#if openRecord}<p class="xz-trend-foot__hint">点图中的圆点可跳到那天的记录。</p>{/if}
        </div>
    {/if}
</article>
