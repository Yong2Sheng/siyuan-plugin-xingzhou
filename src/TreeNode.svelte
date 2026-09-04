<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import RoleBadge from "./RoleBadge.svelte";
    import type { WorkItem } from "./work-items";
    import type { WorkItemTree as BuiltTree } from "./tree";
    import { getWorkItemRole } from "./work-item-role";

    export let item: WorkItem;
    export let tree: BuiltTree;
    export let selectedId: string | null;
    export let expandedIds: Set<string>;
    export let visibleIds: Set<string>;
    export let todayFocusCounts: Map<string, number>;
    export let draggingId: string | null = null;
    export let reorderDisabled = false;
    export let depth = 0;

    type DropPosition = "before" | "after";
    let dropPosition: DropPosition | null = null;

    const dispatch = createEventDispatcher<{
        select: { id: string };
        toggle: { id: string };
        dragstate: { id: string | null };
        reorder: { draggedId: string; targetId: string; position: DropPosition };
        move: { id: string; direction: -1 | 1 };
    }>();

    $: children = (tree.children.get(item.id) ?? []).filter((child) => visibleIds.has(child.id));
    $: expanded = expandedIds.has(item.id);
    $: role = getWorkItemRole(item, tree);
    $: dependencyCount = (item.hardPrerequisiteIds?.length ?? 0) + (item.softPrerequisiteIds?.length ?? 0);
    $: todayFocusCount = todayFocusCounts.get(item.id) ?? 0;
    $: sameParentDrag = Boolean(draggingId)
        && (tree.byId.get(draggingId ?? "")?.parentIds[0] ?? "") === (item.parentIds[0] ?? "");
    $: siblings = (item.parentIds[0] ? tree.children.get(item.parentIds[0]) ?? [] : tree.roots)
        .filter((candidate) => visibleIds.has(candidate.id));
    $: siblingIndex = siblings.findIndex((candidate) => candidate.id === item.id);
    $: canMoveUp = siblingIndex > 0;
    $: canMoveDown = siblingIndex >= 0 && siblingIndex < siblings.length - 1;
    $: if (!draggingId) dropPosition = null;

    function startDragging(event: DragEvent) {
        if (reorderDisabled) {
            event.preventDefault();
            return;
        }
        event.dataTransfer?.setData("text/plain", item.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        dispatch("dragstate", { id: item.id });
    }

    function handleDragOver(event: DragEvent) {
        if (!sameParentDrag || draggingId === item.id || reorderDisabled) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        dropPosition = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    }

    function handleDrop(event: DragEvent) {
        if (!draggingId || !sameParentDrag || draggingId === item.id || !dropPosition || reorderDisabled) return;
        event.preventDefault();
        dispatch("reorder", { draggedId: draggingId, targetId: item.id, position: dropPosition });
        dropPosition = null;
        dispatch("dragstate", { id: null });
    }

</script>

<div class="xz-tree-node" data-depth={depth} data-work-item-id={item.id}>
    <div
        class:selected={selectedId === item.id}
        class:xz-tree-row--dragging={draggingId === item.id}
        class:xz-tree-row--drop-before={dropPosition === "before"}
        class:xz-tree-row--drop-after={dropPosition === "after"}
        class="xz-tree-row"
        role="group"
        data-role={role}
        style={`--xz-depth:${depth}`}
        on:dragover={handleDragOver}
        on:dragleave={() => dropPosition = null}
        on:drop={handleDrop}
    >
        <button
            type="button"
            class="xz-drag-handle"
            draggable={!reorderDisabled}
            aria-label={`调整“${item.title}”的同级顺序`}
            title="拖动调整同级顺序"
            disabled={reorderDisabled}
            on:click|stopPropagation
            on:dragstart={startDragging}
            on:dragend={() => dispatch("dragstate", { id: null })}
        >⠿</button>
        {#if children.length > 0}
            <button
                type="button"
                class="xz-icon-button xz-tree-toggle"
                aria-label={expanded ? "收起" : "展开"}
                aria-expanded={expanded}
                on:click={() => dispatch("toggle", { id: item.id })}
            >
                <svg><use href={expanded ? "#iconDown" : "#iconRight"}></use></svg>
            </button>
        {:else}
            <span class="xz-tree-spacer"></span>
        {/if}
        <button type="button" class="xz-tree-main" on:click={() => dispatch("select", { id: item.id })}>
            <RoleBadge {role} />
            <span class="xz-tree-title">{item.title}</span>
            {#if dependencyCount > 0}<span class="xz-dependency-indicator" title={`${dependencyCount} 项跨项目依赖`}>⇠ {dependencyCount}</span>{/if}
            {#if todayFocusCount > 0}<span class="xz-today-focus" title={todayFocusCount > 1 ? `包含 ${todayFocusCount} 个今日工作项` : "今日工作项或所在路径"}>今日{todayFocusCount > 1 ? ` ${todayFocusCount}` : ""}</span>{/if}
            {#if item.status}<span class:xz-tag--secondary={todayFocusCount > 0} class="xz-tag" data-status={item.status}>{item.status}</span>{/if}
        </button>
        <span class="xz-order-controls" aria-label="同级排序">
            <button
                type="button"
                aria-label={`上移“${item.title}”`}
                title="上移"
                disabled={reorderDisabled || !canMoveUp}
                on:click|stopPropagation={() => dispatch("move", { id: item.id, direction: -1 })}
            >↑</button>
            <button
                type="button"
                aria-label={`下移“${item.title}”`}
                title="下移"
                disabled={reorderDisabled || !canMoveDown}
                on:click|stopPropagation={() => dispatch("move", { id: item.id, direction: 1 })}
            >↓</button>
        </span>
    </div>

    {#if expanded}
        <div class="xz-tree-children">
            {#each children as child (child.id)}
                <svelte:self
                    item={child}
                    {tree}
                    {selectedId}
                    {expandedIds}
                    {visibleIds}
                    {todayFocusCounts}
                    {draggingId}
                    {reorderDisabled}
                    depth={depth + 1}
                    on:select
                    on:toggle
                    on:dragstate
                    on:reorder
                    on:move
                />
            {/each}
        </div>
    {/if}
</div>
