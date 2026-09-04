<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import {
        availableSliceCount,
        completedSliceCount,
        localDateKey,
        scheduleSlice,
        setSliceOutcome,
        slicesOnDate,
        type ExecutionSlice,
    } from "./execution-slices";
    import { buildWorkItemTree, flattenWorkItemTree } from "./tree";
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
    type TodayEntry = { item: WorkItem; slice: ExecutionSlice; path: string };

    const dispatch = createEventDispatcher<{ change: { data: WorkItemData; links: DailyWorkItemLink[] } }>();
    let open = false;
    let query = "";
    let savingId = "";
    let actionError = "";

    $: tree = buildWorkItemTree(data?.items ?? []);
    $: todayEntries = flattenWorkItemTree(tree).flatMap((item) => slicesOnDate(item, date).map((slice) => ({ item, slice, path: itemPath(item) })));
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
        if (!data || !saveWorkItem || savingId || entry.slice.status !== "scheduled") return;
        savingId = entry.item.id;
        actionError = "";
        try {
            const next = await saveWorkItem(data, entry.item, { executionSlices: setSliceOutcome(entry.item, entry.slice.id, status) });
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
                <div class={`xz-daily-project-link ${entry.slice.status}`}>
                    <button type="button" class="xz-daily-project-link__main" on:click={() => openWorkItem(entry.item.id)}>
                        <strong>{entry.item.title}</strong>
                        <small>{entry.path || "独立事务"} · {statusLabel(entry.slice.status)} · {completedSliceCount(entry.item)}／{entry.item.sliceTargetCount ?? "—"}</small>
                    </button>
                    {#if entry.slice.status === "scheduled" && canAddToday}
                        <span class="xz-daily-slice-actions"><button type="button" disabled={Boolean(savingId)} on:click={() => void finish(entry, "completed")}>完成</button><button type="button" disabled={Boolean(savingId)} on:click={() => void finish(entry, "abandoned")}>放弃</button></span>
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
