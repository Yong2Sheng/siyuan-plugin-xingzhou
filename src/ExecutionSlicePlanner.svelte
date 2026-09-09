<script lang="ts">
    import {
        availableSliceCount,
        cancelScheduledSlice,
        completeSliceNow,
        completedSliceCount,
        executionSliceLoadsByDate,
        localDateKey,
        scheduleSlice,
        setSliceOutcome,
        sliceCompletionPercent,
        slicesOnDate,
        validateSliceTarget,
        type ExecutionSlice,
        type ExecutionSliceDayLoad,
    } from "./execution-slices";
    import type { WorkItem, WorkItemChanges } from "./work-items";

    export let item: WorkItem;
    export let items: WorkItem[] = [];
    export let disabled = false;
    export let save: (changes: WorkItemChanges) => Promise<void> = async () => undefined;
    export let complete: () => Promise<void> = async () => undefined;

    type CalendarDay = {
        key: string;
        day: number;
        inMonth: boolean;
        isToday: boolean;
        isPast: boolean;
        afterDeadline: boolean;
        slice: ExecutionSlice | null;
        slices: ExecutionSlice[];
        load: ExecutionSliceDayLoad;
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
    $: calendarDays = buildCalendarDays(monthCursor, item, loadsByDate);
    $: monthLabel = `${monthCursor.getFullYear()} 年 ${monthCursor.getMonth() + 1} 月`;
    $: todaySlices = slicesOnDate(item, today);
    $: todaySlice = todaySlices.find((slice) => slice.status === "scheduled") ?? todaySlices[0] ?? null;
    $: investmentSummary = target && item.durationMinutes !== null
        ? `预计总投入 ${target * item.durationMinutes} 分钟`
        : "总投入待计算";
    $: planningSummary = todaySlice?.status === "scheduled"
        ? "今天已有执行切片；今天结束后未处理会自动记为“未完成”"
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

    async function finishToday(status: "completed" | "abandoned") {
        if (!todaySlice || todaySlice.status !== "scheduled") return;
        try {
            await persist({ executionSlices: setSliceOutcome(item, todaySlice.id, status) });
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        }
    }

    function openSliceContextMenu(event: MouseEvent, day: CalendarDay) {
        if (!canFinishFromContextMenu(day)) return;
        sliceContextMenu = {
            day,
            x: Math.min(event.clientX, window.innerWidth - 190),
            y: Math.min(event.clientY, window.innerHeight - 92),
        };
    }

    function openSliceContextMenuFromKeyboard(event: KeyboardEvent, day: CalendarDay) {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        if (!canFinishFromContextMenu(day)) return;
        event.preventDefault();
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        sliceContextMenu = { day, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    async function finishSliceFromContextMenu(day: CalendarDay) {
        if (!canFinishFromContextMenu(day) || !day.slice) return;
        sliceContextMenu = null;
        try {
            await persist({ executionSlices: completeSliceNow(item, day.slice.id) });
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        }
    }

    function finishContextSlice() {
        if (sliceContextMenu) void finishSliceFromContextMenu(sliceContextMenu.day);
    }

    function canFinishFromContextMenu(day: CalendarDay): boolean {
        return !disabled && (day.slice?.status === "scheduled" || day.slice?.status === "missed");
    }

    function contextMenuActionLabel(day: CalendarDay): string {
        if (day.slice?.status === "missed" || day.key < today) return "补记完成此切片";
        if (day.key > today) return "提前完成此切片";
        return "完成此切片";
    }

    function contextMenuHint(day: CalendarDay): string {
        if (day.slice?.status === "missed" || day.key < today) return "保留原计划日期，并补记为已完成";
        if (day.key > today) return "保留原计划日期，并标记为已完成";
        return "将今天的切片标记为已完成";
    }

    async function persist(changes: WorkItemChanges) {
        if (saving || disabled) return;
        saving = true;
        error = "";
        try {
            await save(changes);
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

    function buildCalendarDays(month: Date, workItem: WorkItem, dailyLoads: Map<string, ExecutionSliceDayLoad>): CalendarDay[] {
        const first = new Date(month.getFullYear(), month.getMonth(), 1);
        const mondayOffset = (first.getDay() + 6) % 7;
        const start = new Date(first);
        start.setDate(first.getDate() - mondayOffset);
        const deadline = workItem.deadline ? localDateKey(workItem.deadline) : "";
        return Array.from({ length: 42 }, (_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index);
            const key = localDateKey(date.getTime());
            const slices = slicesOnDate(workItem, key);
            return {
                key,
                day: date.getDate(),
                inMonth: date.getMonth() === month.getMonth(),
                isToday: key === today,
                isPast: key < today,
                afterDeadline: Boolean(deadline && key > deadline),
                slice: slices.find((slice) => slice.status === "scheduled") ?? slices[0] ?? null,
                slices,
                load: dailyLoads.get(key) ?? { count: 0, minutes: 0, unestimatedCount: 0 },
            };
        });
    }

    function monthStart(timestamp: number): Date {
        const date = new Date(timestamp);
        return new Date(date.getFullYear(), date.getMonth(), 1);
    }

    function statusLabel(status: ExecutionSlice["status"]): string {
        if (status === "completed") return "已完成";
        if (status === "missed") return "未完成";
        if (status === "abandoned") return "已放弃";
        return "已安排";
    }

    function completedSlicesOnDay(day: CalendarDay): number {
        return day.slices.filter((slice) => slice.status === "completed").length;
    }

    function loadMinutesLabel(load: ExecutionSliceDayLoad): string {
        if (load.unestimatedCount > 0 && load.minutes === 0) return "未估时";
        return `${load.unestimatedCount > 0 ? "≥" : ""}${load.minutes}分`;
    }

    function loadDescription(load: ExecutionSliceDayLoad): string {
        if (!load.count) return "";
        const estimate = load.unestimatedCount > 0
            ? load.minutes > 0
                ? `已知预计时长至少 ${load.minutes} 分钟，其中 ${load.unestimatedCount} 片未估时`
                : `${load.unestimatedCount} 片均未设置预计时长`
            : `预计 ${load.minutes} 分钟`;
        return `当日共 ${load.count} 片，${estimate}`;
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
            <small>{planningSummary}</small>
            {#if todaySlice?.status === "scheduled"}
                <span class="xz-slice-actions"><button type="button" disabled={saving || disabled} on:click={() => void finishToday("completed")}>完成</button><button class="abandon" type="button" disabled={saving || disabled} on:click={() => void finishToday("abandoned")}>放弃本次切片</button></span>
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
            <div class="xz-slice-weekdays" aria-hidden="true">{#each ["一", "二", "三", "四", "五", "六", "日"] as label}<span>{label}</span>{/each}</div>
            <div class="xz-slice-days" aria-label="执行切片安排日历">
                {#each calendarDays as day (day.key)}
                    <button
                        class:outside={!day.inMonth}
                        class:today={day.isToday}
                        class:scheduled={day.slice?.status === "scheduled"}
                        class:completed={day.slice?.status === "completed"}
                        class:missed={day.slice?.status === "missed"}
                        class:abandoned={day.slice?.status === "abandoned"}
                        class="xz-slice-day"
                        type="button"
                        aria-label={`${day.key}${day.slices.length ? `，当前事务 ${day.slices.length} 个切片，已完成 ${completedSlicesOnDay(day)} 个` : ""}${day.load.count ? `，${loadDescription(day.load)}` : ""}`}
                        title={canFinishFromContextMenu(day) ? `右键可${contextMenuActionLabel(day).replace("此切片", "")}` : day.load.count ? loadDescription(day.load) : undefined}
                        aria-pressed={Boolean(day.slice)}
                        disabled={disabled || (!day.slice?.status && !canSchedule(day)) || Boolean(day.slice && day.slice.status !== "scheduled" && day.slice.status !== "missed")}
                        on:click={() => void toggleDate(day)}
                        on:contextmenu|preventDefault={(event) => openSliceContextMenu(event, day)}
                        on:keydown={(event) => openSliceContextMenuFromKeyboard(event, day)}
                    >
                        <span class="xz-slice-day-heading">
                            <span>{day.day}</span>
                            {#if day.slice}<i class:scheduled={day.slice.status === "scheduled"} class:completed={day.slice.status === "completed"} class:missed={day.slice.status === "missed"} class:abandoned={day.slice.status === "abandoned"} class="xz-slice-day-status" aria-hidden="true"></i>{/if}
                        </span>
                        {#if day.slices.length > 1}
                            <small class="xz-slice-day-own-count">本事务 {day.slices.length} 片 · 完成 {completedSlicesOnDay(day)}</small>
                        {/if}
                        {#if day.load.count}
                            <small class="xz-slice-day-load"><strong>{loadMinutesLabel(day.load)}</strong><span class="xz-slice-day-count">{day.load.count}片</span></small>
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
            <button type="button" role="menuitem" disabled={saving || disabled} on:click={finishContextSlice}>{contextMenuActionLabel(sliceContextMenu.day)}</button>
            <small>{contextMenuHint(sliceContextMenu.day)}</small>
        </div>
    {/if}
    {#if error}<p class="xz-save-error" role="alert">{error}</p>{/if}
</section>
