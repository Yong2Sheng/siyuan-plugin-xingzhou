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
    export let depth = 0;

    const dispatch = createEventDispatcher<{
        select: { id: string };
        toggle: { id: string };
    }>();

    $: children = (tree.children.get(item.id) ?? []).filter((child) => visibleIds.has(child.id));
    $: expanded = expandedIds.has(item.id);
    $: role = getWorkItemRole(item, tree);
    $: dependencyCount = (item.hardPrerequisiteIds?.length ?? 0) + (item.softPrerequisiteIds?.length ?? 0);
</script>

<div class="xz-tree-node" data-depth={depth} data-work-item-id={item.id}>
    <div class:selected={selectedId === item.id} class="xz-tree-row" data-role={role} style={`--xz-depth:${depth}`}>
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
            {#if item.status}<span class="xz-tag" data-status={item.status}>{item.status}</span>{/if}
        </button>
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
                    depth={depth + 1}
                    on:select
                    on:toggle
                />
            {/each}
        </div>
    {/if}
</div>
