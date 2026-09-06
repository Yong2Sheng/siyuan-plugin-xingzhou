<script lang="ts">
    import type { CaptureDialogRequest } from "./capture-dialog";
    import type { DailyRecord, DailyRecordStore } from "./daily-records";
    import { createDefaultChecklistStore, type ChecklistStore } from "./checklist";
    import DailyRhythm from "./DailyRhythm.svelte";
    import { createEmptyNutritionStore, type NutritionStore } from "./nutrition";
    import XingzhouApp from "./XingzhouApp.svelte";
    import type { InboxCaptureOptions, WorkItem, WorkItemChanges, WorkItemData, WorkItemViewState } from "./work-items";

    export let load: () => Promise<WorkItemData>;
    export let captureInbox: (title: string, options?: InboxCaptureOptions) => Promise<WorkItemData>;
    export let saveItem: (data: WorkItemData, item: WorkItem, changes: WorkItemChanges) => Promise<WorkItemData>;
    export let deleteItem: (data: WorkItemData, item: WorkItem) => Promise<WorkItemData>;
    export let reorderItems: (data: WorkItemData, parentId: string | null, orderedIds: string[]) => Promise<WorkItemData>
        = async (currentData) => currentData;
    export let openItemMenu: (
        event: MouseEvent,
        onDelete: () => void,
        addChild?: { label: string; onClick: () => void },
        actions?: Array<{ label: string; icon?: string; onClick: () => void }>,
    ) => void;
    export let openCaptureDialog: (request: CaptureDialogRequest) => void;
    export let openDocument: (blockId: string) => Promise<void>;
    export let loadDaily: () => Promise<DailyRecordStore>;
    export let saveDaily: (record: DailyRecord) => Promise<DailyRecordStore>;
    export let loadChecklist: () => Promise<ChecklistStore> = async () => createDefaultChecklistStore();
    export let saveChecklist: (store: ChecklistStore) => Promise<ChecklistStore> = async (store) => store;
    export let loadNutrition: () => Promise<NutritionStore> = async () => createEmptyNutritionStore();
    export let saveNutrition: (store: NutritionStore) => Promise<NutritionStore> = async (store) => store;

    let module: "projects" | "rhythm" = "projects";
    let dailyRhythm: DailyRhythm | undefined;
    let projectApp: XingzhouApp | undefined;
    let projectLoading = true;
    let projectQuickCaptureNotice = "";
    let initialWorkItemId: string | null = null;
    let projectViewState: WorkItemViewState | null = null;

    async function changeModule(next: "projects" | "rhythm", workItemId: string | null = null) {
        if (next === module && !workItemId) return;
        if (module === "rhythm" && dailyRhythm && !(await dailyRhythm.flushAutoSave())) return;
        if (module === "projects" && next === "rhythm") {
            projectViewState = projectApp?.getViewState() ?? projectViewState;
            initialWorkItemId = null;
        }
        if (workItemId) initialWorkItemId = workItemId;
        module = next;
    }

    function openWorkItemFromRhythm(workItemId: string) {
        void changeModule("projects", workItemId);
    }
</script>

<div class="xz-app-shell">
    <header class="xz-shell-header">
        <div class="xz-shell-brand"><h1>行舟</h1><div class="xz-eyebrow">个人行动与生活系统</div></div>
        <nav class="xz-module-nav" aria-label="一级模块">
            <button class:active={module === "projects"} type="button" on:click={() => void changeModule("projects")}><strong>项目与事务</strong><span>捕获、安排与整理</span></button>
            <button class:active={module === "rhythm"} type="button" on:click={() => void changeModule("rhythm")}><strong>生活节律</strong><span>科研、生活与恢复</span></button>
        </nav>
        <div class="xz-shell-actions">
            {#if module === "projects" && projectQuickCaptureNotice}<span class="xz-quick-capture-notice" aria-live="polite">{projectQuickCaptureNotice}</span>{/if}
            <span class="xz-data-source">插件内部数据</span>
            {#if module === "projects"}
                <button class="b3-button b3-button--outline xz-global-capture-button" type="button" on:click={() => projectApp?.openQuickCapture()}>
                    ＋ 添加
                </button>
                <button class="b3-button b3-button--outline" type="button" on:click={() => void projectApp?.refresh()} disabled={projectLoading}>
                    <svg><use href="#iconRefresh"></use></svg>{projectLoading ? "读取中" : "刷新"}
                </button>
            {/if}
        </div>
    </header>
    <div class="xz-shell-content">
        {#if module === "projects"}
            <XingzhouApp
                bind:this={projectApp}
                bind:loading={projectLoading}
                bind:quickCaptureNotice={projectQuickCaptureNotice}
                embedded={true}
                {load}
                {captureInbox}
                {saveItem}
                {deleteItem}
                {reorderItems}
                {openItemMenu}
                {openCaptureDialog}
                {openDocument}
                {initialWorkItemId}
                initialViewState={projectViewState}
            />
        {:else}
            <DailyRhythm bind:this={dailyRhythm} {loadDaily} {saveDaily} {loadChecklist} {saveChecklist} {loadNutrition} {saveNutrition} loadWorkItems={load} saveWorkItem={saveItem} openWorkItem={openWorkItemFromRhythm} />
        {/if}
    </div>
</div>
