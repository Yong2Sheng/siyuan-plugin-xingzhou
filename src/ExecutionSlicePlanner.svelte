<script lang="ts">
    import {
        availableSliceCount,
        cancelScheduledSlice,
        completeSliceNow,
        completedSliceCount,
        dayLoadValue,
        executionSliceLoadsByDate,
        executionSliceRemainingByDate,
        localDateKey,
        scheduleSlice,
        setSliceOutcome,
        sliceCompletionPercent,
        slicesOnDate,
        summarizeDayLoads,
        undoCompletedSlice,
        validateSliceTarget,
        type DayLoadValue,
        type ExecutionSlice,
        type ExecutionSliceDayLoad,
    } from "./execution-slices";
    import type { WorkItem, WorkItemChanges } from "./work-items";

    export let item: WorkItem;
    export let items: WorkItem[] = [];
    export let disabled = false;
    export let save: (changes: WorkItemChanges) => Promise<void> = async () => undefined;
    export let complete: () => Promise<void> = async () => undefined;
    /** 撤销切片完成走这条：事务该从「已完成」退回「进行中」，而不是再跑一遍“完成”的自动规则。 */
    export let saveUndo: (changes: WorkItemChanges) => Promise<void> = async () => undefined;

    type CalendarDay = {
        key: string;
        day: number;
        inMonth: boolean;
        isToday: boolean;
        isPast: boolean;
        afterDeadline: boolean;
        slice: ExecutionSlice | null;
        load: ExecutionSliceDayLoad;
        remaining: ExecutionSliceDayLoad;
    };

    const today = localDateKey();
    let monthCursor = monthStart(Date.now());
    let sourceId = "";
    let targetDraft = "";
    let durationDraft = "";
    let error = "";
    let saving = false;
    let sliceContextMenu: { day: CalendarDay; x: number; y: number } | null = null;

    $: if (item.id !== sourceId) {
        sourceId = item.id;
        monthCursor = monthStart(Date.now());
        targetDraft = item.sliceTargetCount ? String(item.sliceTargetCount) : "";
        durationDraft = item.durationMinutes === null ? "" : String(item.durationMinutes);
        error = "";
        sliceContextMenu = null;
    }
    $: target = item.sliceTargetCount ?? 0;
    $: completed = completedSliceCount(item);
    $: available = availableSliceCount(item);
    $: percent = sliceCompletionPercent(item);
    $: readyToComplete = target > 0
        && completed >= target
        && !["已完成", "已失败", "已取消", "已放弃"].includes(item.status);
    $: loadItems = items.some((candidate) => candidate.id === item.id) ? items : [...items, item];
    $: loadsByDate = executionSliceLoadsByDate(loadItems);
    $: remainingByDate = executionSliceRemainingByDate(loadItems);
    $: calendarDays = buildCalendarDays(monthCursor, item, loadsByDate, remainingByDate);
    $: monthLabel = `${monthCursor.getFullYear()} 年 ${monthCursor.getMonth() + 1} 月`;
    $: monthSummary = summarizeDayLoads(loadsByDate, remainingByDate, monthRangeStart(monthCursor), localDateKey(monthEnd(monthCursor).getTime()));
    $: todaySlices = slicesOnDate(item, today);
    $: todaySlice = todaySlices.find((slice) => slice.status === "scheduled") ?? todaySlices[0] ?? null;
    $: investmentSummary = target && item.durationMinutes !== null
        ? `预计总投入 ${target * item.durationMinutes} 分钟`
        : "总投入待计算";
    $: planningSummary = todaySlice?.status === "scheduled"
        // 只说事实：今天安排了几片。原先的「未处理会自动记为未完成」既没说清是事务还是切片，语气也像警告
        ? `今天已安排 ${todaySlices.filter((slice) => slice.status === "scheduled").length} 片`
        : !target
            ? "设置目标切片数后，即可点击日历安排执行日期"
            : !item.deadline
                ? `未设置截止日期，可从今天起自由安排；还有 ${available} 个切片待安排`
                : available > 0
                    ? `还有 ${available} 个切片待安排`
                    : "所有有效切片均已完成或安排";

    async function saveTarget() {
        const raw = String(targetDraft).trim();
        const value = raw ? Number(raw) : null;
        const validation = validateSliceTarget(item, value);
        if (validation) {
            targetDraft = item.sliceTargetCount ? String(item.sliceTargetCount) : "";
            error = validation;
            return;
        }
        if (value === (item.sliceTargetCount ?? null)) return;
        await persist({ sliceTargetCount: value });
    }

    async function saveDuration() {
        const raw = String(durationDraft).trim();
        const value = raw ? Number(raw) : null;
        if (value !== null && (!Number.isFinite(value) || value < 0)) {
            durationDraft = item.durationMinutes === null ? "" : String(item.durationMinutes);
            error = "每片预计时长不能小于 0 分钟。";
            return;
        }
        if (value === item.durationMinutes) return;
        await persist({ duration: value });
    }

    async function toggleDate(day: CalendarDay) {
        if (day.slice?.status === "scheduled") {
            await persist({ executionSlices: cancelScheduledSlice(item, day.slice.id) });
            return;
        }
        if (day.slice || !canSchedule(day)) return;
        try {
            await persist({ executionSlices: scheduleSlice(item, day.key) });
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        }
    }

    /** 撤销切片完成：走 saveUndo，事务若已是「已完成」就退回「进行中」，其余状态不动。 */
    async function undoSlice(day: CalendarDay) {
        if (!day.slice || day.slice.status !== "completed") return;
        sliceContextMenu = null;
        try {
            await persist({ executionSlices: undoCompletedSlice(item, day.slice.id) }, saveUndo);
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        }
    }

    /** 点击格子的统一入口：已完成 → 撤销，其余交给 toggleDate。 */
    function activateDate(day: CalendarDay) {
        if (day.slice?.status === "completed") void undoSlice(day);
        else void toggleDate(day);
    }

    async function finishToday(status: "completed" | "abandoned") {
        if (!todaySlice || todaySlice.status !== "scheduled") return;
        try {
            await persist({ executionSlices: setSliceOutcome(item, todaySlice.id, status) });
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        }
    }

    function openSliceContextMenu(event: MouseEvent, day: CalendarDay) {
        if (!canOpenContextMenu(day)) return;
        sliceContextMenu = {
            day,
            x: Math.min(event.clientX, window.innerWidth - 190),
            y: Math.min(event.clientY, window.innerHeight - 92),
        };
    }

    function openSliceContextMenuFromKeyboard(event: KeyboardEvent, day: CalendarDay) {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        if (!canOpenContextMenu(day)) return;
        event.preventDefault();
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        sliceContextMenu = { day, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    /** 菜单唯一的动作：已完成 → 撤销；已安排／未完成 → 完成（或补记完成）。 */
    async function runContextAction(day: CalendarDay) {
        if (!canOpenContextMenu(day) || !day.slice) return;
        if (day.slice.status === "completed") {
            await undoSlice(day);
            return;
        }
        sliceContextMenu = null;
        try {
            await persist({ executionSlices: completeSliceNow(item, day.slice.id) });
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        }
    }

    function runContextMenuAction() {
        if (sliceContextMenu) void runContextAction(sliceContextMenu.day);
    }

    /** 可打开菜单的格子：已安排、未完成、已完成（撤销）。已放弃保持只读，没有任何入口。 */
    function canOpenContextMenu(day: CalendarDay): boolean {
        const status = day.slice?.status;
        return !disabled && (status === "scheduled" || status === "missed" || status === "completed");
    }

    function contextMenuActionLabel(day: CalendarDay): string {
        if (day.slice?.status === "completed") {
            return day.key < today ? "撤销这次补记完成" : "撤销完成此切片";
        }
        if (day.slice?.status === "missed" || day.key < today) return "补记完成此切片";
        if (day.key > today) return "提前完成此切片";
        return "完成此切片";
    }

    function contextMenuHint(day: CalendarDay): string {
        if (day.slice?.status === "completed") {
            return day.key < today
                ? "退回「未完成」；事务不再满额时退回进行中"
                : "退回「已安排」，可重新安排日期";
        }
        if (day.slice?.status === "missed" || day.key < today) return "保留原计划日期，并补记为已完成";
        if (day.key > today) return "保留原计划日期，并标记为已完成";
        return "将今天的切片标记为已完成";
    }

    async function persist(changes: WorkItemChanges, writer: (changes: WorkItemChanges) => Promise<void> = save) {
        if (saving || disabled) return;
        saving = true;
        error = "";
        try {
            await writer(changes);
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        } finally {
            saving = false;
        }
    }

    async function completeTransaction() {
        if (saving || disabled || !readyToComplete) return;
        saving = true;
        error = "";
        try {
            await complete();
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        } finally {
            saving = false;
        }
    }

    function canSchedule(day: CalendarDay): boolean {
        return day.inMonth && !day.isPast && !day.afterDeadline && target > 0 && available > 0;
    }

    function shiftMonth(offset: number) {
        monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + offset, 1);
    }

    function buildCalendarDays(
        month: Date,
        workItem: WorkItem,
        dailyLoads: Map<string, ExecutionSliceDayLoad>,
        dailyRemaining: Map<string, ExecutionSliceDayLoad>,
    ): CalendarDay[] {
        const first = new Date(month.getFullYear(), month.getMonth(), 1);
        const mondayOffset = (first.getDay() + 6) % 7;
        const start = new Date(first);
        start.setDate(first.getDate() - mondayOffset);
        const deadline = workItem.deadline ? localDateKey(workItem.deadline) : "";
        return Array.from({ length: 42 }, (_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index);
            const key = localDateKey(date.getTime());
            /* 同一事务同一天只允许一个切片（scheduleSlice／moveScheduledSlice 都会拦截），直接取第一条即可 */
            const slice = slicesOnDate(workItem, key)[0] ?? null;
            return {
                key,
                day: date.getDate(),
                inMonth: date.getMonth() === month.getMonth(),
                isToday: key === today,
                isPast: key < today,
                afterDeadline: Boolean(deadline && key > deadline),
                slice,
                load: dailyLoads.get(key) ?? { count: 0, minutes: 0, unestimatedCount: 0 },
                remaining: dailyRemaining.get(key) ?? { count: 0, minutes: 0, unestimatedCount: 0 },
            };
        });
    }

    function monthStart(timestamp: number): Date {
        const date = new Date(timestamp);
        return new Date(date.getFullYear(), date.getMonth(), 1);
    }

    function monthEnd(month: Date): Date {
        return new Date(month.getFullYear(), month.getMonth() + 1, 0);
    }

    /** 月历汇总从今天开始算（今天之前的日期不再需要安排）。 */
    function monthRangeStart(month: Date): string {
        const first = localDateKey(month.getTime());
        return first > today ? first : today;
    }

    function statusLabel(status: ExecutionSlice["status"]): string {
        if (status === "completed") return "已完成";
        if (status === "missed") return "未完成";
        if (status === "abandoned") return "已放弃";
        return "已安排";
    }

    /** 「共 X 分 · N 片」的文案；窄屏只保留数字与「分」。 */
    function totalValueText(value: DayLoadValue): string {
        return value.unestimatedOnly ? "未估时" : `${value.atLeast ? "≥" : ""}${value.minutes}`;
    }

    function remainingValueText(value: DayLoadValue): string {
        return value.unestimatedOnly ? "未估时" : `${value.atLeast ? "≥" : ""}${value.minutes}`;
    }

    /** 悬停/读屏用的完整说明：把「共」与「待做」的口径写全，避免被读成空闲时间。 */
    function dayLoadDescription(day: CalendarDay): string {
        const load = dayLoadValue(day.load);
        const remaining = dayLoadValue(day.remaining);
        if (day.isPast) {
            if (!load.count) return "";
            return `${day.key} 当天共 ${load.count} 片已完成${load.unestimatedOnly ? "（未设置预计时长）" : `，合计 ${load.atLeast ? "至少 " : ""}${load.minutes} 分钟`}`;
        }
        if (!load.count && !remaining.count) return "";
        if (!remaining.count) {
            return `${day.key} 当日共 ${load.count} 片已全部完成${load.unestimatedOnly ? "" : `，合计 ${load.minutes} 分钟`}；当天没有待做事务`;
        }
        const parts = [`${day.key} 当日共 ${load.count} 片`];
        if (!load.unestimatedOnly) parts.push(`预计 ${load.minutes} 分钟`);
        const doneMinutes = Math.max(0, load.minutes - remaining.minutes);
        if (doneMinutes > 0) parts.push(`已完成 ${doneMinutes} 分钟`);
        parts.push(remaining.unestimatedOnly ? "待做时长未估时" : `待做 ${remaining.atLeast ? "至少 " : ""}${remaining.minutes} 分钟`);
        return parts.join("，");
    }
</script>

<svelte:window on:click={() => sliceContextMenu = null} on:keydown={(event) => { if (event.key === "Escape") sliceContextMenu = null; }} />

<section class="xz-slice-card" aria-busy={saving}>
    <header>
        <div class="xz-slice-heading">
            <div><h3>执行切片</h3><strong>{investmentSummary}</strong><span class="xz-slice-info" role="img" aria-label="切片属于当前事务，不会成为上下层工作项。" title="切片属于当前事务，不会成为上下层工作项。">i</span></div>
        </div>
        <div class="xz-slice-header-meta">
            <strong class="xz-slice-arranged">已完成 {completed}／{target || "—"}</strong>
            <span class="xz-slice-available">待安排 {target ? available : "—"}</span>
            <div class="xz-slice-legend"><span><i class="scheduled"></i>已安排</span><span><i class="completed"></i>已完成</span><span><i class="missed"></i>未完成</span><span><i class="abandoned"></i>已放弃</span></div>
        </div>
    </header>

    <div class="xz-slice-progress-row">
        <div><strong>{percent}%</strong><span>事务完成度</span></div>
        <div class="xz-slice-progress" role="progressbar" aria-label="事务完成度" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}><i style={`width: ${percent}%`}></i></div>
        <div class="xz-slice-progress-summary">
            <small title={planningSummary}>{planningSummary}</small>
            {#if todaySlice?.status === "scheduled"}
                <span class="xz-slice-actions"><button type="button" disabled={saving || disabled} on:click={() => void finishToday("completed")}>完成</button><button class="abandon" type="button" disabled={saving || disabled} on:click={() => void finishToday("abandoned")} title="放弃本次切片">放弃</button></span>
            {/if}
        </div>
    </div>

    {#if readyToComplete}
        <div class="xz-slice-completion-prompt" role="status">
            <span>目标切片已全部完成，事务是否也已完成？</span>
            <button type="button" disabled={saving || disabled} on:click={() => void completeTransaction()}>完成事务</button>
        </div>
    {/if}

    <div class="xz-slice-config">
        <label><span>目标切片数（输入上限 366）</span><input class="b3-text-field" aria-label="目标切片数" type="number" min="1" max="366" step="1" bind:value={targetDraft} {disabled} on:change={() => void saveTarget()} /></label>
        <label><span>每片预计时长（分钟）</span><input class="b3-text-field" aria-label="每片预计时长（分钟）" type="number" min="0" step="1" bind:value={durationDraft} {disabled} on:change={() => void saveDuration()} /></label>
    </div>

    <div class="xz-slice-layout">
        <div class="xz-slice-calendar">
            <div class="xz-slice-month"><button type="button" aria-label="上个月" on:click={() => shiftMonth(-1)}>‹</button><strong>{monthLabel}</strong><button type="button" aria-label="下个月" on:click={() => shiftMonth(1)}>›</button></div>
            <p class="xz-slice-month-summary">
                <span>今天起<strong>待做 {monthSummary.remainingMinutes} 分</strong></span>
                <span>共 {monthSummary.totalMinutes} 分</span>
                {#if monthSummary.clearedDates.length}
                    <span class="is-clear">已清空 {monthSummary.clearedDates.length} 天</span>
                {/if}
            </p>
            <p class="xz-slice-month-legend">待做＝当天已安排、但还没完成的切片时长；共＝当天已安排＋已完成的时长合计。</p>
            <div class="xz-slice-weekdays" aria-hidden="true">{#each ["一", "二", "三", "四", "五", "六", "日"] as label}<span>{label}</span>{/each}</div>
            <div class="xz-slice-days" aria-label="执行切片安排日历">
                {#each calendarDays as day (day.key)}
                    {@const remaining = dayLoadValue(day.remaining)}
                    {@const load = dayLoadValue(day.load)}
                    {@const isCleared = !day.isPast && remaining.count === 0 && load.count > 0}
                    <button
                        class:outside={!day.inMonth}
                        class:today={day.isToday}
                        class:is-clear={isCleared}
                        class:scheduled={day.slice?.status === "scheduled"}
                        class:completed={day.slice?.status === "completed"}
                        class:missed={day.slice?.status === "missed"}
                        class:abandoned={day.slice?.status === "abandoned"}
                        class="xz-slice-day"
                        type="button"
                        data-date={day.key}
                        title={day.slice?.status === "completed" ? "点击撤销这次完成" : undefined}
                        aria-label={`${day.key}${dayLoadDescription(day) ? `，${dayLoadDescription(day)}` : ""}${day.slice?.status === "completed" ? "；点击撤销这次完成" : ""}`}
                        aria-pressed={Boolean(day.slice)}
                        disabled={disabled || Boolean(day.slice && day.slice.status === "abandoned") || (!day.slice?.status && !canSchedule(day))}
                        on:click={() => activateDate(day)}
                        on:contextmenu|preventDefault={(event) => openSliceContextMenu(event, day)}
                        on:keydown={(event) => openSliceContextMenuFromKeyboard(event, day)}
                    >
                        <span class="xz-slice-day-heading">
                            <span>{day.day}</span>
                            {#if day.slice}<i class:scheduled={day.slice.status === "scheduled"} class:completed={day.slice.status === "completed"} class:missed={day.slice.status === "missed"} class:abandoned={day.slice.status === "abandoned"} class="xz-slice-day-status" aria-hidden="true"></i>{/if}
                            {#if day.isToday}<span class="xz-slice-day-today-chip" aria-hidden="true">今</span>{/if}
                        </span>
                        {#if day.load.count}
                            <small class="xz-slice-day-load xz-slice-day-load--stack">
                                {#if !day.isPast}
                                    <strong
                                        class:is-clear={isCleared}
                                        class:has-unestimated={remaining.atLeast || remaining.unestimatedOnly}
                                        class="xz-slice-day-remaining"
                                    ><span class="xz-slice-day-prefix">待做</span><span class="xz-slice-day-value">{remainingValueText(remaining)}</span>{#if !remaining.unestimatedOnly}<span class="xz-slice-day-unit">分</span>{/if}</strong>
                                {/if}
                                <span class="xz-slice-day-total"><span class="xz-slice-day-prefix">共</span><span class="xz-slice-day-value">{totalValueText(load)}</span>{#if !load.unestimatedOnly}<span class="xz-slice-day-total-unit">分</span>{/if}<span class="xz-slice-day-total-count">· {load.count} 片</span></span>
                            </small>
                        {:else if day.slice}
                            <small>{statusLabel(day.slice.status)}</small>
                        {:else if item.deadline && day.key === localDateKey(item.deadline)}<small>截止</small>{/if}
                    </button>
                {/each}
            </div>
        </div>

    </div>
    {#if sliceContextMenu}
        <div class="xz-slice-context-menu" style={`left:${sliceContextMenu.x}px;top:${sliceContextMenu.y}px`} role="menu">
            <button class:is-undo={sliceContextMenu.day.slice?.status === "completed"} type="button" role="menuitem" disabled={saving || disabled} on:click={runContextMenuAction}>{contextMenuActionLabel(sliceContextMenu.day)}</button>
            <small>{contextMenuHint(sliceContextMenu.day)}</small>
        </div>
    {/if}
    {#if error}<p class="xz-save-error" role="alert">{error}</p>{/if}
</section>
