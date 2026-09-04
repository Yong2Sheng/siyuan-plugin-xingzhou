<script lang="ts">
    import type { CaptureDialogRequest } from "./capture-dialog";
    import type { DailyRecord, DailyRecordStore } from "./daily-records";
    import DailyRhythm from "./DailyRhythm.svelte";
    import XingzhouApp from "./XingzhouApp.svelte";
    import type { InboxCaptureOptions, WorkItem, WorkItemChanges, WorkItemData } from "./work-items";

    export let load: () => Promise<WorkItemData>;
    export let captureInbox: (title: string, options?: InboxCaptureOptions) => Promise<WorkItemData>;
    export let saveItem: (data: WorkItemData, item: WorkItem, changes: WorkItemChanges) => Promise<WorkItemData>;
    export let deleteItem: (data: WorkItemData, item: WorkItem) => Promise<WorkItemData>;
    export let reorderItems: (data: WorkItemData, parentId: string | null, orderedIds: string[]) => Promise<WorkItemData>
        = async (currentData) => currentData;
    export let openItemMenu: (event: MouseEvent, onDelete: () => void, addChild?: { label: string; onClick: () => void }) => void;
    export let openCaptureDialog: (request: CaptureDialogRequest) => void;
    export let openDocument: (blockId: string) => Promise<void>;
    export let loadDaily: () => Promise<DailyRecordStore>;
    export let saveDaily: (record: DailyRecord) => Promise<DailyRecordStore>;

    let module: "projects" | "rhythm" = "projects";
</script>

<div class="xz-app-shell">
    <header class="xz-shell-header">
        <div><div class="xz-eyebrow">个人行动与生活系统</div><h1>行舟</h1></div>
        <span class="xz-data-source">插件内部数据</span>
    </header>
    <nav class="xz-module-nav" aria-label="一级模块">
        <button class:active={module === "projects"} type="button" on:click={() => module = "projects"}><strong>项目与事务</strong><span>捕获、安排与整理</span></button>
        <button class:active={module === "rhythm"} type="button" on:click={() => module = "rhythm"}><strong>生活节律</strong><span>科研、生活与恢复</span></button>
    </nav>
    <div class="xz-shell-content">
        {#if module === "projects"}
            <XingzhouApp
                embedded={true}
                {load}
                {captureInbox}
                {saveItem}
                {deleteItem}
                {reorderItems}
                {openItemMenu}
                {openCaptureDialog}
                {openDocument}
            />
        {:else}
            <DailyRhythm {loadDaily} {saveDaily} />
        {/if}
    </div>
</div>
