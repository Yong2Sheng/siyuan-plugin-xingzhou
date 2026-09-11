<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { cleanupForStatusChange } from "./action-image-cleanup";
    import {
        availableSliceCount,
        automaticSliceStatusChanges,
        cancelScheduledSlice,
        completedSliceCount,
        localDateKey,
        scheduleSlice,
        setSliceOutcome,
        slicesOnDate,
        type ExecutionSlice,
    } from "./execution-slices";
    import { buildWorkItemTree, flattenWorkItemTree, isClosed } from "./tree";
    import type { DailyWorkItemLink } from "./daily-records";
    import type { WorkItem, WorkItemChanges, WorkItemData } from "./work-items";

    export let data: WorkItemData | null = null;
    export let date = localDateKey();
    export let loading = false;
    export let error = "";
    export let saveWorkItem: ((data: WorkItemData, item: WorkItem, changes: WorkItemChanges) => Promise<WorkItemData>) | null = null;
    export let openWorkItem: (workItemId: string) => void = () => undefined;

    type Choice = { item: WorkItem; path: string; group: string; searchText: string };
    type ChoiceGroup = { label: string; choices: Choice[] };
    type TodayEntry = { item: WorkItem; slice: ExecutionSlice; path: string; closed: boolean };

    const dispatch = createEventDispatcher<{ change: { data: WorkItemData; links: DailyWorkItemLink[] } }>();
    let open = false;
    let query = "";
    let savingId = "";
    let actionError = "";

    $: tree = buildWorkItemTree(data?.items ?? []);
    $: todayEntries = flattenWorkItemTree(tree).flatMap((item) => slicesOnDate(item, date).map((slice) => ({ item, slice, path: itemPath(item), closed: isClosed(item) })));
    $: choices = flattenWorkItemTree(tree)
        .filter((item) => item.type === "事务" && item.status === "进行中" && availableSliceCount(item) > 0 && Boolean(item.deadline) && date <= dateKey(item.deadline))
        .filter((item) => slicesOnDate(item, date).length === 0)
        .map(toChoice);
    $: normalizedQuery = query.trim().toLocaleLowerCase();
    $: filteredChoices = normalizedQuery ? choices.filter((choice) => choice.searchText.includes(normalizedQuery)) : choices;
    $: groups = groupChoices(filteredChoices);
    $: canAddToday = date === localDateKey() && Boolean(saveWorkItem);

    async function addToday(item: WorkItem) {
        if (!data || !saveWorkItem || savingId) return;
        savingId = item.id;
        actionError = "";
        try {
            const next = await saveWorkItem(data, item, { executionSlices: scheduleSlice(item, date) });
            data = next;
            dispatchChange(next);
        } catch (caught) {
            actionError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            savingId = "";
        }
    }

    async function finish(entry: TodayEntry, status: "completed" | "abandoned") {
        if (savingId || entry.closed || entry.slice.status !== "scheduled") return;
        await persistEntry(entry, setSliceOutcome(entry.item, entry.slice.id, status));
    }

    /** 取消今天这条切片安排：只撤掉安排，不改事务本身的状态。 */
    async function cancelToday(entry: TodayEntry) {
        if (savingId || entry.closed || entry.slice.status !== "scheduled") return;
        await persistEntry(entry, cancelScheduledSlice(entry.item, entry.slice.id));
    }

    /**
     * 切片变化统一从这里写入：补上领域层给出的「事务状态自动结果」，
     * 并在事务因此进入终态时按既有规则登记待清理图片，与项目与事务视图保持一致。
     */
    async function persistEntry(entry: TodayEntry, executionSlices: ExecutionSlice[]) {
        if (!data || !saveWorkItem) return;
        savingId = entry.item.id;
        actionError = "";
        try {
            const changes = automaticSliceStatusChanges(entry.item, { executionSlices });
            const status = typeof changes.status === "string" ? changes.status : "";
            const cleanup = status ? cleanupForStatusChange(entry.item, status, data.items) : null;
            const next = await saveWorkItem(data, entry.item, cleanup ? { ...changes, imageCleanup: cleanup } : changes);
            data = next;
            dispatchChange(next);
        } catch (caught) {
            actionError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            savingId = "";
        }
    }

    function dispatchChange(next: WorkItemData) {
        const nextTree = buildWorkItemTree(next.items);
        const links = flattenWorkItemTree(nextTree)
            .filter((item) => slicesOnDate(item, date).length > 0)
            .map((item) => ({ workItemId: item.id, titleSnapshot: item.title, pathSnapshot: itemPath(item, nextTree.byId), typeSnapshot: item.type }));
        dispatch("change", { data: next, links });
    }

    function toChoice(item: WorkItem): Choice {
        const path = itemPath(item);
        const group = longTermArea(item)?.title ?? "未归入长期领域";
        return { item, path, group, searchText: `${group} ${path} ${item.title} ${item.status}`.toLocaleLowerCase() };
    }

    function itemPath(item: WorkItem, byId = tree.byId): string {
        const titles: string[] = [];
        const seen = new Set<string>([item.id]);
        let parentId = item.parentIds[0];
        while (parentId && !seen.has(parentId)) {
            seen.add(parentId);
            const parent = byId.get(parentId);
            if (!parent) break;
            if (parent.type !== "长期领域") titles.unshift(parent.title);
            parentId = parent.parentIds[0];
        }
        return titles.join(" / ");
    }

    function longTermArea(item: WorkItem): WorkItem | null {
        const seen = new Set<string>([item.id]);
        let parentId = item.parentIds[0];
        while (parentId && !seen.has(parentId)) {
            seen.add(parentId);
            const parent = tree.byId.get(parentId);
            if (!parent) break;
            if (parent.type === "长期领域") return parent;
            parentId = parent.parentIds[0];
        }
        return null;
    }

    function groupChoices(entries: Choice[]): ChoiceGroup[] {
        const grouped = new Map<string, Choice[]>();
        for (const choice of entries) grouped.set(choice.group, [...(grouped.get(choice.group) ?? []), choice]);
        return [...grouped.entries()].map(([label, groupedChoices]) => ({ label, choices: groupedChoices }));
    }

    function statusLabel(status: ExecutionSlice["status"]): string {
        if (status === "completed") return "已完成";
        if (status === "missed") return "未完成";
        if (status === "abandoned") return "已放弃";
        return "待执行";
    }

    /** 事务已结束时，行上标出结束状态；已完成用成功色，其余结束状态用警示色。 */
    function closedStateClass(status: string): string {
        return status === "已完成" ? "done" : "stopped";
    }

    function dateKey(timestamp: number | null): string {
        return timestamp ? localDateKey(timestamp) : "";
    }
</script>

<div class="xz-daily-project-picker">
    <div class="xz-daily-project-picker__heading">
        <span>今日个人安排（来自项目与事务）</span>
        {#if canAddToday}<button type="button" on:click={() => open = !open}>{open ? "收起选择" : "＋ 添加今日执行切片"}</button>{/if}
    </div>

    {#if loading}
        <p class="xz-daily-project-picker__empty">正在读取项目与事务……</p>
    {:else if error}
        <p class="xz-daily-project-picker__empty">{error}</p>
    {:else if todayEntries.length}
        <div class="xz-daily-project-links" aria-label="今日个人安排">
            {#each todayEntries as entry (`${entry.item.id}-${entry.slice.id}`)}
                <div class={`xz-daily-project-link ${entry.slice.status}${entry.closed ? " closed" : ""}`}>
                    <button type="button" class="xz-daily-project-link__main" on:click={() => openWorkItem(entry.item.id)}>
                        <span class="xz-daily-project-link__title">
                            <strong>{entry.item.title}</strong>
                            {#if entry.closed}<em class={`xz-daily-project-link__state xz-daily-project-link__state--${closedStateClass(entry.item.status)}`}>事务{entry.item.status}</em>{/if}
                        </span>
                        <small>{entry.path || "独立事务"} · {statusLabel(entry.slice.status)} · {completedSliceCount(entry.item)}／{entry.item.sliceTargetCount ?? "—"}</small>
                    </button>
                    {#if !entry.closed && entry.slice.status === "scheduled" && canAddToday}
                        <span class="xz-daily-slice-actions"><button type="button" disabled={Boolean(savingId)} on:click={() => void finish(entry, "completed")}>完成</button><button type="button" disabled={Boolean(savingId)} on:click={() => void finish(entry, "abandoned")}>放弃</button><button class="cancel" type="button" title="取消今天的这条安排，不影响事务本身" aria-label={`取消“${entry.item.title}”今天的执行切片安排`} disabled={Boolean(savingId)} on:click={() => void cancelToday(entry)}>取消安排</button></span>
                    {/if}
                </div>
            {/each}
        </div>
    {:else}
        <p class="xz-daily-project-picker__empty">今日尚无个人事务安排。</p>
    {/if}

    {#if open && canAddToday}
        <div class="xz-daily-project-picker__panel">
            <input type="search" bind:value={query} aria-label="搜索可用执行切片" placeholder="搜索进行中的事务" on:input|stopPropagation on:change|stopPropagation />
            <p class="xz-daily-project-picker__hint">仅显示“进行中”、仍有待安排切片且今天尚无执行记录的事务。</p>
            {#if !groups.length}
                <p class="xz-daily-project-picker__state">没有可安排到今天的执行切片。</p>
            {:else}
                <div class="xz-daily-project-picker__groups">
                    {#each groups as group (group.label)}
                        <section>
                            <h4>{group.label}</h4>
                            {#each group.choices as choice (choice.item.id)}
                                <button type="button" disabled={Boolean(savingId)} on:click={() => void addToday(choice.item)}><span><strong>{choice.item.title}</strong><small>{choice.path || "独立事务"} · 待安排 {availableSliceCount(choice.item)} 片</small></span><b>{savingId === choice.item.id ? "保存中…" : "安排到今天"}</b></button>
                            {/each}
                        </section>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
    {#if actionError}<p class="xz-daily-project-picker__state error" role="alert">{actionError}</p>{/if}
</div>
