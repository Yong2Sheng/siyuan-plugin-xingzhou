<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import {
        DAILY_RUBRICS,
        cloneDailyRecord,
        createDailyRecord,
        defaultDayType,
        isWorkMetricApplicable,
        resolveSleepDateTimes,
        type BedtimePreparation,
        type ClosureNeed,
        type DailyDayType,
        type DailyRecord,
        type DailyRecordStore,
        type DailyRubric,
        type PlannedLightsOffDay,
        type PresenceState,
        type ResultState,
        type TriState,
    } from "./daily-records";
    import DurationSelect from "./DurationSelect.svelte";
    import DailyChecklist from "./DailyChecklist.svelte";
    import DailyWorkItemPicker from "./DailyWorkItemPicker.svelte";
    import ScoreInput from "./ScoreInput.svelte";
    import TimeSelect from "./TimeSelect.svelte";
    import NutritionTracker from "./NutritionTracker.svelte";
    import { createEmptyNutritionStore, type NutritionStore } from "./nutrition";
    import { slicesOnDate } from "./execution-slices";
    import { buildWorkItemTree, flattenWorkItemTree } from "./tree";
    import type { WorkItem, WorkItemChanges, WorkItemData } from "./work-items";
    import { createDefaultChecklistStore, type ChecklistStore } from "./checklist";
    import {
        calculateDailyCompletion,
        type DailyCompletionStage,
        type DailyMissingItem,
        type DailyStageCompletion,
    } from "./daily-completion";

    export let loadDaily: () => Promise<DailyRecordStore>;
    export let saveDaily: (record: DailyRecord) => Promise<DailyRecordStore>;
    export let loadWorkItems: (() => Promise<WorkItemData>) | null = null;
    export let saveWorkItem: ((data: WorkItemData, item: WorkItem, changes: WorkItemChanges) => Promise<WorkItemData>) | null = null;
    export let openWorkItem: (workItemId: string) => void = () => undefined;
    export let loadChecklist: () => Promise<ChecklistStore> = async () => createDefaultChecklistStore();
    export let saveChecklist: (store: ChecklistStore) => Promise<ChecklistStore> = async (store) => store;
    export let loadNutrition: () => Promise<NutritionStore> = async () => createEmptyNutritionStore();
    export let saveNutrition: (store: NutritionStore) => Promise<NutritionStore> = async (store) => store;

    type View = "today" | "checklist" | "nutrition" | "history" | "rubrics" | "timeline";
    type Stage = "morning" | "learning" | "boundary" | "after-work" | "recovery" | "evening" | "all";
    const AUTO_SAVE_DELAY_MS = 900;

    const dayTypes: Array<{ value: DailyDayType; label: string; guidance: string }> = [
        { value: "research-workday", label: "科研工作日", guidance: "记录完整科研工作、学习、下班边界和个人生活。" },
        { value: "saturday-reset", label: "周六轻量复盘", guidance: "轻量复盘后进入至少 24 小时完全无工作区间。" },
        { value: "sunday-half-day", label: "周日半日科研", guidance: "上午休息，12:00–17:00 科研，17:00 后回到个人生活。" },
        { value: "holiday", label: "休假／节假日", guidance: "科研字段不适用，只记录身体、恢复、训练、生活与晚间观察。" },
    ];
    const profileRows = [
        ["科研工作日", "周一至周五默认", "早晨安排", "完整科研与工作边界", "晚间复盘"],
        ["周六轻量复盘", "周六默认", "轻量工作复盘", "随后 24 小时无工作", "生活与恢复"],
        ["周日半日科研", "周日默认", "上午不工作", "12:00–17:00 科研", "17:00 后个人生活"],
        ["休假／节假日", "按日期覆盖", "科研字段不适用", "不计入工作达标率", "身体、休息与生活"],
    ];
    const rubricById = Object.fromEntries(DAILY_RUBRICS.map((rubric) => [rubric.id, rubric])) as Record<DailyRubric["id"], DailyRubric>;

    let store: DailyRecordStore | null = null;
    let currentDate = localDateKey();
    let draft = createDailyRecord(currentDate);
    let view: View = "today";
    let stage: Stage = "morning";
    let selectedRubric: DailyRubric = DAILY_RUBRICS[0];
    let loading = true;
    let saving = false;
    let dirty = false;
    let error = "";
    let message = "";
    let workItems: WorkItemData | null = null;
    let workItemsLoading = false;
    let workItemsError = "";
    let editRevision = 0;
    let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    let saveTask: Promise<boolean> | null = null;
    let missingOpen = false;

    $: workApplicable = isWorkMetricApplicable(draft.dayType);
    $: isSaturdayReset = draft.dayType === "saturday-reset";
    $: dayGuidance = dayTypes.find((entry) => entry.value === draft.dayType)?.guidance ?? "";
    $: boundary = calculateBoundary(draft.fields.plannedWorkEndTime, draft.fields.actualWorkEndTime);
    $: resolvedSleep = resolveSleepDateTimes(draft);
    $: completion = calculateDailyCompletion(draft);
    $: morningCompletion = stagePresentation(completion, "morning");
    $: learningCompletion = stagePresentation(completion, "learning");
    $: boundaryCompletion = stagePresentation(completion, "boundary");
    $: afterWorkCompletion = stagePresentation(completion, "after-work");
    $: recoveryCompletion = stagePresentation(completion, "recovery");
    $: eveningCompletion = stagePresentation(completion, "evening");

    Promise.resolve().then(() => void refresh());

    onDestroy(() => {
        clearAutoSaveTimer();
        if (dirty) void saveNow();
    });

    async function refresh() {
        loading = true;
        error = "";
        void refreshWorkItems();
        try {
            applyStore(await loadDaily(), currentDate);
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        } finally {
            loading = false;
        }
    }

    async function refreshWorkItems() {
        if (!loadWorkItems) return;
        workItemsLoading = true;
        workItemsError = "";
        try {
            workItems = await loadWorkItems();
        } catch (caught) {
            workItemsError = `项目与事务读取失败：${caught instanceof Error ? caught.message : String(caught)}`;
        } finally {
            workItemsLoading = false;
        }
    }

    function applyWorkItemChange(event: CustomEvent<{ data: WorkItemData; links: DailyRecord["fields"]["personalProjectLinks"] }>) {
        workItems = event.detail.data;
        draft.fields.personalProjectLinks = event.detail.links.map((link) => ({ ...link }));
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function applyStore(next: DailyRecordStore, date: string) {
        store = next;
        currentDate = date;
        draft = cloneDailyRecord(next.records.find((record) => record.date === date) ?? createDailyRecord(date));
        dirty = false;
    }

    async function openDate(date: string): Promise<boolean> {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
        if (dirty && !(await flushAutoSave())) return false;
        currentDate = date;
        draft = cloneDailyRecord(store?.records.find((record) => record.date === date) ?? createDailyRecord(date));
        dirty = false;
        message = "";
        error = "";
        return true;
    }

    async function shiftDate(days: number) {
        const date = new Date(`${currentDate}T12:00:00`);
        date.setDate(date.getDate() + days);
        await openDate(localDateKey(date));
    }

    function markDirty() {
        dirty = true;
        editRevision += 1;
        message = "";
        error = "";
        scheduleAutoSave();
    }

    function markDailyDirty() {
        if (view === "today") markDirty();
    }

    function scheduleAutoSave() {
        clearAutoSaveTimer();
        autoSaveTimer = setTimeout(() => {
            autoSaveTimer = null;
            void saveNow();
        }, AUTO_SAVE_DELAY_MS);
    }

    function clearAutoSaveTimer() {
        if (autoSaveTimer === null) return;
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
    }

    function changeDayType(dayType: string) {
        if (!dayTypes.some((entry) => entry.value === dayType)) return;
        draft.dayType = dayType as DailyDayType;
        if (dayType === "holiday" && (stage === "learning" || stage === "boundary" || stage === "after-work")) stage = "recovery";
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changeProfessionalStudyPlanned(value: string) {
        if (!["", "yes", "no"].includes(value)) return;
        draft.fields.professionalStudyPlanned = value as PresenceState;
        if (value !== "yes") {
            draft.fields.studyMaterial = "";
            draft.fields.studyTopic = "";
            draft.fields.studyPlan = "";
            draft.fields.studyResult = "";
        }
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changeKeyWorkResult(value: string) {
        const allowed: ResultState[] = ["", "met", "exceeded", "missed", "not-applicable"];
        if (!allowed.includes(value as ResultState)) return;
        draft.fields.keyWorkResult = value as ResultState;
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changeTrainingCompleted(value: string) {
        const allowed: TriState[] = ["", "yes", "no", "not-applicable"];
        if (!allowed.includes(value as TriState)) return;
        draft.fields.trainingCompleted = value as TriState;
        if (value === "no" || value === "not-applicable") draft.fields.trainingPlan = "";
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changeClosureNeed(value: string) {
        const allowed: ClosureNeed[] = ["", "not-needed", "needed"];
        if (!allowed.includes(value as ClosureNeed)) return;
        draft.fields.closureNeed = value as ClosureNeed;
        if (value === "not-needed") {
            draft.fields.closureObject = "";
            draft.fields.closurePlannedMinutes = null;
            draft.fields.closureHasNextStep = "";
            draft.fields.closureNextStep = "";
            draft.fields.closureActualMinutes = null;
        }
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changeClosureHasNextStep(value: string) {
        const allowed: PresenceState[] = ["", "yes", "no"];
        if (!allowed.includes(value as PresenceState)) return;
        draft.fields.closureHasNextStep = value as PresenceState;
        if (value === "no") draft.fields.closureNextStep = "";
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changeHasDayAdjustments(value: string) {
        const allowed: PresenceState[] = ["", "yes", "no"];
        if (!allowed.includes(value as PresenceState)) return;
        draft.fields.hasDayAdjustments = value as PresenceState;
        if (value === "no") draft.fields.dayAdjustments = "";
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changeSaturdayReviewOccurred(value: string) {
        const allowed: PresenceState[] = ["", "yes", "no"];
        if (!allowed.includes(value as PresenceState)) return;
        draft.fields.saturdayReviewOccurred = value as PresenceState;
        if (value === "no") {
            draft.fields.workStartTime = "";
            draft.fields.plannedWorkEndTime = "";
            draft.fields.importantWorkPlan = "";
            draft.fields.actualWorkEndTime = "";
            draft.fields.keyWorkResult = "";
            draft.fields.importantWorkResult = "";
        }
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changeAfterHoursWorkOccurred(value: string) {
        const allowed: PresenceState[] = ["", "yes", "no"];
        if (!allowed.includes(value as PresenceState)) return;
        draft.fields.afterHoursWorkOccurred = value as PresenceState;
        if (value === "no") draft.fields.afterHoursWorkReason = "";
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changeHasAnomalyOrObservation(value: string) {
        const allowed: PresenceState[] = ["", "yes", "no"];
        if (!allowed.includes(value as PresenceState)) return;
        draft.fields.hasAnomalyOrObservation = value as PresenceState;
        if (value === "no") draft.fields.anomalyOrObservation = "";
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changeBedtimePreparation(value: string) {
        const allowed: BedtimePreparation[] = ["", "yes", "no", "free"];
        if (!allowed.includes(value as BedtimePreparation)) return;
        draft.fields.bedtimePreparation = value as BedtimePreparation;
        if (value === "free") {
            draft.fields.plannedLightsOffDay = "";
            draft.fields.plannedLightsOffTime = "";
            draft.fields.plannedLightsOffAt = "";
        } else if (value && !draft.fields.plannedLightsOffDay) {
            draft.fields.plannedLightsOffDay = "same-day";
        }
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changePlannedLightsOffDay(value: string) {
        const allowed: PlannedLightsOffDay[] = ["", "same-day", "next-day"];
        if (!allowed.includes(value as PlannedLightsOffDay)) return;
        draft.fields.plannedLightsOffDay = value as PlannedLightsOffDay;
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    export async function flushAutoSave(): Promise<boolean> {
        clearAutoSaveTimer();
        return dirty ? saveNow() : true;
    }

    function saveNow(): Promise<boolean> {
        clearAutoSaveTimer();
        if (saveTask) return saveTask;
        if (!dirty) return Promise.resolve(true);
        saveTask = saveLoop().finally(() => saveTask = null);
        return saveTask;
    }

    async function saveLoop(): Promise<boolean> {
        saving = true;
        error = "";
        message = "";
        try {
            while (dirty) {
                const revision = editRevision;
                syncPersonalProjectLinks();
                const snapshot = cloneDailyRecord(draft);
                const next = await saveDaily(snapshot);
                store = next;
                if (revision === editRevision) {
                    dirty = false;
                    message = `${formatDate(snapshot.date)} 已自动保存并复核`;
                }
            }
            return true;
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
            return false;
        } finally {
            saving = false;
        }
    }

    function syncPersonalProjectLinks() {
        if (!workItems) return;
        const tree = buildWorkItemTree(workItems.items);
        draft.fields.personalProjectLinks = flattenWorkItemTree(tree)
            .filter((item) => slicesOnDate(item, draft.date).length > 0)
            .map((item) => ({
                workItemId: item.id,
                titleSnapshot: item.title,
                pathSnapshot: workItemPath(item, tree.byId),
                typeSnapshot: item.type,
            }));
        draft = { ...draft, fields: { ...draft.fields } };
    }

    function workItemPath(item: WorkItem, byId: Map<string, WorkItem>): string {
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

    async function changeView(next: View) {
        if (dirty && !(await flushAutoSave())) return;
        view = next;
    }

    async function changeStage(next: Stage) {
        if (dirty && !(await flushAutoSave())) return;
        stage = next;
    }

    function stagePresentation(current: ReturnType<typeof calculateDailyCompletion>, target: DailyCompletionStage) {
        const entry: DailyStageCompletion = current.stages.find((candidate) => candidate.stage === target) ?? {
            stage: target,
            label: target,
            state: "not-started",
            missing: [],
        };
        const statusLabel = entry.state === "complete"
            ? "已完成"
            : entry.state === "not-applicable"
                ? "无需检查"
                : entry.state === "not-started"
                    ? "未开始"
                    : `待补 ${entry.missing.length} 项`;
        const badge = entry.state === "complete"
            ? "✓"
            : entry.state === "not-applicable"
                ? "—"
                : entry.state === "not-started"
                    ? "○"
                    : String(entry.missing.length);
        return { state: entry.state, statusLabel, badge };
    }

    function completionStageLabel(current: ReturnType<typeof calculateDailyCompletion>, target: DailyCompletionStage): string {
        return current.stages.find((candidate) => candidate.stage === target)?.label ?? target;
    }

    async function inspectMissing(item: DailyMissingItem) {
        await changeStage(item.stage);
        if (stage !== item.stage) return;
        missingOpen = false;
        await tick();
        const candidates = [...document.querySelectorAll<HTMLElement>(".xz-daily-record .xz-daily-form-section label, .xz-daily-record .xz-daily-field, .xz-daily-record .xz-daily-score")];
        const target = candidates.find((candidate) => candidate.textContent?.includes(item.focusLabel));
        if (!target) return;
        target.classList.add("xz-daily-field-focus");
        target.scrollIntoView?.({ block: "center", behavior: "smooth" });
        target.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
        window.setTimeout(() => target.classList.remove("xz-daily-field-focus"), 1600);
    }

    async function openHistoryRecord(date: string) {
        if (await openDate(date)) view = "today";
    }

    function inspectRubric(event: CustomEvent<DailyRubric>) {
        selectedRubric = event.detail;
    }

    function scoreDirection(rubric: DailyRubric): string {
        if (rubric.direction === "higher-is-better") return "越高越好";
        if (rubric.direction === "lower-is-better") return "越低越好";
        return "看是否适度且可控";
    }

    function statusFor(record: DailyRecord): string {
        if (!isWorkMetricApplicable(record.dayType)) return "工作指标不适用";
        const result = calculateBoundary(record.fields.plannedWorkEndTime, record.fields.actualWorkEndTime);
        return result?.label ?? "下班边界待填写";
    }

    function localDateKey(date = new Date()): string {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function formatDate(date: string): string {
        const parsed = new Date(`${date}T12:00:00`);
        return `${parsed.getFullYear()} 年 ${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日`;
    }

    function dayTypeLabel(dayType: DailyDayType): string {
        return dayTypes.find((entry) => entry.value === dayType)?.label ?? dayType;
    }

    function shortDateFromLocalDateTime(value: string): string {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return "";
        const date = new Date(`${value.slice(0, 10)}T12:00:00`);
        return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
    }

    function shortDateWithOffset(date: string, days: number): string {
        const parsed = new Date(`${date}T12:00:00`);
        parsed.setDate(parsed.getDate() + days);
        return `${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日`;
    }

    function calculateBoundary(planned: string, actual: string): { late: boolean; difference: number; label: string } | null {
        if (!/^\d{2}:\d{2}$/.test(planned) || !/^\d{2}:\d{2}$/.test(actual)) return null;
        const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
        const difference = toMinutes(actual) - toMinutes(planned);
        return {
            late: difference > 0,
            difference,
            label: difference > 0 ? `超出计划 ${difference} 分钟` : difference === 0 ? "正好按计划下班" : `比计划早 ${Math.abs(difference)} 分钟`,
        };
    }
</script>

<section class="xz-daily-module" on:input={markDailyDirty} on:change={markDailyDirty}>
    <div class="xz-daily-toolbar">
        <div class="xz-daily-date-nav">
            <button type="button" aria-label="前一天" on:click={() => void shiftDate(-1)}>‹</button>
            <input type="date" aria-label="记录日期" value={currentDate} on:change|stopPropagation={(event) => void openDate(event.currentTarget.value)} />
            <button type="button" aria-label="后一天" on:click={() => void shiftDate(1)}>›</button>
            <button type="button" on:click={() => void openDate(localDateKey())}>今天</button>
        </div>
        <nav class="xz-daily-view-nav" aria-label="生活节律视图">
            <button class:active={view === "checklist"} type="button" on:click={() => void changeView("checklist")}>每日 Checklist</button>
            <button class:active={view === "today"} type="button" on:click={() => void changeView("today")}>今日记录</button>
            <button class:active={view === "nutrition"} type="button" on:click={() => void changeView("nutrition")}>营养摄入</button>
            <button class:active={view === "history"} type="button" on:click={() => void changeView("history")}>历史数据</button>
            <button class:active={view === "rubrics"} type="button" on:click={() => void changeView("rubrics")}>评分标准</button>
            <button class:active={view === "timeline"} type="button" on:click={() => void changeView("timeline")}>时间线</button>
        </nav>
    </div>

    {#if loading}
        <div class="xz-state"><span class="xz-spinner"></span><p>正在读取生活节律内部数据……</p></div>
    {:else if error && !store}
        <div class="xz-state xz-error"><h2>暂时无法读取生活节律数据</h2><p>{error}</p><button class="b3-button" type="button" on:click={() => void refresh()}>重试</button></div>
    {:else if view === "nutrition"}
        <NutritionTracker date={currentDate} load={loadNutrition} save={saveNutrition} />
    {:else if view === "today"}
        <div class="xz-daily-context">
            <label><span>今日类型</span><select value={draft.dayType} on:change|stopPropagation={(event) => changeDayType(event.currentTarget.value)}>{#each dayTypes as type}<option value={type.value}>{type.label}</option>{/each}</select></label>
            <p>{dayGuidance} 日期类型可以覆盖每周默认。</p>
        </div>

        <div class="xz-daily-progress" class:holiday={!workApplicable}>
            <div><i>1</i><span><strong>早晨记录</strong><small>{isSaturdayReset ? "睡眠、身体与训练" : "睡眠、身体与科研安排"}</small></span></div>
            {#if workApplicable}
                <div><i>{isSaturdayReset && draft.fields.saturdayReviewOccurred === "no" ? "—" : "2"}</i><span><strong>{isSaturdayReset ? "上午轻量复盘" : "午饭后学习"}</strong><small>{isSaturdayReset ? (draft.fields.saturdayReviewOccurred === "no" ? "今日不复盘" : "回顾、整理与下周计划") : "材料、主题与停点"}</small></span></div>
                <div class:late={boundary?.late}><i>{isSaturdayReset && draft.fields.saturdayReviewOccurred === "no" ? "—" : boundary ? boundary.late ? "×" : "✓" : "3"}</i><span><strong>{isSaturdayReset ? "中午下班" : "工作边界"}</strong><small>{isSaturdayReset && draft.fields.saturdayReviewOccurred === "no" ? "无需填写" : boundary?.label ?? (isSaturdayReset ? "等待中午下班记录" : "等待下班记录")}</small></span></div>
                <div><i>4</i><span><strong>{isSaturdayReset ? "自由时间" : "下班后"}</strong><small>{isSaturdayReset ? "完全离开工作" : "工作闭环与个人事务"}</small></span></div>
            {:else}
                <div><i>2</i><span><strong>恢复与生活</strong><small>科研字段不适用</small></span></div>
            {/if}
            <div><i>{workApplicable ? "5" : "3"}</i><span><strong>21:00 复盘</strong><small>生活结果与明日承接</small></span></div>
        </div>

        <div class="xz-daily-layout">
            <article class="xz-daily-record">
                <header class="xz-daily-record-header">
                    <div><h2>{formatDate(currentDate)}</h2><p>{dayTypeLabel(draft.dayType)} · {store?.records.some((record) => record.date === currentDate) ? "已有记录" : "尚未保存"}</p></div>
                    <div class="xz-daily-header-actions">
                        <div class="xz-daily-completion-summary" aria-live="polite">
                            <div class="xz-daily-stage-legend" aria-label="阶段状态说明"><span><i>○</i>未开始</span><span class="incomplete"><i>1</i>数字表示待补项</span><span class="complete"><i>✓</i>已完成</span><span><i>—</i>无需填写</span></div>
                            <span>完成 <strong>{completion.completedCount}/{completion.applicableCount}</strong>{#if completion.missing.length}<em>待补 {completion.missing.length} 项</em>{:else}<em class="complete">已补齐</em>{/if}</span>
                            <button type="button" class:active={missingOpen} on:click={() => missingOpen = !missingOpen}>{missingOpen ? "收起待补" : "检查待补"}</button>
                        </div>
                        <nav class="xz-daily-stage-nav" aria-label="填写阶段">
                            <button class={`completion-${morningCompletion.state}`} class:active={stage === "morning"} data-completion={morningCompletion.badge} aria-label={`早晨，${morningCompletion.statusLabel}`} title={morningCompletion.statusLabel} type="button" on:click={() => void changeStage("morning")}>早晨</button>
                            {#if workApplicable}<button class={`completion-${learningCompletion.state}`} class:active={stage === "learning"} data-completion={learningCompletion.badge} aria-label={`${isSaturdayReset ? "上午复盘" : "午饭后"}，${learningCompletion.statusLabel}`} title={learningCompletion.statusLabel} type="button" on:click={() => void changeStage("learning")}>{isSaturdayReset ? "上午复盘" : "午饭后"}</button><button class={`completion-${boundaryCompletion.state}`} class:active={stage === "boundary"} data-completion={boundaryCompletion.badge} aria-label={`${isSaturdayReset ? "中午下班" : "下班"}，${boundaryCompletion.statusLabel}`} title={boundaryCompletion.statusLabel} type="button" on:click={() => void changeStage("boundary")}>{isSaturdayReset ? "中午下班" : "下班"}</button><button class={`completion-${afterWorkCompletion.state}`} class:active={stage === "after-work"} data-completion={afterWorkCompletion.badge} aria-label={`${isSaturdayReset ? "自由时间" : "下班后"}，${afterWorkCompletion.statusLabel}`} title={afterWorkCompletion.statusLabel} type="button" on:click={() => void changeStage("after-work")}>{isSaturdayReset ? "自由时间" : "下班后"}</button>{:else}<button class={`completion-${recoveryCompletion.state}`} class:active={stage === "recovery"} data-completion={recoveryCompletion.badge} aria-label={`恢复，${recoveryCompletion.statusLabel}`} title={recoveryCompletion.statusLabel} type="button" on:click={() => void changeStage("recovery")}>恢复</button>{/if}
                            <button class={`completion-${eveningCompletion.state}`} class:active={stage === "evening"} data-completion={eveningCompletion.badge} aria-label={`21:00，${eveningCompletion.statusLabel}`} title={eveningCompletion.statusLabel} type="button" on:click={() => void changeStage("evening")}>21:00</button>
                            <button class:active={stage === "all"} type="button" on:click={() => void changeStage("all")}>全部</button>
                        </nav>
                    </div>
                </header>

                {#if missingOpen}
                    <section class="xz-daily-missing-panel" aria-label="待补项目">
                        <header><div><strong>{completion.missing.length ? `还有 ${completion.missing.length} 项待补` : "今日关键记录已补齐"}</strong><small>{completion.missing.length ? "只检查关键字段；备注和补充说明仍是可选项。" : "普通备注与补充说明无需填写。"}</small></div><button type="button" aria-label="关闭待补项目" on:click={() => missingOpen = false}>×</button></header>
                        {#if completion.missing.length}
                            <div>{#each completion.missing as item (item.stage + item.id)}<button type="button" on:click={() => void inspectMissing(item)}><span>{completionStageLabel(completion, item.stage)}</span><strong>{item.label}</strong><i>›</i></button>{/each}</div>
                        {:else}
                            <p>没有遗漏的关键字段，可以按自己的需要继续补充其他内容。</p>
                        {/if}
                    </section>
                {/if}

                {#if stage === "morning" || stage === "all"}
                    <section class="xz-daily-form-section">
                        <h3>睡眠与身体</h3>
                        <div class="xz-daily-fields three">
                            <div class="xz-daily-field"><span class="xz-daily-label-with-note">昨晚熄灯 {#if resolvedSleep.fields.lightsOffAt}<small>{shortDateFromLocalDateTime(resolvedSleep.fields.lightsOffAt)}</small>{/if}</span><TimeSelect bind:value={draft.fields.lightsOffTime} ariaLabel="昨晚熄灯" /></div>
                            <div class="xz-daily-field"><span class="xz-daily-label-with-note">今日起床 {#if resolvedSleep.fields.wakeAt}<small>{shortDateFromLocalDateTime(resolvedSleep.fields.wakeAt)}</small>{/if}</span><TimeSelect bind:value={draft.fields.wakeTime} ariaLabel="今日起床" /></div>
                            <div class="xz-daily-field"><span>睡眠时长</span><DurationSelect bind:value={draft.fields.sleepDurationMinutes} maxHours={16} ariaLabel="睡眠时长" /></div>
                            <label><span>手表睡眠评分</span><input class="xz-daily-compact-number" type="number" min="0" max="100" bind:value={draft.fields.watchSleepScore} placeholder="未填写" /></label>
                            <ScoreInput bind:value={draft.fields.subjectiveSleepQuality} rubric={rubricById.subjectiveSleepQuality} on:inspect={inspectRubric} on:change={markDirty} />
                            <label><span>晨起体重</span><div class="xz-daily-inline"><input type="number" min="0" step="0.1" bind:value={draft.fields.morningWeight} placeholder="未填写" /><select bind:value={draft.fields.weightUnit}><option value="kg">kg</option><option value="lb">lb</option></select></div></label>
                        </div>
                    </section>
                    <section class="xz-daily-form-section">
                        <h3>今日安排</h3>
                        <div class="xz-daily-fields two">
                            {#if workApplicable && !isSaturdayReset}
                                <div class="xz-daily-field"><span>上班时间</span><TimeSelect bind:value={draft.fields.workStartTime} ariaLabel="上班时间" /></div>
                                <div class="xz-daily-field"><span>计划下班时间</span><TimeSelect bind:value={draft.fields.plannedWorkEndTime} ariaLabel="计划下班时间" /></div>
                                <label><span>今天最重要的工作内容</span><textarea bind:value={draft.fields.importantWorkPlan}></textarea></label>
                            {:else if !workApplicable}
                                <label><span>今天如何休息／个人生活重点</span><textarea bind:value={draft.fields.restAndLifePlan} placeholder="例如：散步、做饭、陪伴家人、完全离开科研"></textarea></label>
                            {/if}
                            <div class="xz-daily-decision-column">
                                <label><span>今日是否有节奏或临时调整</span><select value={draft.fields.hasDayAdjustments} on:change|stopPropagation={(event) => changeHasDayAdjustments(event.currentTarget.value)}><option value="">尚未确认</option><option value="no">否</option><option value="yes">是</option></select></label>
                                {#if draft.fields.hasDayAdjustments === "yes"}<label><span>调整内容</span><textarea bind:value={draft.fields.dayAdjustments} placeholder="记录今天与原计划不同的节奏或临时变化"></textarea></label>{/if}
                            </div>
                            <label class:xz-daily-result-select={draft.fields.trainingCompleted === "yes"}><span>完成训练</span><select value={draft.fields.trainingCompleted} on:change|stopPropagation={(event) => changeTrainingCompleted(event.currentTarget.value)}><option value="">尚未填写</option><option value="yes">✓ 已完成</option><option value="no">× 未完成</option><option value="not-applicable">— 休息日</option></select></label>
                            {#if draft.fields.trainingCompleted === "yes"}<label><span>今天的训练内容</span><textarea bind:value={draft.fields.trainingPlan}></textarea></label>{/if}
                        </div>
                    </section>
                {/if}

                {#if workApplicable && (stage === "learning" || stage === "all")}
                    <section class="xz-daily-form-section">
                        {#if isSaturdayReset}
                            <h3>上午轻量复盘</h3>
                            <p class="xz-daily-closure-note">只做回顾、整理、每周评估与下周计划，不启动复杂任务；用 1–2 小时完成，并在中午前结束。</p>
                            <div class="xz-daily-fields two"><label><span>今天是否进行上午轻量复盘</span><select value={draft.fields.saturdayReviewOccurred} on:change|stopPropagation={(event) => changeSaturdayReviewOccurred(event.currentTarget.value)}><option value="">尚未确认</option><option value="no">否</option><option value="yes">是</option></select></label></div>
                            {#if draft.fields.saturdayReviewOccurred === "yes"}
                                <div class="xz-daily-fields two xz-daily-closure-details">
                                    <div class="xz-daily-field"><span>轻量复盘开始时间</span><TimeSelect bind:value={draft.fields.workStartTime} ariaLabel="轻量复盘开始时间" /></div>
                                    <div class="xz-daily-field"><span>计划结束时间（中午前）</span><TimeSelect bind:value={draft.fields.plannedWorkEndTime} ariaLabel="计划结束时间（中午前）" /></div>
                                    <label><span>今天准备回顾／整理什么</span><textarea bind:value={draft.fields.importantWorkPlan} placeholder="例如：周复盘、整理项目与事务、确定下周三个结果"></textarea></label>
                                </div>
                            {:else if draft.fields.saturdayReviewOccurred === "no"}
                                <p class="xz-daily-closure-note">今天不进行轻量复盘；复盘时间、内容和中午下班记录均按“不适用”保存。</p>
                            {:else}
                                <p class="xz-daily-closure-note">先确认今天是否进行轻量复盘，再填写相应内容。</p>
                            {/if}
                        {:else}
                            <h3>午饭后专业学习安排</h3>
                            <div class="xz-daily-fields two"><label><span>午饭后是否安排专业学习</span><select value={draft.fields.professionalStudyPlanned} on:change|stopPropagation={(event) => changeProfessionalStudyPlanned(event.currentTarget.value)}><option value="">尚未确认</option><option value="no">没有</option><option value="yes">有</option></select></label></div>
                            {#if draft.fields.professionalStudyPlanned === "yes"}
                                <div class="xz-daily-fields two xz-daily-closure-details">
                                    <label><span>书目／材料</span><input bind:value={draft.fields.studyMaterial} /></label>
                                    <label><span>章节／主题</span><input bind:value={draft.fields.studyTopic} /></label>
                                    <label><span>学习安排</span><textarea bind:value={draft.fields.studyPlan}></textarea></label>
                                    <label><span>完成时长与页码／停点</span><textarea bind:value={draft.fields.studyResult}></textarea></label>
                                </div>
                            {:else if draft.fields.professionalStudyPlanned === "no"}
                                <p class="xz-daily-closure-note">午饭后没有专业学习安排，无需填写学习内容。</p>
                            {:else}
                                <p class="xz-daily-closure-note">先确认午饭后是否安排专业学习，再填写相应内容。</p>
                            {/if}
                        {/if}
                    </section>
                {/if}

                {#if workApplicable && (stage === "boundary" || stage === "all")}
                    {#if isSaturdayReset && draft.fields.saturdayReviewOccurred !== "yes"}
                        <section class="xz-daily-form-section">
                            <h3>中午工作边界</h3>
                            <p class="xz-daily-closure-note">{draft.fields.saturdayReviewOccurred === "no" ? "今天未进行轻量复盘，无需填写中午下班时间和工作结果。" : "请先在“上午复盘”中确认今天是否进行轻量复盘。"}</p>
                        </section>
                    {:else}
                    <section class="xz-daily-form-section">
                        <h3>{isSaturdayReset ? "中午工作边界" : "工作时间边界"}</h3>
                        <div class="xz-daily-fields three">
                            <label><span>{isSaturdayReset ? "上午确定的计划结束时间" : "早晨确定的计划下班时间"}</span><output>{draft.fields.plannedWorkEndTime || "未填写"}</output></label>
                            <div class="xz-daily-field"><span>实际下班时间</span><TimeSelect bind:value={draft.fields.actualWorkEndTime} ariaLabel="实际下班时间" /></div>
                            <label><span>下班结果（自动计算）</span><output class:late={boundary?.late} class:good={boundary && !boundary.late}>{boundary ? `${boundary.late ? "×" : "✓"} ${boundary.label}` : "填写两项时间后自动计算"}</output></label>
                        </div>
                    </section>
                    <section class="xz-daily-form-section">
                        <h3>结果与状态评分</h3>
                        <div class="xz-daily-fields two">
                            <label class="xz-daily-result-select"><span>关键工作结果</span><select value={draft.fields.keyWorkResult} on:change|stopPropagation={(event) => changeKeyWorkResult(event.currentTarget.value)}><option value="">尚未填写</option><option value="met">✓ 达标</option><option value="exceeded">★ 超预期</option><option value="missed">× 未达标</option></select></label>
                            <label><span>今天最重要的工作结果</span><textarea bind:value={draft.fields.importantWorkResult}></textarea></label>
                            <ScoreInput bind:value={draft.fields.daytimeEnergy} rubric={rubricById.daytimeEnergy} on:inspect={inspectRubric} on:change={markDirty} />
                            <ScoreInput bind:value={draft.fields.workEfficiency} rubric={rubricById.workEfficiency} on:inspect={inspectRubric} on:change={markDirty} />
                            <ScoreInput bind:value={draft.fields.promotingStress} rubric={rubricById.promotingStress} on:inspect={inspectRubric} on:change={markDirty} />
                            <ScoreInput bind:value={draft.fields.depletingStress} rubric={rubricById.depletingStress} on:inspect={inspectRubric} on:change={markDirty} />
                        </div>
                    </section>
                    {/if}
                {/if}

                {#if workApplicable && (stage === "after-work" || stage === "all")}
                    {#if !isSaturdayReset}<section class="xz-daily-form-section">
                        <h3>下班后工作闭环（按需）</h3>
                        <div class="xz-daily-fields two">
                            <label class="xz-daily-closure-choice">
                                <span>本次是否需要工作闭环</span>
                                <select value={draft.fields.closureNeed} on:change|stopPropagation={(event) => changeClosureNeed(event.currentTarget.value)}>
                                    <option value="">尚未确认</option>
                                    <option value="not-needed">不需要</option>
                                    <option value="needed">需要</option>
                                </select>
                            </label>
                        </div>
                        {#if draft.fields.closureNeed === "needed"}
                            <div class="xz-daily-fields two xz-daily-closure-details">
                                <label><span>对象／材料</span><textarea bind:value={draft.fields.closureObject} placeholder="只记录待整理入口，不在这里展开执行"></textarea></label>
                                <div class="xz-daily-field"><span>预计时间</span><DurationSelect bind:value={draft.fields.closurePlannedMinutes} maxHours={4} ariaLabel="工作闭环预计时间" /></div>
                                <div class="xz-daily-closure-bottom">
                                    <div class="xz-daily-decision-column">
                                        <label><span>是否有下一步安排</span><select value={draft.fields.closureHasNextStep} on:change|stopPropagation={(event) => changeClosureHasNextStep(event.currentTarget.value)}><option value="">尚未确认</option><option value="no">没有</option><option value="yes">有</option></select></label>
                                        {#if draft.fields.closureHasNextStep === "yes"}<label><span>下一步内容</span><textarea bind:value={draft.fields.closureNextStep} placeholder="写清下一步，不开始下一步"></textarea></label>{/if}
                                    </div>
                                    <div class="xz-daily-field"><span>实际闭环时长</span><DurationSelect bind:value={draft.fields.closureActualMinutes} maxHours={4} ariaLabel="工作闭环实际时长" /></div>
                                </div>
                            </div>
                        {:else if draft.fields.closureNeed === "not-needed"}
                            <p class="xz-daily-closure-note">今天不需要下班后工作闭环；相关时间按“不适用”保存，不计为 0 分钟。</p>
                        {:else}
                            <p class="xz-daily-closure-note">确认是否需要闭环后再填写；“尚未确认”表示还没有完成判断。</p>
                        {/if}
                    </section>{/if}
                    <section class="xz-daily-form-section">
                        <h3>{isSaturdayReset ? "自由时间与个人安排" : "下班后个人安排"}</h3>
                        {#if isSaturdayReset}<p class="xz-daily-closure-note">完全无工作区间已经开始；这里只记录个人生活或兴趣事务，不进行科研、专业学习或工作闭环。</p>{/if}
                        <div class="xz-daily-fields two">
                            <div class="xz-daily-personal-project-row">
                                <DailyWorkItemPicker
                                    data={workItems}
                                    date={currentDate}
                                    loading={workItemsLoading}
                                    error={workItemsError}
                                    {saveWorkItem}
                                    {openWorkItem}
                                    on:change={applyWorkItemChange}
                                />
                                <label class="xz-daily-project-note"><span>{isSaturdayReset ? "今日个人事务补充说明（可选）" : "今晚个人事务补充说明（可选）"}</span><textarea bind:value={draft.fields.personalProjectPlan} placeholder={isSaturdayReset ? "可补充今天准备如何休息或推进兴趣事务" : "可补充今晚准备如何推进这些个人事务"}></textarea></label>
                            </div>
                            <div class="xz-daily-field"><span>个人项目实际时长</span><DurationSelect bind:value={draft.fields.personalProjectDurationMinutes} maxHours={12} ariaLabel="个人项目实际时长" /></div>
                        </div>
                    </section>
                {/if}

                {#if !workApplicable && (stage === "recovery" || stage === "all")}
                    <section class="xz-daily-form-section">
                        <h3>恢复与生活</h3>
                        <div class="xz-daily-fields two">
                            <div class="xz-daily-personal-project-row">
                                <DailyWorkItemPicker
                                    data={workItems}
                                    date={currentDate}
                                    loading={workItemsLoading}
                                    error={workItemsError}
                                    {saveWorkItem}
                                    {openWorkItem}
                                    on:change={applyWorkItemChange}
                                />
                                <label class="xz-daily-project-note"><span>今日个人事务补充说明（可选）</span><textarea bind:value={draft.fields.personalProjectPlan} placeholder="可补充今天准备如何推进这些个人事务"></textarea></label>
                            </div>
                            <ScoreInput bind:value={draft.fields.daytimeEnergy} rubric={rubricById.daytimeEnergy} on:inspect={inspectRubric} on:change={markDirty} />
                            <label><span>今天的个人生活或兴趣项目结果</span><textarea bind:value={draft.fields.personalLifeResult}></textarea></label>
                            <div class="xz-daily-field"><span>个人项目实际时长</span><DurationSelect bind:value={draft.fields.personalProjectDurationMinutes} maxHours={12} ariaLabel="个人项目实际时长" /></div>
                        </div>
                    </section>
                {/if}

                {#if stage === "evening" || stage === "all"}
                    <section class="xz-daily-form-section">
                        <h3>21:00 简要复盘</h3>
                        <div class="xz-daily-fields two">
                            {#if workApplicable}<label><span>今天的个人生活或兴趣项目结果</span><textarea bind:value={draft.fields.personalLifeResult}></textarea></label>{/if}
                            <label><span>今天做得最好的一件事</span><textarea bind:value={draft.fields.bestThing}></textarea></label>
                            <label><span>今天最大的阻碍或消耗</span><textarea bind:value={draft.fields.obstacleOrCost}></textarea></label>
                            {#if workApplicable && !isSaturdayReset}<label><span>明天开始工作时的第一个动作</span><textarea bind:value={draft.fields.tomorrowFirstAction}></textarea></label>{/if}
                            {#if workApplicable}
                                <div class="xz-daily-decision-pair">
                                    <div class="xz-daily-decision-column">
                                        <label><span>{isSaturdayReset ? "中午下班后是否接触了工作" : "下班后是否处理了工作"}</span><select value={draft.fields.afterHoursWorkOccurred} on:change|stopPropagation={(event) => changeAfterHoursWorkOccurred(event.currentTarget.value)}><option value="">尚未确认</option><option value="no">否</option><option value="yes">是</option></select></label>
                                        {#if draft.fields.afterHoursWorkOccurred === "yes"}<label><span>处理工作的原因</span><textarea bind:value={draft.fields.afterHoursWorkReason} placeholder={isSaturdayReset ? "记录为什么打破了完全无工作区间" : "记录为什么需要在下班后继续处理工作"}></textarea></label>{/if}
                                    </div>
                                    <div class="xz-daily-decision-column">
                                        <label><span>是否有其他异常或观察需要记录</span><select value={draft.fields.hasAnomalyOrObservation} on:change|stopPropagation={(event) => changeHasAnomalyOrObservation(event.currentTarget.value)}><option value="">尚未确认</option><option value="no">否</option><option value="yes">是</option></select></label>
                                        {#if draft.fields.hasAnomalyOrObservation === "yes"}<label><span>异常或观察内容</span><textarea bind:value={draft.fields.anomalyOrObservation} placeholder="记录今天值得保留的异常、变化或观察"></textarea></label>{/if}
                                    </div>
                                </div>
                            {:else}
                                <label><span>是否有其他异常或观察需要记录</span><select value={draft.fields.hasAnomalyOrObservation} on:change|stopPropagation={(event) => changeHasAnomalyOrObservation(event.currentTarget.value)}><option value="">尚未确认</option><option value="no">否</option><option value="yes">是</option></select></label>
                                {#if draft.fields.hasAnomalyOrObservation === "yes"}<label><span>异常或观察内容</span><textarea bind:value={draft.fields.anomalyOrObservation} placeholder="记录今天值得保留的异常、变化或观察"></textarea></label>{/if}
                            {/if}
                        </div>
                    </section>
                    <section class="xz-daily-form-section">
                        <h3>睡前准备</h3>
                        <div class="xz-daily-fields two">
                            <label><span>今晚的睡前安排</span><select value={draft.fields.bedtimePreparation} on:change|stopPropagation={(event) => changeBedtimePreparation(event.currentTarget.value)}><option value="">尚未选择</option><option value="yes">按计划准备</option><option value="no">不进行睡前准备</option><option value="free">自由安排，不记录计划</option></select></label>
                            {#if draft.fields.bedtimePreparation === "yes" || draft.fields.bedtimePreparation === "no"}
                                <div class="xz-daily-field">
                                    <span class="xz-daily-label-with-note">计划熄灯 {#if resolvedSleep.fields.plannedLightsOffAt}<small>{shortDateFromLocalDateTime(resolvedSleep.fields.plannedLightsOffAt)}</small>{/if}</span>
                                    <div class="xz-daily-lights-off-inline">
                                        <select aria-label="计划熄灯日期" value={draft.fields.plannedLightsOffDay} on:change|stopPropagation={(event) => changePlannedLightsOffDay(event.currentTarget.value)}><option value="same-day">{shortDateWithOffset(currentDate, 0)}（当晚）</option><option value="next-day">{shortDateWithOffset(currentDate, 1)}（次日）</option></select>
                                        <TimeSelect bind:value={draft.fields.plannedLightsOffTime} ariaLabel="计划熄灯时间" />
                                    </div>
                                </div>
                            {:else if draft.fields.bedtimePreparation === "free"}
                                <p class="xz-daily-bedtime-note">今晚自由安排，不设置计划熄灯时间；明早仍可记录实际睡眠。</p>
                            {/if}
                        </div>
                    </section>
                {/if}

                <footer class="xz-daily-save-bar">
                    <div>
                        {#if error}<span class="error" role="alert">自动保存失败：{error}</span>
                        {:else if saving}<span role="status">正在自动保存并复核…</span>
                        {:else if dirty}<span role="status">等待自动保存…</span>
                        {:else if message}<span class="success" role="status">{message}</span>
                        {:else}<span role="status">填写后将自动保存</span>{/if}
                    </div>
                    {#if error}<button class="b3-button" type="button" disabled={saving} on:click={() => void saveNow()}>重试保存</button>{/if}
                </footer>
            </article>

            <aside class="xz-daily-rubric-card">
                <header><h3>评分规则</h3><p>{selectedRubric.label} · {scoreDirection(selectedRubric)}</p></header>
                <ol>{#each selectedRubric.levels as level, index}<li class:active={draft.fields[selectedRubric.id] === index + 1}><b>{index + 1}</b><span>{level}</span></li>{/each}</ol>
                <p class="xz-daily-rubric-note">规则随当前评分字段切换，填写时不必再打开评估表文档。</p>
            </aside>
        </div>
    {:else if view === "checklist"}
        <DailyChecklist date={currentDate} {loadChecklist} {saveChecklist} />
    {:else if view === "history"}
        <section class="xz-daily-list-view">
            <header><div><span class="xz-section-kicker">插件内部数据库</span><h2>历史数据</h2></div><span>{store?.records.length ?? 0} 天</span></header>
            {#if !store?.records.length}<div class="xz-daily-empty"><h3>还没有每日记录</h3><p>从 9 月 3 日开始手动录入即可；这里不会迁移旧文档数据。</p></div>{:else}{#each [...store.records].reverse() as record (record.date)}<button class="xz-daily-history-row" type="button" on:click={() => void openHistoryRecord(record.date)}><strong>{record.date}</strong><span>{dayTypeLabel(record.dayType)}</span><span>睡眠 {record.fields.sleepDurationMinutes === null ? "—" : `${Math.floor(record.fields.sleepDurationMinutes / 60)} 小时 ${record.fields.sleepDurationMinutes % 60} 分`}</span><span>精力 {record.fields.daytimeEnergy ?? "—"}</span><span>{statusFor(record)}</span></button>{/each}{/if}
        </section>
    {:else if view === "rubrics"}
        <section class="xz-daily-list-view">
            <header><div><span class="xz-section-kicker">固定评分口径</span><h2>评分标准</h2></div></header>
            {#each DAILY_RUBRICS as rubric}<article class="xz-daily-rubric-row"><strong>{rubric.label}</strong><span>1 · {rubric.levels[0]}</span><span>3 · {rubric.levels[2]}</span><span>5 · {rubric.levels[4]}</span><em>{scoreDirection(rubric)}</em></article>{/each}
        </section>
    {:else}
        <section class="xz-daily-list-view">
            <header><div><span class="xz-section-kicker">每周默认，可逐日覆盖</span><h2>生活节律时间线</h2></div></header>
            {#each profileRows as row}<article class="xz-daily-timeline-row">{#each row as cell, index}{#if index === 0}<strong>{cell}</strong>{:else}<span>{cell}</span>{/if}{/each}</article>{/each}
        </section>
    {/if}
</section>
