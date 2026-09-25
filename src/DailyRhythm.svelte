<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import {
        DAILY_RUBRICS,
        cloneDailyRecord,
        createDailyRecord,
        defaultDayType,
        deriveLightsOffAdherence,
        isWorkMetricApplicable,
        lightsOffNightInput,
        plannedLightsOffReferenceFromFields,
        previousDayFirstAction,
        resolveSleepDateTimes,
        shiftDateKey,
        sleepLatencyLabel,
        type BedtimePreparation,
        type ClosureNeed,
        type DailyDayType,
        type DailyRecord,
        type DailyRecordStore,
        type DailyRubric,
        type LightsOffAdherence,
        type LightsOffBand,
        type LightsOffTimeSource,
        type PlannedLightsOffDay,
        type PresenceState,
        type ResultState,
        type TriState,
    } from "./daily-records";
    import DurationSelect from "./DurationSelect.svelte";
    import DailyChecklist from "./DailyChecklist.svelte";
    import DailyBoundaryPanel from "./DailyBoundaryPanel.svelte";
    import DailyWorkItemPicker from "./DailyWorkItemPicker.svelte";
    import ScoreInput from "./ScoreInput.svelte";
    import TrendView from "./TrendView.svelte";
    import type { TrendViewSettings } from "./trend-metrics";
    import TimeSelect from "./TimeSelect.svelte";
    import NutritionTracker from "./NutritionTracker.svelte";
    import { createEmptyNutritionStore, type NutritionStore } from "./nutrition";
    import { slicesOnDate } from "./execution-slices";
    import { buildWorkItemTree, flattenWorkItemTree } from "./tree";
    import type { WorkItem, WorkItemChanges, WorkItemData } from "./work-items";
    import { createDefaultChecklistStore, updateChecklistDayState, type ChecklistStore } from "./checklist";
    import { boundaryAttention, boundaryTemplateId } from "./checklist-boundary";
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
    export let checklistEnabled = true;
    export let loadChecklist: () => Promise<ChecklistStore> = async () => createDefaultChecklistStore();
    export let saveChecklist: (store: ChecklistStore) => Promise<ChecklistStore> = async (store) => store;
    export let loadNutrition: () => Promise<NutritionStore> = async () => createEmptyNutritionStore();
    export let saveNutrition: (store: NutritionStore) => Promise<NutritionStore> = async (store) => store;
    export let loadTrendView: () => Promise<TrendViewSettings | null> = async () => null;
    export let saveTrendView: (state: TrendViewSettings) => Promise<void> = async () => undefined;

    type View = "today" | "checklist" | "nutrition" | "history" | "rubrics" | "timeline" | "trends";
    type Stage = "morning" | "learning" | "boundary" | "after-work" | "recovery" | "evening" | "all";
    const AUTO_SAVE_DELAY_MS = 900;
    /** 边界提醒窗口按分钟推进：一分钟一次足够，且不会让页面持续重算。 */
    const BOUNDARY_TICK_MS = 60_000;

    const dayTypes: Array<{ value: DailyDayType; label: string; guidance: string }> = [
        { value: "research-workday", label: "科研工作日", guidance: "记录完整科研工作、学习、下班边界和个人生活。" },
        { value: "conference-day", label: "开会日", guidance: "会议、talk 或合作交流优先；会议结束后再决定是否安排个人事务。" },
        { value: "saturday-reset", label: "周六轻量复盘", guidance: "轻量复盘后进入至少 24 小时完全无工作区间。" },
        { value: "sunday-half-day", label: "周日半日科研", guidance: "上午休息，12:00–17:00 科研，17:00 后回到个人生活。" },
        { value: "holiday", label: "休假／节假日", guidance: "科研字段不适用，只记录身体、恢复、训练、生活与晚间观察。" },
    ];
    const profileRows = [
        ["科研工作日", "周一至周五默认", "早晨安排", "完整科研与工作边界", "晚间复盘"],
        ["开会日", "按日期覆盖", "会议前准备", "会议开始至结束不预设自由时间", "会后再决定个人事务"],
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
    /** 「12 点后 + 不记具体时间」时是否已展开精确时间输入；纯界面状态，不持久化。 */
    let sleepTimeExpanded = false;
    /** 「此刻熄灯」的短暂确认提示与它的定时器。 */
    let lightsOffFlash = "";
    let lightsOffFlashTimer: ReturnType<typeof setTimeout> | null = null;
    /** 必填项挡住自动保存时的提示：说清缺什么，而不是让状态停在「等待自动保存」。 */
    let blockMessage = "";
    /*
     * 边界提醒：checklist 数据由本组件统一持有（面板与 Checklist 视图共用同一份），
     * 避免两个视图各持一份快照、互相用旧数据覆盖。
     */
    let checklistStore: ChecklistStore = createDefaultChecklistStore();
    let checklistLoaded = false;
    let checklistSaving = false;
    let checklistError = "";
    /**
     * 边界提醒的时间基准：初始为挂载时刻，之后每分钟更新一次。
     * 写成状态而不是直接调 Date.now()，是因为 Date.now() 不是响应式的，
     * 时间窗口不会自己推进——必须有一个每分钟变化的值让下面的语句重算。
     */
    let boundaryTick = Date.now();
    let boundaryTimer: ReturnType<typeof setInterval> | null = null;
    /** 供 DailyChecklist 复用的同一份数据；不传 loadChecklist 时它保留自加载行为。 */
    const loadChecklistForView = () => Promise.resolve(checklistStore);
    const saveChecklistForView = (next: ChecklistStore) => saveChecklistStore(next);

    $: workApplicable = isWorkMetricApplicable(draft.dayType);
    $: isSaturdayReset = draft.dayType === "saturday-reset";
    $: isConferenceDay = draft.dayType === "conference-day";
    $: yesterdayFirstAction = previousDayFirstAction(store?.records ?? [], currentDate);
    /** 前一天的记录：昨晚的计划写在它里面，实际熄灯与早晨回答写在当前记录里。 */
    $: previousRecord = store?.records.find((record) => record.date === shiftDateKey(currentDate, -1)) ?? null;
    $: nightInput = lightsOffNightInput(previousRecord, draft);
    $: lightsOffAdherence = deriveLightsOffAdherence(nightInput);
    /** 睡前对照：用本记录自己的计划 + 本记录里当场记录的实际熄灯。 */
    $: tonightCompare = tonightPlan && actualLightsOffRecorded
        ? deriveLightsOffAdherence({ ...nightInput, plannedAt: tonightPlan.plannedAt, time: tonightPlan.time, date: tonightPlan.date, free: false })
        : null;
    $: tonightDiff = tonightCompare?.status === "met" || tonightCompare?.status === "missed"
        ? (tonightCompare.evidence ? lightsOffEvidenceLabel(tonightCompare.evidence.diffMinutes) : "")
        : "";
    /** 只有在判定为「没按计划」时，原因才是必填；守住或不适用都不该拦保存。 */
    $: lightsOffReasonSatisfied = lightsOffAdherence.status !== "missed" || draft.fields.lightsOffAdherenceReason.trim().length > 0;
    /** 实际熄灯是否已登记（当场记录或早期早晨补记都算），决定早晨是否需要人工回答。 */
    $: actualLightsOffRecorded = Boolean(nightInput.actualTime);
    $: plannedLightsOff = previousRecord?.fields.plannedLightsOffAt || "";
    /**
     * 本记录自己登记的计划熄灯（今晚这一夜）。睡前那格的「计划 vs 实际」对照要用它——
     * 实际熄灯属于今晚，计划也写在本记录里，而 nightInput 配的是「昨晚的计划 + 今早的实际」，
     * 两者是不同的夜晚，不能混用。
     */
    $: tonightPlan = plannedLightsOffReferenceFromFields(draft.date, draft.fields);
    $: dayGuidance = dayTypes.find((entry) => entry.value === draft.dayType)?.guidance ?? "";
    $: boundary = calculateBoundary(draft.fields.plannedWorkEndTime, draft.fields.actualWorkEndTime);
    $: resolvedSleep = resolveSleepDateTimes(draft);
    /** 熄灯 → 入睡的实测间隔：只做记录与显示，不参与任何「是否按计划」的判定。 */
    $: sleepLatency = resolvedSleep.fields.sleepLatencyMinutes;
    $: sleepBand = resolvedSleep.fields.lightsOffBand;
    $: completion = calculateDailyCompletion(draft, previousRecord);
    $: morningCompletion = stagePresentation(completion, "morning");
    $: learningCompletion = stagePresentation(completion, "learning");
    $: boundaryCompletion = stagePresentation(completion, "boundary");
    $: afterWorkCompletion = stagePresentation(completion, "after-work");
    $: recoveryCompletion = stagePresentation(completion, "recovery");
    $: eveningCompletion = stagePresentation(completion, "evening");
    /*
     * 边界提醒只依赖这两个字段，因此在数据源变化时只换这两个引用：
     * 模板（含边界时间）来自 templates，勾选状态来自当天 dayStates。
     * 这样面板引用不变时不会触发下面 loadChecklist 的重新读取，避免自我循环。
     */
    $: boundaryTemplates = checklistStore.templates;
    $: boundaryDayState = checklistStore.dayStates.find((state) => state.date === currentDate);
    $: boundaryReminderStates = new Map(Object.entries(boundaryDayState?.reminderStates ?? {}));
    $: boundaryContext = {
        date: currentDate,
        dayType: draft.dayType,
        trainingMode: boundaryDayState?.trainingMode ?? "",
    };
    $: boundaryTemplate = boundaryTemplates.find((candidate) => candidate.id === boundaryTemplateId(boundaryContext.date, boundaryContext.dayType)) ?? boundaryTemplates[0];
    // boundaryTick 每分钟更新一次，因此「现在要确认的」窗口最多滞后一分钟，而不会停在打开页面的那一刻
    $: boundaryAttentionState = boundaryTemplate ? boundaryAttention(boundaryTemplate, boundaryReminderStates, { ...boundaryContext, now: boundaryTick }) : null;

    Promise.resolve().then(() => void refresh());
    Promise.resolve().then(() => void loadChecklistState());
    Promise.resolve().then(() => scheduleBoundaryTick());

    onDestroy(() => {
        clearAutoSaveTimer();
        clearBoundaryTimer();
        if (lightsOffFlashTimer !== null) clearTimeout(lightsOffFlashTimer);
        if (dirty) void saveNow();
    });

    async function loadChecklistState() {
        try {
            checklistStore = await loadChecklist();
            checklistError = "";
        } catch (caught) {
            checklistError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            checklistLoaded = true;
        }
    }

    /**
     * 边界勾选：与 Checklist 视图共用 checklist.json 的当日状态。
     * dayState 以本组件持有的最新快照为基准，避免把别处刚写入的勾选覆盖掉。
     */
    async function saveChecklistStore(next: ChecklistStore): Promise<ChecklistStore> {
        if (checklistSaving) return checklistStore;
        const previous = checklistStore;
        checklistSaving = true;
        checklistError = "";
        checklistStore = next;
        try {
            const saved = await saveChecklist(next);
            checklistStore = saved;
            return saved;
        } catch (caught) {
            checklistStore = previous;
            checklistError = caught instanceof Error ? caught.message : String(caught);
            return previous;
        } finally {
            checklistSaving = false;
        }
    }

    async function toggleBoundary(key: string, completed: boolean) {
        const states = new Map(Object.entries(boundaryDayState?.reminderStates ?? {}));
        if (completed) states.set(key, "completed");
        else states.delete(key);
        try {
            await saveChecklistStore(updateChecklistDayState(checklistStore, currentDate, states, boundaryDayState?.trainingMode ?? ""));
        } catch {
            // saveChecklistStore 已经把错误写进 checklistError，这里只保证不再往外抛
        }
    }

    function scheduleBoundaryTick() {
        boundaryTimer = setInterval(() => {
            boundaryTick = Date.now();
        }, BOUNDARY_TICK_MS);
    }

    function clearBoundaryTimer() {
        if (boundaryTimer === null) return;
        clearInterval(boundaryTimer);
        boundaryTimer = null;
    }

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
        sleepTimeExpanded = false;
        dirty = false;
    }

    async function openDate(date: string): Promise<boolean> {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
        if (dirty && !(await flushAutoSave())) return false;
        currentDate = date;
        draft = cloneDailyRecord(store?.records.find((record) => record.date === date) ?? createDailyRecord(date));
        sleepTimeExpanded = false;
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
        blockMessage = "";
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

    /** 评分与入睡时间同属「手表睡眠数据」：改选「否」时两者一起清掉，避免留下孤儿值。 */
    function changeHasWatchSleepScore(value: string) {
        const allowed: PresenceState[] = ["", "yes", "no"];
        if (!allowed.includes(value as PresenceState)) return;
        draft.fields.hasWatchSleepScore = value as PresenceState;
        if (value !== "yes") {
            draft.fields.watchSleepScore = null;
            draft.fields.watchSleepOnsetTime = "";
            draft.fields.hasWatchSleepOnset = "";
        }
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changeHasMorningWeight(value: string) {
        const allowed: PresenceState[] = ["", "yes", "no"];
        if (!allowed.includes(value as PresenceState)) return;
        draft.fields.hasMorningWeight = value as PresenceState;
        if (value !== "yes") draft.fields.morningWeight = null;
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changePersonalAffairsPlanned(value: string) {
        const allowed: PresenceState[] = ["", "yes", "no"];
        if (!allowed.includes(value as PresenceState)) return;
        draft.fields.personalAffairsPlanned = value as PresenceState;
        if (value !== "yes") {
            draft.fields.personalProjectLinks = [];
            draft.fields.hasPersonalProjectNote = "";
            draft.fields.personalProjectPlan = "";
            draft.fields.personalProjectNoteDraft = "";
            draft.fields.personalProjectDurationMinutes = null;
            draft.fields.personalLifeResult = "";
        }
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    /**
     * 补充说明先做一次是／否判断：选“否”时正文清空但不销毁，改回“是”即可恢复。
     * 正文存 personalProjectPlan，暂存内容存 personalProjectNoteDraft（只在选“否”时保留）。
     */
    function changeHasPersonalProjectNote(value: string) {
        const allowed: PresenceState[] = ["", "yes", "no"];
        if (!allowed.includes(value as PresenceState)) return;
        if (value === "no") {
            draft.fields.personalProjectNoteDraft = draft.fields.personalProjectPlan || draft.fields.personalProjectNoteDraft;
            draft.fields.personalProjectPlan = "";
        } else if (value === "yes") {
            draft.fields.personalProjectPlan = draft.fields.personalProjectPlan || draft.fields.personalProjectNoteDraft;
            draft.fields.personalProjectNoteDraft = "";
        } else {
            draft.fields.personalProjectNoteDraft = "";
        }
        draft.fields.hasPersonalProjectNote = value as PresenceState;
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

    /**
     * 睡前当场记录实际熄灯：归日就是记录日当晚，因此必须同时写上来源标记，
     * 否则解析时会把 22:47 这种时刻当成「昨夜的熄灯」算到前一天去。
     */
    function recordLightsOffNow() {
        const recordDate = currentDate;
        const time = clockTimeNow();
        draft.fields.lightsOffTime = time;
        draft.fields.lightsOffTimeSource = "live";
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
        lightsOffFlash = `${time} 已记入 ${formatDate(recordDate)}`;
        if (lightsOffFlashTimer !== null) clearTimeout(lightsOffFlashTimer);
        lightsOffFlashTimer = setTimeout(() => {
            lightsOffFlash = "";
            lightsOffFlashTimer = null;
        }, 6000);
    }

    /**
     * 手动选时间后显式标注来源。来源由「在哪一格填的」决定，而不是由时刻反推：
     * 睡前准备那一格是关灯前的当场记录（22:47 属于今晚），早晨的「补记时间」是回忆（属于昨晚），
     * 两者跨午夜的归日不同，靠时刻本身无法区分。清空后必须去掉来源标记，
     * 否则凌晨时刻会被算到错误的一天。
     */
    function markLightsOffSource() {
        const source: LightsOffTimeSource = stage === "evening" ? "live" : "recalled";
        draft.fields.lightsOffTimeSource = /^\d{2}:\d{2}$/.test(draft.fields.lightsOffTime) ? source : "";
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    /** 只有熬夜标记、没有时刻的存量记录：展开一次时间输入来补记。 */
    function expandLightsOffTime() {
        sleepTimeExpanded = true;
    }

    /** 早晨的人工回答：只在系统无法从实际熄灯推导时才出现。 */
    function changeLightsOffAdherence(value: string) {
        if (!["", "yes", "no"].includes(value)) return;
        draft.fields.lightsOffAdherence = value as LightsOffAdherence;
        if (value !== "no") draft.fields.lightsOffAdherenceReason = "";
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    /** 撤销当天的人工回答，交还给自动判定（实测不为空时立刻重新算出结论）。 */
    function resetLightsOffAdherence() {
        draft.fields.lightsOffAdherence = "";
        draft.fields.lightsOffAdherenceReason = "";
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function clockTimeNow(): string {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
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
                /*
                 * 没按计划的原因必填：与「未知」的外键引用不同，这里缺的是一句人能马上补齐的话，
                 * 因此不落库、保留 dirty 等用户填写，同时把原因说清楚，避免看起来「保存失灵」。
                 */
                if (!lightsOffReasonSatisfied) {
                    blockMessage = "请先填写「没按计划的原因」，保存会等你写完这句。";
                    return false;
                }
                blockMessage = "";
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
        if (draft.dayType === "conference-day" && draft.fields.personalAffairsPlanned !== "yes") {
            draft.fields.personalProjectLinks = [];
            draft = { ...draft, fields: { ...draft.fields } };
            return;
        }
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
        const focusTarget = target.querySelector<HTMLElement>("[data-missing-focus]") ?? target;
        focusTarget.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
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

    /** 实测熄灯与计划的差值文案；早于计划不算违规，因此单独说「早」。 */
    function lightsOffEvidenceLabel(diffMinutes: number): string {
        if (diffMinutes === 0) return "正好按计划熄灯";
        return diffMinutes > 0 ? `晚 ${diffMinutes} 分钟` : `早 ${Math.abs(diffMinutes)} 分钟`;
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
            <button class:active={view === "trends"} type="button" on:click={() => void changeView("trends")}>趋势</button>
        </nav>
    </div>

    {#if loading}
        <div class="xz-state"><span class="xz-spinner"></span><p>正在读取生活节律内部数据……</p></div>
    {:else if error && !store}
        <div class="xz-state xz-error"><h2>暂时无法读取生活节律数据</h2><p>{error}</p><button class="b3-button" type="button" on:click={() => void refresh()}>重试</button></div>
    {:else if view === "nutrition"}
        {#if isConferenceDay}
            <div class="xz-state"><h2>开会日不记录营养摄入</h2><p>会议期间在外进食不可控，当天无需估算或补录；已有营养记录会原样保留。</p></div>
        {:else}
            <NutritionTracker date={currentDate} load={loadNutrition} save={saveNutrition} />
        {/if}
    {:else if view === "today"}
        <div class="xz-daily-context">
            <label><span>今日类型</span><select value={draft.dayType} on:change|stopPropagation={(event) => changeDayType(event.currentTarget.value)}>{#each dayTypes as type}<option value={type.value}>{type.label}</option>{/each}</select></label>
            <p>{dayGuidance} 日期类型可以覆盖每周默认。</p>
        </div>

        <div class="xz-daily-progress" class:holiday={!workApplicable}>
            <div><i>1</i><span><strong>早晨记录</strong><small>{isSaturdayReset ? "睡眠、身体与训练" : isConferenceDay ? "睡眠、身体与会议安排" : "睡眠、身体与科研安排"}</small></span></div>
            {#if workApplicable}
                <div><i>{isSaturdayReset && draft.fields.saturdayReviewOccurred === "no" ? "—" : "2"}</i><span><strong>{isSaturdayReset ? "上午轻量复盘" : "午饭后学习"}</strong><small>{isSaturdayReset ? (draft.fields.saturdayReviewOccurred === "no" ? "今日不复盘" : "回顾、整理与下周计划") : "材料、主题与停点"}</small></span></div>
                <div class:late={!isConferenceDay && boundary?.late}><i>{isSaturdayReset && draft.fields.saturdayReviewOccurred === "no" ? "—" : isConferenceDay ? (draft.fields.actualWorkEndTime ? "✓" : "3") : boundary ? boundary.late ? "×" : "✓" : "3"}</i><span><strong>{isSaturdayReset ? "中午下班" : isConferenceDay ? "会议结束" : "工作边界"}</strong><small>{isSaturdayReset && draft.fields.saturdayReviewOccurred === "no" ? "无需填写" : isConferenceDay ? (draft.fields.actualWorkEndTime ? "已记录实际结束时间" : "等待会议结束") : boundary?.label ?? (isSaturdayReset ? "等待中午下班记录" : "等待下班记录")}</small></span></div>
                <div><i>4</i><span><strong>{isSaturdayReset ? "自由时间" : isConferenceDay ? "会后" : "下班后"}</strong><small>{isSaturdayReset ? "完全离开工作" : isConferenceDay ? "工作闭环与晚间选择" : "工作闭环与个人事务"}</small></span></div>
            {:else}
                <div><i>2</i><span><strong>恢复与生活</strong><small>科研字段不适用</small></span></div>
            {/if}
            <div><i>{workApplicable ? "5" : "3"}</i><span><strong>21:00 复盘</strong><small>生活结果与明日承接</small></span></div>
        </div>

        {#if checklistEnabled && checklistLoaded && boundaryAttentionState && boundaryAttentionState.totalCount}
            <DailyBoundaryPanel
                attention={boundaryAttentionState}
                saving={checklistSaving}
                error={checklistError}
                isToday={currentDate === localDateKey()}
                onToggle={(key, completed) => void toggleBoundary(key, completed)}
                onOpenChecklist={() => void changeView("checklist")}
            />
        {/if}

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
                            {#if workApplicable}<button class={`completion-${learningCompletion.state}`} class:active={stage === "learning"} data-completion={learningCompletion.badge} aria-label={`${isSaturdayReset ? "上午复盘" : "午饭后"}，${learningCompletion.statusLabel}`} title={learningCompletion.statusLabel} type="button" on:click={() => void changeStage("learning")}>{isSaturdayReset ? "上午复盘" : "午饭后"}</button><button class={`completion-${boundaryCompletion.state}`} class:active={stage === "boundary"} data-completion={boundaryCompletion.badge} aria-label={`${isSaturdayReset ? "中午下班" : isConferenceDay ? "会议结束" : "下班"}，${boundaryCompletion.statusLabel}`} title={boundaryCompletion.statusLabel} type="button" on:click={() => void changeStage("boundary")}>{isSaturdayReset ? "中午下班" : isConferenceDay ? "会议结束" : "下班"}</button><button class={`completion-${afterWorkCompletion.state}`} class:active={stage === "after-work"} data-completion={afterWorkCompletion.badge} aria-label={`${isSaturdayReset ? "自由时间" : isConferenceDay ? "会后" : "下班后"}，${afterWorkCompletion.statusLabel}`} title={afterWorkCompletion.statusLabel} type="button" on:click={() => void changeStage("after-work")}>{isSaturdayReset ? "自由时间" : isConferenceDay ? "会后" : "下班后"}</button>{:else}<button class={`completion-${recoveryCompletion.state}`} class:active={stage === "recovery"} data-completion={recoveryCompletion.badge} aria-label={`恢复，${recoveryCompletion.statusLabel}`} title={recoveryCompletion.statusLabel} type="button" on:click={() => void changeStage("recovery")}>恢复</button>{/if}
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
                        <div class="xz-daily-fields xz-sleep">
                            <!-- 回顾横条：昨晚的计划与达成结论（只读事实），与下面的填写区分开 -->
                            <div class="xz-daily-review" class:is-met={lightsOffAdherence.status === "met"} class:is-missed={lightsOffAdherence.status === "missed"} class:is-none={!plannedLightsOff}>
                                <div class="xz-daily-review__plan">
                                    <span>昨晚计划</span>
                                    {#if nightInput.time}
                                        <strong>{nightInput.time}</strong>
                                        <small>{shortDateFromLocalDateTime(plannedLightsOff)} 当晚</small>
                                    {:else}
                                        <strong>未登记</strong>
                                    {/if}
                                </div>
                                <div class="xz-daily-review__verdict">
                                    {#if !plannedLightsOff}
                                        <strong>不适用</strong>
                                        <span>{previousRecord?.fields.bedtimePreparation === "free" ? "昨晚是自由安排，没有登记计划熄灯，不计入达成率" : "昨晚没有登记计划熄灯，这一晚不计入达成率"}</span>
                                    {:else if lightsOffAdherence.status === "met" || lightsOffAdherence.status === "missed"}
                                        <strong>{lightsOffAdherence.status === "met" ? "是" : "否"}</strong>
                                        <span>{lightsOffAdherence.status === "met" ? "按计划熄灯" : "没有按计划熄灯"}</span>
                                        {#if lightsOffAdherence.evidence}
                                            <small>{lightsOffEvidenceLabel(lightsOffAdherence.evidence.diffMinutes)}（睡前当场记录）</small>
                                        {:else}
                                            <small>由你回答</small>
                                        {/if}
                                    {:else}
                                        <span>还没有回答是否按计划熄灯</span>
                                    {/if}
                                </div>
                                {#if actualLightsOffRecorded}
                                    <div class="xz-daily-review__actual" data-missing-focus>
                                        <span>实际</span><strong>{draft.fields.lightsOffTime}</strong>
                                        <button class="xz-daily-review__edit" type="button" on:click={() => (sleepTimeExpanded = !sleepTimeExpanded)}>{sleepTimeExpanded ? "收起" : "改"}</button>
                                        {#if sleepTimeExpanded}
                                            <TimeSelect bind:value={draft.fields.lightsOffTime} ariaLabel="实际熄灯" clearable on:change={markLightsOffSource} />
                                        {/if}
                                    </div>
                                {/if}
                            </div>

                            <!-- 需要回答 / 需要补记：可编辑行，跟在回顾横条下面 -->
                            {#if plannedLightsOff && !actualLightsOffRecorded && lightsOffAdherence.status !== "met" && lightsOffAdherence.status !== "missed"}
                                <div class="xz-daily-adherence-row">
                                    <span class="xz-daily-label-with-note">昨晚我按计划熄灯了吗</span>
                                    <select class="xz-daily-adherence" aria-label="昨晚我按计划熄灯了吗" value={draft.fields.lightsOffAdherence} on:change|stopPropagation={(event) => changeLightsOffAdherence(event.currentTarget.value)}>
                                        <option value="">尚未回答</option>
                                        <option value="yes">是，按计划熄灯</option>
                                        <option value="no">否，没有按计划熄灯</option>
                                    </select>
                                    <p class="xz-daily-verdict-status">前一晚没有按「此刻熄灯」，也没有可对照的实际时刻，所以这里要你自己回答一次。</p>
                                </div>
                            {/if}
                            {#if plannedLightsOff && !actualLightsOffRecorded && sleepBand && !sleepTimeExpanded}
                                <div class="xz-daily-adherence-row">
                                    <div class="xz-daily-lights-off-skip"><span>{sleepBand === "after-midnight" ? "只标了「12 点后」，没有具体时刻" : "只标了「12 点前」，没有具体时刻"}</span><button type="button" on:click={expandLightsOffTime}>补记时间</button></div>
                                </div>
                            {/if}
                            {#if sleepTimeExpanded && !actualLightsOffRecorded}
                                <div class="xz-daily-adherence-row">
                                    <span class="xz-daily-label-with-note">昨晚实际熄灯 <small>回忆补记</small></span>
                                    <TimeSelect bind:value={draft.fields.lightsOffTime} ariaLabel="实际熄灯" clearable on:change={markLightsOffSource} />
                                </div>
                            {/if}
                            {#if plannedLightsOff && lightsOffAdherence.status === "missed"}
                                <label class="xz-daily-adherence-reason"><span>没按计划的原因 <b>（必填）</b></span><textarea bind:value={draft.fields.lightsOffAdherenceReason} placeholder="例如：小说写到一半没停下来 / 临时处理了一条紧急的事"></textarea></label>
                            {/if}

                            <!-- 填写区：今早的指标与手表数据 -->
                            <div class="xz-daily-sleep-fill">
                                <div class="xz-daily-field xz-sleep-wake"><span class="xz-daily-label-with-note">今日起床 {#if resolvedSleep.fields.wakeAt}<small>{shortDateFromLocalDateTime(resolvedSleep.fields.wakeAt)}</small>{/if}</span><TimeSelect bind:value={draft.fields.wakeTime} ariaLabel="今日起床" /></div>
                                <div class="xz-daily-decision-column xz-sleep-weight">
                                    <label><span>今天是否测量晨起体重</span><select value={draft.fields.hasMorningWeight} on:change|stopPropagation={(event) => changeHasMorningWeight(event.currentTarget.value)}><option value="">尚未确认</option><option value="yes">是</option><option value="no">否</option></select></label>
                                    {#if draft.fields.hasMorningWeight === "yes"}<label><span>晨起体重</span><div class="xz-daily-inline"><input type="number" min="0" step="0.1" bind:value={draft.fields.morningWeight} placeholder="未填写" /><select bind:value={draft.fields.weightUnit}><option value="kg">kg</option><option value="lb">lb</option></select></div></label>{:else if draft.fields.hasMorningWeight === "no"}<p class="xz-daily-field-note">今天没有测量条件，无需填写。</p>{/if}
                                </div>
                                <!-- 手表一栏：睡眠时长（趋势里就叫「手表实际睡眠」）、评分、入睡时间都是同一块手表给出的数据，
                                     放在一起才看得出「熄灯 → 入睡 → 实际睡了多久」是一条链。 -->
                                <div class="xz-daily-decision-column xz-daily-watch-group xz-sleep-watch">
                                    <header><strong>手表睡眠数据</strong><span>时长、评分与入睡时间同源</span></header>
                                    <label><span>今天是否有手表睡眠数据</span><select aria-label="今天是否有手表睡眠数据" value={draft.fields.hasWatchSleepScore} on:change|stopPropagation={(event) => changeHasWatchSleepScore(event.currentTarget.value)}><option value="">尚未确认</option><option value="yes">是</option><option value="no">否</option></select></label>
                                    {#if draft.fields.hasWatchSleepScore === "yes"}
                                        <div class="xz-daily-field"><span>睡眠时长 <small>手表实际睡眠</small></span><DurationSelect bind:value={draft.fields.sleepDurationMinutes} maxHours={16} ariaLabel="睡眠时长" /></div>
                                        <label><span>手表睡眠评分</span><input class="xz-daily-compact-number" type="number" min="0" max="100" bind:value={draft.fields.watchSleepScore} placeholder="未填写" /></label>
                                        <div class="xz-daily-field">
                                            <span class="xz-daily-label-with-note">手表入睡时间 <small>记录用</small></span>
                                            <TimeSelect bind:value={draft.fields.watchSleepOnsetTime} ariaLabel="手表入睡时间" />
                                        </div>
                                        {#if sleepLatency !== null}
                                            <p class="xz-daily-onset-note">
                                                {draft.fields.lightsOffTime} → {draft.fields.watchSleepOnsetTime} · 躺下后 {sleepLatencyLabel(sleepLatency)} 睡着
                                                <em>入睡不受意志直接控制，只做记录，不参与是否按计划的评价。</em>
                                            </p>
                                        {:else}
                                            <p class="xz-daily-field-note">入睡时间只做记录，不参与是否按计划的评价。</p>
                                        {/if}
                                    {:else if draft.fields.hasWatchSleepScore === "no"}
                                        <p class="xz-daily-field-note">今天没有手表数据，睡眠时长、评分与入睡时间都无需填写。</p>
                                    {/if}
                                </div>
                                <div class="xz-daily-score xz-sleep-quality"><ScoreInput bind:value={draft.fields.subjectiveSleepQuality} rubric={rubricById.subjectiveSleepQuality} on:inspect={inspectRubric} on:change={markDirty} /></div>
                            </div>
                        </div>
                    </section>
                {/if}

                {#if stage === "morning" || stage === "all"}
                    <section class="xz-daily-form-section">
                        <h3>今日安排</h3>
                        {#if yesterdayFirstAction}
                            <p class="xz-daily-yesterday-hint">昨晚记录 · 明天开始工作时的第一个动作：{yesterdayFirstAction}</p>
                        {/if}
                        <div class="xz-daily-fields xz-daily-flow-columns">
                            <div class="xz-daily-flow-column">
                                {#if workApplicable && !isSaturdayReset}
                                    <div class="xz-daily-time-pair">
                                        <div class="xz-daily-field xz-daily-flow-start"><span>{isConferenceDay ? "会议开始时间" : "上班时间"}</span><TimeSelect bind:value={draft.fields.workStartTime} ariaLabel={isConferenceDay ? "会议开始时间" : "上班时间"} /></div>
                                        <div class="xz-daily-field xz-daily-flow-end"><span>{isConferenceDay ? "预计会议结束时间（可选）" : "计划下班时间"}</span><TimeSelect bind:value={draft.fields.plannedWorkEndTime} ariaLabel={isConferenceDay ? "预计会议结束时间" : "计划下班时间"} /></div>
                                    </div>
                                    <label class="xz-daily-flow-primary"><span>{isConferenceDay ? "今天最重要的会议／工作内容" : "今天最重要的工作内容"}</span><textarea bind:value={draft.fields.importantWorkPlan}></textarea></label>
                                {:else if !workApplicable}
                                    <label class="xz-daily-flow-primary"><span>今天如何休息／个人生活重点</span><textarea bind:value={draft.fields.restAndLifePlan} placeholder="例如：散步、做饭、陪伴家人、完全离开科研"></textarea></label>
                                {/if}
                                <div class="xz-daily-decision-column xz-daily-flow-training">
                                    <label class:xz-daily-result-select={draft.fields.trainingCompleted === "yes"}><span>完成训练</span><select value={draft.fields.trainingCompleted} on:change|stopPropagation={(event) => changeTrainingCompleted(event.currentTarget.value)}><option value="">尚未填写</option><option value="yes">✓ 已完成</option><option value="no">× 未完成</option><option value="not-applicable">— 休息日</option></select></label>
                                    {#if draft.fields.trainingCompleted === "yes"}<label><span>今天的训练内容</span><textarea bind:value={draft.fields.trainingPlan}></textarea></label>{/if}
                                </div>
                            </div>
                            <div class="xz-daily-flow-column">
                                <div class="xz-daily-decision-column xz-daily-flow-adjustments">
                                <label><span>今日是否有节奏或临时调整</span><select value={draft.fields.hasDayAdjustments} on:change|stopPropagation={(event) => changeHasDayAdjustments(event.currentTarget.value)}><option value="">尚未确认</option><option value="no">否</option><option value="yes">是</option></select></label>
                                {#if draft.fields.hasDayAdjustments === "yes"}<label><span>调整内容</span><textarea bind:value={draft.fields.dayAdjustments} placeholder="记录今天与原计划不同的节奏或临时变化"></textarea></label>{/if}
                                </div>
                            </div>
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
                        <h3>{isSaturdayReset ? "中午工作边界" : isConferenceDay ? "会议结束记录" : "工作时间边界"}</h3>
                        <div class="xz-daily-fields three">
                            <label><span>{isSaturdayReset ? "上午确定的计划结束时间" : isConferenceDay ? "预计会议结束时间（可选）" : "早晨确定的计划下班时间"}</span><output>{draft.fields.plannedWorkEndTime || "未填写"}</output></label>
                            <div class="xz-daily-field"><span>{isConferenceDay ? "会议实际结束时间" : "实际下班时间"}</span><TimeSelect bind:value={draft.fields.actualWorkEndTime} ariaLabel={isConferenceDay ? "会议实际结束时间" : "实际下班时间"} /></div>
                            <label><span>{isConferenceDay ? "会议结束说明" : "下班结果（自动计算）"}</span><output class:late={!isConferenceDay && boundary?.late} class:good={isConferenceDay ? Boolean(draft.fields.actualWorkEndTime) : boundary && !boundary.late}>{isConferenceDay ? (draft.fields.actualWorkEndTime ? "✓ 已记录；开会日不评价是否超时" : "会议结束后记录实际时间") : boundary ? `${boundary.late ? "×" : "✓"} ${boundary.label}` : "填写两项时间后自动计算"}</output></label>
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
                        <h3>{isConferenceDay ? "会议结束后工作闭环（按需）" : "下班后工作闭环（按需）"}</h3>
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
                        <h3>{isSaturdayReset ? "自由时间与个人安排" : isConferenceDay ? "会后个人事务" : "下班后个人安排"}</h3>
                        {#if isSaturdayReset}<p class="xz-daily-closure-note">完全无工作区间已经开始；这里只记录个人生活或兴趣事务，不进行科研、专业学习或工作闭环。</p>{/if}
                        {#if isConferenceDay}
                            <div class="xz-daily-fields two">
                                <label><span>会后是否安排个人事务</span><select value={draft.fields.personalAffairsPlanned} on:change|stopPropagation={(event) => changePersonalAffairsPlanned(event.currentTarget.value)}><option value="">尚未确认</option><option value="no">不安排</option><option value="yes">安排</option></select></label>
                            </div>
                            {#if draft.fields.personalAffairsPlanned === "yes"}
                                <div class="xz-daily-fields two xz-daily-closure-details">
                                    <div class="xz-daily-personal-decision">
                                        <label><span>会后是否有个人事务补充说明</span><select value={draft.fields.hasPersonalProjectNote} on:change|stopPropagation={(event) => changeHasPersonalProjectNote(event.currentTarget.value)}><option value="">尚未确认</option><option value="yes">是</option><option value="no">否</option></select></label>
                                        {#if draft.fields.hasPersonalProjectNote === "yes"}
                                            <label class="xz-daily-project-note"><span>会后个人事务补充说明</span><textarea bind:value={draft.fields.personalProjectPlan} placeholder="可补充会议结束后准备如何安排个人事务"></textarea></label>
                                        {:else if draft.fields.hasPersonalProjectNote === "no"}
                                            <p class="xz-daily-closure-note">已选择“否”，不写补充说明；会议结束后的安排仍以上方“今日个人安排”为准。</p>
                                        {:else}
                                            <p class="xz-daily-closure-note">先确认是否需要补充说明，再决定是否填写。</p>
                                        {/if}
                                    </div>
                                    <DailyWorkItemPicker data={workItems} date={currentDate} loading={workItemsLoading} error={workItemsError} {saveWorkItem} {openWorkItem} on:change={applyWorkItemChange} />
                                    <div class="xz-daily-field"><span>个人项目实际时长</span><DurationSelect bind:value={draft.fields.personalProjectDurationMinutes} maxHours={12} ariaLabel="个人项目实际时长" /></div>
                                </div>
                            {:else if draft.fields.personalAffairsPlanned === "no"}
                                <p class="xz-daily-closure-note">今晚用于同事活动、社交或休息，不安排个人事务，无需填写相关计划和时长。</p>
                            {:else}
                                <p class="xz-daily-closure-note">等会议结束后再决定；会议期间不预设自由时间。</p>
                            {/if}
                        {:else}
                            <div class="xz-daily-fields two">
                                <div class="xz-daily-personal-decision">
                                    <label><span>{isSaturdayReset ? "今日是否有个人事务补充说明" : "今晚是否有个人事务补充说明"}</span><select value={draft.fields.hasPersonalProjectNote} on:change|stopPropagation={(event) => changeHasPersonalProjectNote(event.currentTarget.value)}><option value="">尚未确认</option><option value="yes">是</option><option value="no">否</option></select></label>
                                    {#if draft.fields.hasPersonalProjectNote === "yes"}
                                        <label class="xz-daily-project-note"><span>{isSaturdayReset ? "今日个人事务补充说明" : "今晚个人事务补充说明"}</span><textarea bind:value={draft.fields.personalProjectPlan} placeholder={isSaturdayReset ? "可补充今天准备如何休息或推进兴趣事务" : "可补充今晚准备如何推进这些个人事务"}></textarea></label>
                                    {:else if draft.fields.hasPersonalProjectNote === "no"}
                                        <p class="xz-daily-closure-note">已选择“否”，不写补充说明；{isSaturdayReset ? "今天" : "今晚"}的安排仍以上方“今日个人安排”为准。</p>
                                    {:else}
                                        <p class="xz-daily-closure-note">先确认是否需要补充说明，再决定是否填写。</p>
                                    {/if}
                                </div>
                                <DailyWorkItemPicker data={workItems} date={currentDate} loading={workItemsLoading} error={workItemsError} {saveWorkItem} {openWorkItem} on:change={applyWorkItemChange} />
                                <div class="xz-daily-field"><span>个人项目实际时长</span><DurationSelect bind:value={draft.fields.personalProjectDurationMinutes} maxHours={12} ariaLabel="个人项目实际时长" /></div>
                            </div>
                        {/if}
                    </section>
                {/if}

                {#if !workApplicable && (stage === "recovery" || stage === "all")}
                    <section class="xz-daily-form-section">
                        <h3>恢复与生活</h3>
                        <div class="xz-daily-fields two">
                            <div class="xz-daily-personal-decision">
                                <label><span>今日是否有个人事务补充说明</span><select value={draft.fields.hasPersonalProjectNote} on:change|stopPropagation={(event) => changeHasPersonalProjectNote(event.currentTarget.value)}><option value="">尚未确认</option><option value="yes">是</option><option value="no">否</option></select></label>
                                {#if draft.fields.hasPersonalProjectNote === "yes"}
                                    <label class="xz-daily-project-note"><span>今日个人事务补充说明</span><textarea bind:value={draft.fields.personalProjectPlan} placeholder="可补充今天准备如何推进这些个人事务"></textarea></label>
                                {:else if draft.fields.hasPersonalProjectNote === "no"}
                                    <p class="xz-daily-closure-note">已选择“否”，不写补充说明；今天的安排仍以上方“今日个人安排”为准。</p>
                                {:else}
                                    <p class="xz-daily-closure-note">先确认是否需要补充说明，再决定是否填写。</p>
                                {/if}
                            </div>
                            <DailyWorkItemPicker
                                data={workItems}
                                date={currentDate}
                                loading={workItemsLoading}
                                error={workItemsError}
                                {saveWorkItem}
                                {openWorkItem}
                                on:change={applyWorkItemChange}
                            />
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
                            {#if workApplicable && (!isConferenceDay || draft.fields.personalAffairsPlanned === "yes")}<label><span>今天的个人生活或兴趣项目结果</span><textarea bind:value={draft.fields.personalLifeResult}></textarea></label>{/if}
                            <label><span>今天做得最好的一件事</span><textarea bind:value={draft.fields.bestThing}></textarea></label>
                            <label><span>今天最大的阻碍或消耗</span><textarea bind:value={draft.fields.obstacleOrCost}></textarea></label>
                            {#if workApplicable && !isSaturdayReset}<label><span>明天开始工作时的第一个动作</span><textarea bind:value={draft.fields.tomorrowFirstAction}></textarea></label>{/if}
                            {#if workApplicable}
                                <div class="xz-daily-decision-pair">
                                    <div class="xz-daily-decision-column">
                                        <label><span>{isSaturdayReset ? "中午下班后是否接触了工作" : isConferenceDay ? "会议结束后是否继续处理工作" : "下班后是否处理了工作"}</span><select value={draft.fields.afterHoursWorkOccurred} on:change|stopPropagation={(event) => changeAfterHoursWorkOccurred(event.currentTarget.value)}><option value="">尚未确认</option><option value="no">否</option><option value="yes">是</option></select></label>
                                        {#if draft.fields.afterHoursWorkOccurred === "yes"}<label><span>处理工作的原因</span><textarea bind:value={draft.fields.afterHoursWorkReason} placeholder={isSaturdayReset ? "记录为什么打破了完全无工作区间" : isConferenceDay ? "记录会议结束后仍需继续处理工作的原因" : "记录为什么需要在下班后继续处理工作"}></textarea></label>{/if}
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
                            <label><span>今晚的睡前安排</span><select aria-label="今晚的睡前安排" value={draft.fields.bedtimePreparation} on:change|stopPropagation={(event) => changeBedtimePreparation(event.currentTarget.value)}><option value="">尚未选择</option><option value="yes">按计划准备</option><option value="no">不进行睡前准备</option><option value="free">自由安排，不记录计划</option></select></label>
                            {#if draft.fields.bedtimePreparation === "yes" || draft.fields.bedtimePreparation === "no"}
                                <div class="xz-daily-field">
                                    <span class="xz-daily-label-with-note">计划熄灯 {#if resolvedSleep.fields.plannedLightsOffAt}<small>{shortDateFromLocalDateTime(resolvedSleep.fields.plannedLightsOffAt)}</small>{/if}</span>
                                    <div class="xz-daily-lights-off-inline">
                                        <select aria-label="计划熄灯日期" value={draft.fields.plannedLightsOffDay} on:change|stopPropagation={(event) => changePlannedLightsOffDay(event.currentTarget.value)}><option value="same-day">{shortDateWithOffset(currentDate, 0)}（当晚）</option><option value="next-day">{shortDateWithOffset(currentDate, 1)}（次日）</option></select>
                                        <TimeSelect bind:value={draft.fields.plannedLightsOffTime} ariaLabel="计划熄灯时间" />
                                    </div>
                                </div>
                                <div class="xz-daily-field">
                                    <span class="xz-daily-label-with-note">实际熄灯 <small>可选 · 当场记录</small></span>
                                    <div class="xz-daily-actual-row">
                                        <div class="xz-daily-actual-time"><TimeSelect bind:value={draft.fields.lightsOffTime} ariaLabel="实际熄灯" clearable on:change={markLightsOffSource} /></div>
                                        <button class="xz-daily-lights-off-button" class:recorded={actualLightsOffRecorded} type="button" on:click={recordLightsOffNow}>{actualLightsOffRecorded ? "重新记录" : "此刻熄灯"}</button>
                                    </div>
                                    {#if actualLightsOffRecorded}
                                        <p class="xz-daily-actual-meta">
                                            {#if draft.fields.lightsOffTimeSource === "live"}已按「此刻熄灯」记为 {draft.fields.lightsOffTime}{:else}已记录 {draft.fields.lightsOffTime}（手动填写）{/if}
                                            · 想重记就点「清空」后再按一次
                                        </p>
                                        {#if tonightCompare}
                                            <p class="xz-daily-actual-compare">
                                                计划 <strong>{tonightPlan?.time}</strong>
                                                <b class:over={tonightCompare.status === "missed"} class:under={tonightCompare.status === "met"}>{tonightDiff}</b>
                                                <span>{tonightCompare.status === "met" ? "明早的判定会按这次实测自动算出「按计划」" : "明早的判定会按这次实测自动算出「没按计划」，并要你补一句原因"}</span>
                                            </p>
                                        {/if}
                                    {:else}
                                        <p class="xz-daily-actual-meta">
                                            {#if lightsOffFlash}{lightsOffFlash}{:else}关灯上床前按一次，明早自动判定；不按，明早就要你自己回答一次「有没有按计划」。过了这一夜不再补记。{/if}
                                        </p>
                                    {/if}
                                </div>
                            {:else if draft.fields.bedtimePreparation === "free"}
                                <p class="xz-daily-bedtime-note">今晚自由安排，不设置计划熄灯时间；明早不会出现是否按计划的判定，实际熄灯也不必记录。</p>
                            {/if}
                        </div>
                    </section>
                {/if}

                <footer class="xz-daily-save-bar">
                    <div>
                        {#if error}<span class="error" role="alert">自动保存失败：{error}</span>
                        {:else if blockMessage}<span class="error" role="alert">{blockMessage}</span>
                        {:else if saving}<span role="status">正在自动保存并复核…</span>
                        {:else if dirty}<span role="status">等待自动保存…</span>
                        {:else if message}<span class="success" role="status">{message}</span>
                        {:else}<span role="status">填写后将自动保存</span>{/if}
                    </div>
                    {#if error || blockMessage}<button class="b3-button" type="button" disabled={saving} on:click={() => void saveNow()}>重试保存</button>{/if}
                </footer>
            </article>

            <aside class="xz-daily-rubric-card">
                <header><h3>评分规则</h3><p>{selectedRubric.label} · {scoreDirection(selectedRubric)}</p></header>
                <ol>{#each selectedRubric.levels as level, index}<li class:active={draft.fields[selectedRubric.id] === index + 1}><b>{index + 1}</b><span>{level}</span></li>{/each}</ol>
                <p class="xz-daily-rubric-note">规则随当前评分字段切换，填写时不必再打开评估表文档。</p>
            </aside>
        </div>
    {:else if view === "checklist"}
        <DailyChecklist
            date={currentDate}
            dayType={draft.dayType}
            loadChecklist={checklistLoaded ? loadChecklistForView : undefined}
            saveChecklist={saveChecklistForView}
            onStorePersisted={(next) => { checklistStore = next; }}
        />
    {:else if view === "history"}
        <section class="xz-daily-list-view">
            <header><div><span class="xz-section-kicker">插件内部数据库</span><h2>历史数据</h2></div><span>{store?.records.length ?? 0} 天</span></header>
            {#if !store?.records.length}<div class="xz-daily-empty"><h3>还没有每日记录</h3><p>从 9 月 3 日开始手动录入即可；这里不会迁移旧文档数据。</p></div>{:else}{#each [...store.records].reverse() as record (record.date)}<button class="xz-daily-history-row" type="button" on:click={() => void openHistoryRecord(record.date)}><strong>{record.date}</strong><span>{dayTypeLabel(record.dayType)}</span><span>睡眠 {record.fields.sleepDurationMinutes === null ? "—" : `${Math.floor(record.fields.sleepDurationMinutes / 60)} 小时 ${record.fields.sleepDurationMinutes % 60} 分`}{#if record.fields.lightsOffBand === "after-midnight"}<em class="xz-daily-night-owl">熬夜</em>{/if}</span><span>精力 {record.fields.daytimeEnergy ?? "—"}</span><span>{statusFor(record)}</span></button>{/each}{/if}
        </section>
    {:else if view === "trends"}
        <TrendView
            records={store?.records ?? []}
            {loadNutrition}
            loadSettings={loadTrendView}
            saveSettings={saveTrendView}
            openRecord={(date) => void openHistoryRecord(date)}
            goToday={() => void changeView("today")}
            today={localDateKey()}
        />
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
