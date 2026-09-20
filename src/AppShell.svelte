<script lang="ts">
    import { onDestroy } from "svelte";
    import type { CaptureDialogRequest } from "./capture-dialog";
    import type { DailyRecord, DailyRecordStore } from "./daily-records";
    import { createDefaultChecklistStore, type ChecklistStore } from "./checklist";
    import DailyRhythm from "./DailyRhythm.svelte";
    import type { ActionImageCopyTarget } from "./image-clipboard";
    import { createEmptyNutritionStore, type NutritionStore } from "./nutrition";
    import XingzhouApp from "./XingzhouApp.svelte";
    import type { TrendViewSettings } from "./trend-metrics";
    import { log } from "./log";
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
    export let openImageMenu: (event: MouseEvent, image: ActionImageCopyTarget) => void = () => undefined;
    export let openCaptureDialog: (request: CaptureDialogRequest) => void;
    export let openDocument: (blockId: string) => Promise<void>;
    export let loadDaily: () => Promise<DailyRecordStore>;
    export let saveDaily: (record: DailyRecord) => Promise<DailyRecordStore>;
    export let loadChecklist: () => Promise<ChecklistStore> = async () => createDefaultChecklistStore();
    export let saveChecklist: (store: ChecklistStore) => Promise<ChecklistStore> = async (store) => store;
    export let loadNutrition: () => Promise<NutritionStore> = async () => createEmptyNutritionStore();
    export let saveNutrition: (store: NutritionStore) => Promise<NutritionStore> = async (store) => store;
    export let loadTrendViewState: () => Promise<TrendViewSettings | null> = async () => null;
    export let saveTrendViewState: (state: TrendViewSettings) => Promise<void> = async () => undefined;

    let module: "projects" | "rhythm" = "projects";
    let dailyRhythm: DailyRhythm | undefined;
    let projectApp: XingzhouApp | undefined;
    let projectLoading = true;
    let projectQuickCaptureNotice = "";
    let initialWorkItemId: string | null = null;
    let projectViewState: WorkItemViewState | null = null;
    export let loadProjectViewState: () => Promise<WorkItemViewState | null> = async () => null;
    export let saveProjectViewState: (state: WorkItemViewState) => Promise<void> = async () => undefined;
    /** 打开日志面板：按需注入，未注入时按钮只显示未读数提示。 */
    export let openLog: () => void = () => undefined;

    /**
     * 日志未读数（warn/error）。
     * 订阅放在组件里，出问题时头部一直显示"日志"入口的可点击状态与未读数，
     * 使用者不需要知道 DevTools 在哪。
     */
    let unreadLogs = 0;
    const unsubscribeLog = log.subscribe(() => {
        const next = log.stats().unread;
        if (next !== unreadLogs) unreadLogs = next;
    });
    unreadLogs = log.stats().unread;
    onDestroy(unsubscribeLog);

    async function changeModule(next: "projects" | "rhythm", workItemId: string | null = null) {
        if (next === module && !workItemId) return;
        if (module === "rhythm" && dailyRhythm && !(await dailyRhythm.flushAutoSave())) return;
        if (module === "projects" && next === "rhythm") {
            projectViewState = projectApp?.getViewState() ?? projectViewState;
            initialWorkItemId = null;
            if (projectViewState) void saveProjectViewState(projectViewState);
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
            <button class:active={module === "projects"} type="button" on:click={() => void changeModule("projects")}><strong>项目与事务</strong><span>规划、安排与整理</span></button>
            <button class:active={module === "rhythm"} type="button" on:click={() => void changeModule("rhythm")}><strong>生活节律</strong><span>科研、生活与恢复</span></button>
        </nav>
        <div class="xz-shell-actions">
            {#if module === "projects" && projectQuickCaptureNotice}<span class="xz-quick-capture-notice" aria-live="polite">{projectQuickCaptureNotice}</span>{/if}
            <span class="xz-data-source">插件内部数据</span>
            <button
                class="b3-button b3-button--outline xz-log-entry"
                class:xz-log-entry--alert={unreadLogs > 0}
                type="button"
                title={unreadLogs > 0 ? `日志有 ${unreadLogs} 条新警告/错误，点此查看并导出` : "查看、复制或下载插件日志"}
                aria-label={unreadLogs > 0 ? `日志（${unreadLogs} 条新警告或错误）` : "日志"}
                on:click={() => openLog()}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 3.5h8.5L19 8v11.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                    <path d="M14 3.5V8h4.5M8 12h8M8 15.5h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>日志{#if unreadLogs > 0}<span class="xz-log-entry__badge" aria-hidden="true">{unreadLogs > 99 ? "99+" : unreadLogs}</span>{/if}
            </button>
            {#if module === "projects"}
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
                {openImageMenu}
                {openCaptureDialog}
                {openDocument}
                {initialWorkItemId}
                initialViewState={projectViewState}
                loadSavedViewState={loadProjectViewState}
                saveViewState={(state) => void saveProjectViewState(state)}
                {openLog}
            />
        {:else}
            <DailyRhythm bind:this={dailyRhythm} {loadDaily} {saveDaily} {loadChecklist} {saveChecklist} {loadNutrition} {saveNutrition} loadTrendView={loadTrendViewState} saveTrendView={saveTrendViewState} loadWorkItems={load} saveWorkItem={saveItem} openWorkItem={openWorkItemFromRhythm} />
        {/if}
    </div>
</div>
