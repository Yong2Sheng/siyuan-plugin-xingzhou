<script lang="ts">
    import {
        availableSliceCount,
        cancelScheduledSlice,
        completedSliceCount,
        localDateKey,
        scheduleSlice,
        setSliceOutcome,
        sliceCompletionPercent,
        slicesOnDate,
        validateSliceTarget,
        type ExecutionSlice,
    } from "./execution-slices";
    import type { WorkItem, WorkItemChanges } from "./work-items";

    export let item: WorkItem;
    export let disabled = false;
    export let save: (changes: WorkItemChanges) => Promise<void> = async () => undefined;

    type CalendarDay = {
        key: string;
        day: number;
        inMonth: boolean;
        isToday: boolean;
        isPast: boolean;
        afterDeadline: boolean;
        slice: ExecutionSlice | null;
    };

    const today = localDateKey();
    let monthCursor = monthStart(Date.now());
    let sourceId = "";
    let targetDraft = "";
    let durationDraft = "";
    let error = "";
    let saving = false;

    $: if (item.id !== sourceId) {
        sourceId = item.id;
        monthCursor = monthStart(Date.now());
        targetDraft = item.sliceTargetCount ? String(item.sliceTargetCount) : "";
        durationDraft = item.durationMinutes === null ? "" : String(item.durationMinutes);
        error = "";
    }
    $: target = item.sliceTargetCount ?? 0;
    $: completed = completedSliceCount(item);
    $: available = availableSliceCount(item);
    $: percent = sliceCompletionPercent(item);
    $: calendarDays = buildCalendarDays(monthCursor, item);
    $: monthLabel = `${monthCursor.getFullYear()} 年 ${monthCursor.getMonth() + 1} 月`;
    $: todaySlice = slicesOnDate(item, today)[0] ?? null;

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

    function canSchedule(day: CalendarDay): boolean {
        return day.inMonth && !day.isPast && !day.afterDeadline && target > 0 && available > 0;
    }

    function shiftMonth(offset: number) {
        monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + offset, 1);
    }

    function buildCalendarDays(month: Date, workItem: WorkItem): CalendarDay[] {
        const first = new Date(month.getFullYear(), month.getMonth(), 1);
        const mondayOffset = (first.getDay() + 6) % 7;
        const start = new Date(first);
        start.setDate(first.getDate() - mondayOffset);
        const deadline = workItem.deadline ? localDateKey(workItem.deadline) : "";
        return Array.from({ length: 42 }, (_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index);
            const key = localDateKey(date.getTime());
            return {
                key,
                day: date.getDate(),
                inMonth: date.getMonth() === month.getMonth(),
                isToday: key === today,
                isPast: key < today,
                afterDeadline: Boolean(deadline && key > deadline),
                slice: slicesOnDate(workItem, key)[0] ?? null,
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
</script>

<section class="xz-slice-card" aria-busy={saving}>
    <header>
        <div><h3>执行切片</h3><p>切片属于当前事务，不会成为上下层工作项。</p></div>
        <strong class="xz-slice-arranged">已完成 {completed}／{target || "—"}</strong>
    </header>

    <div class="xz-slice-progress-row">
        <div><strong>{percent}%</strong><span>事务完成度</span></div>
        <div class="xz-slice-progress" role="progressbar" aria-label="事务完成度" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}><i style={`width: ${percent}%`}></i></div>
        <span>{target && item.durationMinutes !== null ? `预计总投入 ${target * item.durationMinutes} 分钟` : "设置切片数量和每片时长后计算总投入"}</span>
    </div>

    <div class="xz-slice-config">
        <label><span>目标切片数</span><input class="b3-text-field" aria-label="目标切片数" type="number" min="1" max="366" step="1" bind:value={targetDraft} {disabled} on:change={() => void saveTarget()} /></label>
        <label><span>每片预计时长（分钟）</span><input class="b3-text-field" aria-label="每片预计时长（分钟）" type="number" min="0" step="1" bind:value={durationDraft} {disabled} on:change={() => void saveDuration()} /></label>
        <label><span>待安排</span><input class="b3-text-field xz-slice-readonly" aria-label="待安排切片数" type="text" value={target ? `${available} 个切片` : "先设置目标数量"} readonly tabindex="-1" /></label>
    </div>

    {#if !target}
        <p class="xz-slice-guidance">设置目标切片数后，即可点击日历安排执行日期。</p>
    {:else if !item.deadline}
        <p class="xz-slice-guidance">未设置截止日期，可从今天起自由安排执行切片。</p>
    {/if}

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
                        aria-label={`${day.key}${day.slice ? `，${statusLabel(day.slice.status)}` : ""}`}
                        aria-pressed={Boolean(day.slice)}
                        disabled={disabled || (!day.slice?.status && !canSchedule(day)) || Boolean(day.slice && day.slice.status !== "scheduled")}
                        on:click={() => void toggleDate(day)}
                    >
                        <span>{day.day}</span>
                        {#if day.slice}<small>{statusLabel(day.slice.status)}</small>{:else if item.deadline && day.key === localDateKey(item.deadline)}<small>截止</small>{/if}
                    </button>
                {/each}
            </div>
        </div>

        <aside class="xz-slice-side">
            {#if todaySlice?.status === "scheduled"}
                <div><strong>今天已有执行切片</strong><p>今天结束后仍未处理，将自动记为“未完成”。</p><span class="xz-slice-actions"><button type="button" disabled={saving || disabled} on:click={() => void finishToday("completed")}>完成</button><button class="abandon" type="button" disabled={saving || disabled} on:click={() => void finishToday("abandoned")}>放弃本次切片</button></span></div>
            {:else}
                <div><strong>{available > 0 ? `还有 ${available} 个切片待安排` : target ? "所有有效切片均已完成或安排" : "尚未配置切片"}</strong><p>未完成和放弃会保留历史，但会重新释放一个待安排名额。</p></div>
            {/if}
            <div class="xz-slice-legend"><span><i class="scheduled"></i>已安排</span><span><i class="completed"></i>已完成</span><span><i class="missed"></i>未完成</span><span><i class="abandoned"></i>已放弃</span></div>
        </aside>
    </div>
    {#if error}<p class="xz-save-error" role="alert">{error}</p>{/if}
</section>
