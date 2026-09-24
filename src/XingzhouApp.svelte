<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { Dialog, showMessage } from "siyuan";
    import {
        countActionImages,
        compactImageSpacing,
        extractClipboardImages,
        extractDroppedImages,
        fileNameFromSource,
        findPlaceholderSyntax,
        formatImageBytes,
        hashImageFile,
        imageFileNameFor,
        insertImageSyntax,
        listActionImages,
        listPendingActionImages,
        markdownImageSyntax,
        placeholderIdFor,
        removeImageLine,
        shiftCursorForReplacement,
        resolveUploadPlaceholder,
        uploadPlaceholderSyntax,
        type ActionEdit,
    } from "./action-images";
    import {
        buildImageCleanupPlan,
        buildStorageStats,
        cleanupBadgeLabel,
        IMAGE_CLEANUP_GRACE_DAYS,
        cleanupForStatusChange,
        cleanupImagesOf,
        cleanupParentChain,
        cleanupRemainingDays,
        isCleanupDue,
        itemImageTexts,
        keptPathsOf,
        listItemImages,
        referencingActiveItems,
        listPendingImageCleanup,
        removablePathsOf,
        type ActionImageCleanupEntry,
        type ImageCleanupTextUpdate,
    } from "./action-image-cleanup";
    import { listUnusedAssetPaths, readAssetLibrarySize, readAssetSizes, removeUnusedAsset, uploadActionImage, type AssetRemovalResult } from "./asset-upload";
    import {
        ACTION_DETAIL_FIELDS,
        actionDetailMissing,
        addOutcome,
        createEmptyActionDetail,
        migrateLegacyActionText,
        normalizeActionDetail,
        outcomesForDisplay,
        removeOutcome,
        setActionDetailField,
        updateOutcome,
        type ActionDetail,
        type ActionDetailField,
    } from "./action-detail";
    import { completionBlockers, completionReasonLine, type CompletionDisposition } from "./completion";
    import {
        addTodo,
        createTodo,
        dropOpenTodos,
        dropTodos,
        findTodo,
        hasUnfinishedTodos,
        normalizeTodos,
        removeTodo,
        todoProgress,
        toggleTodoDone,
        toggleTodoDropped,
        updateTodoLinks,
        updateTodoNote,
        updateTodoText,
        type Todo,
    } from "./todos";
    import ActionDetailCard from "./ActionDetailCard.svelte";
    import {
        applyActionTemplate as fillDetailFromTemplate,
        isTemplateEmpty,
        templateFromDetail,
        templateNames as templateNamesOf,
        upsertActionTemplate,
        type ActionTemplate,
    } from "./action-templates";
    import CompletionDialog from "./CompletionDialog.svelte";
    import TodoListCard from "./TodoListCard.svelte";
    import type { CaptureDialogMode, CaptureDialogRequest, CaptureDialogValues } from "./capture-dialog";
    import { prerequisiteIds, validateDependencyUpdate, type DependencyKind } from "./dependencies";
    import type { ActionImageCopyTarget } from "./image-clipboard";
    import ActionEditorWindow from "./ActionEditorWindow.svelte";
    import { applyOrderedListNormalization, continueMarkdownList } from "./markdown-editor";
    import { renderActionMarkdown } from "./markdown-renderer";
    import ExecutionSlicePlanner from "./ExecutionSlicePlanner.svelte";
    import { pickFallbackTransaction } from "./ui-state";
    import {
        availableSliceCount,
        automaticSliceStatusChanges,
        automaticSliceUndoChanges,
        cancelScheduledSlice,
        completeSliceNow,
        completedSliceCount,
        expirePastSlices,
        localDateKey,
        moveScheduledSlice,
        scheduleSlice,
        setSliceOutcome,
        sliceCompletionPercent,
        undoCompletedSlice,
        type ExecutionSlice,
    } from "./execution-slices";
    import RoleBadge from "./RoleBadge.svelte";
    import RelationshipGraph from "./RelationshipGraph.svelte";
    import { getAutomaticHierarchyStatusChanges } from "./status-hierarchy";
    import { automaticStatusForPlanDate } from "./status-schedule";
    import { autoResizeTextarea } from "./textarea-autosize";
    import { log } from "./log";
    import { getTodayFocusCounts, isTodayFocusItem } from "./today-focus";
    import TreeNode from "./TreeNode.svelte";
    import { buildWorkItemTree, collectDescendantIds, compareWorkItemOrder, hasActiveDescendant, hasOngoingDescendant, isActive, isClosed, type WorkItemTree } from "./tree";
    import { dayLoadValue } from "./execution-slices";
    import { groupWeekOccurrences, isWeekOccurrenceCompact, weekDayLoads, weekOccurrenceLabel } from "./week-schedule";
    import { deriveTopProjectId, getWorkItemProfile, needsDeadlineDecision, WORK_ITEM_ROLE_LEGEND } from "./work-item-role";
    import type { InboxCaptureOptions, WorkItem, WorkItemChanges, WorkItemData, WorkItemViewState } from "./work-items";


    /** 所有可在大编辑窗口里编辑的字段。 */
    const EDITOR_DETAIL_FIELDS: Array<`detail:${ActionDetailField}` | "detail:nextAction"> = [
        "detail:currentState", "detail:background", "detail:prompt", "detail:guidance", "detail:definition", "detail:nextAction",
    ];
    const EDITOR_FIELDS: EditorField[] = ["currentAction", "nextAction", ...EDITOR_DETAIL_FIELDS];

    /** 每个字段一份的状态表：必须覆盖全部编辑字段，否则细则字段会读到 undefined。 */
    function editorRecord<T>(value: (field: EditorField) => T): Record<EditorField, T> {
        return Object.fromEntries(EDITOR_FIELDS.map((field) => [field, value(field)])) as Record<EditorField, T>;
    }

    function emptyEditorErrors(): Record<EditorField, string> {
        return editorRecord(() => "");
    }

    function emptyEditorRecord<T>(value: T): Record<EditorField, T> {
        return editorRecord(() => value);
    }

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
    ) => void = (_event, onDelete) => onDelete();
    /** 右键图片时的菜单；由 index.ts 用思源 Menu 打开，组件只负责命中判定与取真实地址。 */
    export let openImageMenu: (event: MouseEvent, image: ActionImageCopyTarget) => void = () => undefined;
    export let openCaptureDialog: (request: CaptureDialogRequest) => void = () => undefined;
    export let openDocument: (blockId: string) => Promise<void>;
    export let embedded = false;
    export let initialWorkItemId: string | null = null;
    export let initialViewState: WorkItemViewState | null = null;
    export let saveViewState: ((state: WorkItemViewState) => Promise<void> | void) | null = null;
    export let loadSavedViewState: (() => Promise<WorkItemViewState | null>) | null = null;
    /** 打开日志面板：由 index.ts 提供（面板是命令式对话框，不在组件里再建一套生命周期）。 */
    export let openLog: () => void = () => undefined;
    /** 行动细则模板：非关键 UI 数据，读取失败时为空列表。 */
    export let loadActionTemplates: () => Promise<ActionTemplate[]> = async () => [];
    export let saveActionTemplates: (templates: ActionTemplate[]) => Promise<void> = async () => undefined;

    type MainPage = "week" | "all" | "review" | "graph" | "cleanup";
    type ItemFilter = "all" | "today" | "active" | "future" | "closed";
    type WeekDay = { timestamp: number; key: string; label: string; dateLabel: string; isToday: boolean };
    type ActionField = "currentAction" | "nextAction";
    /**
     * 大编辑窗口能编辑的全部字段：两张旧的行动字段 + 结构化细则的每个字段。
     * 统一成一套身份后，草稿兜底、光标落点、图片上传这些已验证过的链路可以原样复用。
     */
    type EditorField = ActionField | `detail:${ActionDetailField}` | "detail:nextAction";
    type ActionImageUpload = {
        uploadId: string;
        name: string;
        bytes: number | null;
        status: "uploading" | "done" | "failed";
        src: string;
        error: string;
        field: EditorField;
        /** 上传发起时的条目与字段标识，用于丢弃过期结果。 */
        draftKey: string;
    };
    type ActionImageRow = {
        key: string;
        status: "uploading" | "done" | "failed";
        src: string;
        syntax: string;
        label: string;
        bytes: number | null;
        error: string;
    };
    type CompletionUndo = { rowId: string; title: string; status: string };

    const mainPages: Array<{ id: MainPage; label: string }> = [
        { id: "all", label: "全部" },
        { id: "week", label: "本周" },
        { id: "review", label: "整理" },
        { id: "graph", label: "关系图" },
    ];
    const itemFilters: Array<{ id: ItemFilter; label: string }> = [
        { id: "today", label: "今日" },
        { id: "all", label: "全部" },
        { id: "active", label: "活跃项目" },
        { id: "future", label: "将来" },
        { id: "closed", label: "已结束" },
    ];
    const legacyStatuses = new Set(["规划中", "活跃", "等待", "将来／也许", "已计划"]);
    const dependencyCandidateStatuses = new Set(["待开始", "进行中"]);
    const includeClosedStorageKey = "siyuan-plugin-xingzhou:include-closed";

    let page: MainPage = "all";
    let filter: ItemFilter = "all";
    let includeClosed = false;
    let data: WorkItemData | null = null;
    let tree: WorkItemTree = buildWorkItemTree([]);
    let todayFocusCounts = new Map<string, number>();
    /** 今日口径的时间基准：跨午夜刷新时随数据一起更新，保证「今日」筛选与行内标记同步换日。 */
    let todayNow = Date.now();
    let todayFocusCount = 0;
    let visibleIds = new Set<string>();
    let visibleRoots: WorkItem[] = [];
    export let loading = true;
    let error = "";
    let selectedId: string | null = null;
    /**
     * 「今日」下被钉住的选中项：它已不再匹配筛选（例如你刚取消了今天的切片），
     * 但因为你正选中它，视图保留它、详情面板不换人，直到你主动切换到别处。
     */
    let pinnedFocusId: string | null = null;
    /** 用户刚切过筛选：本次重算只结算可见性，不把上一个筛选的选中项钉进新筛选。 */
    let focusPinRejected = false;
    let scope: "all" | string = "all";
    let scopeDrawerOpen = false;
    let compactDetailOpen = false;
    let expandedIds = new Set<string>();
    let capturing = false;
    export let quickCaptureNotice = "";
    let weekStart = startOfWeek(Date.now());
    let weekSavingIds = new Set<string>();
    let weekError = "";
    let editingAction: EditorField | null = null;
    let savingAction: EditorField | null = null;
    let savingInline: string | null = null;
    let savingSlices = false;
    let completionUndo: CompletionUndo | null = null;
    let completionUndoTimer: ReturnType<typeof setTimeout> | null = null;
    /** 完成门槛：有未完成切片／待办时先弹处置层，用户选完才真正完成。 */
    let completionDialog: {
        rowId: string;
        title: string;
        blockers: ReturnType<typeof completionBlockers>;
    } | null = null;
    let completionDialogError = "";
    let completionBusy = false;
    /** 细则大编辑窗口（复用已有 ActionEditorWindow）当前编辑的字段。 */
    let detailEditingField: ActionDetailField | "nextAction" | null = null;
    /**
     * 细则字段保存失败时的提示：常驻在详情面板上，直到重新打开该字段或保存成功。
     * 不用 inlineError 的原因：它会在条目刷新、草稿重置等路径上被清空，用户会看不到错误。
     */
    let fieldSaveError = "";
    /** 行动细则模板（非关键 UI 数据，读取失败为空列表）。 */
    let actionTemplates: ActionTemplate[] = [];
    $: actionTemplateNames = templateNamesOf(actionTemplates);
    /*
     * 模板里不能用 TypeScript 的非空断言（`selected!`），Svelte 的模板解析会直接报语法错误。
     * 这里把选中项接一层：详情面板整体在 `{#if selected}` 内，运行时始终有值。
     */
    $: currentItem = selected as WorkItem;
    let temporalRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let undoingCompletion = false;
    let actionErrors: Record<EditorField, string> = emptyEditorErrors();
    let actionCursor: Record<EditorField, number> = emptyEditorRecord(0);
    /**
     * 点卡片进入编辑态时记下的鼠标位置：编辑器挂载后用它在文本里定位光标。
     * 这样"点哪一行就在哪一行开始输入"对「点卡片进入」这条路径也成立，
     * 而不是像以前那样把光标放到全文末尾。
     */
    let pendingActionCaretPoint: { field: EditorField; x: number; y: number } | null = null;
    /** 进入编辑前锁定的「点击位置对应的字符位置」：挂载后版面会变，必须提前算好。 */
    /** 上一次同步给窗口的 props：用于跳过没变化的重设。 */
    let actionWindowProps: Record<string, unknown> = {};
    /** 大编辑窗口：内容组件实例与对话框。 */
    let actionWindow: ActionEditorWindow | null = null;
    let actionWindowDialog: Dialog | null = null;
    let actionWindowField: EditorField | null = null;
    /** 打开窗口前算好的光标落点（用窗口宽度排版量出来，不受卡片重排影响）。 */
    let actionWindowCaret: number | null = null;
    /** 正在按用户视角校正详情面板滚动时，不要再被自己的写入再次触发。 */
    let restoringDetailScroll = false;
    /** 输入法合成状态：合成期间任何程序化回写都会打散候选串，必须完全避开。 */
    let actionComposing: Record<EditorField, boolean> = emptyEditorRecord(false);
    /** 草稿兜底：本地快照，用于系统级输入异常（输入法／系统升级）导致整段丢失后的恢复。 */
    let actionRestoredNotice: Record<EditorField, string> = emptyEditorErrors();
    let actionImageUploads: Record<EditorField, ActionImageUpload[]> = editorRecord(() => []);
    let actionImageSizes: Record<EditorField, Record<string, number | null>> = editorRecord(() => ({}));
    let savedActionValues: Record<EditorField, string> = emptyEditorErrors();
    let actionDragging: EditorField | null = null;
    let actionPreviewDialog: Dialog | null = null;
    let inlineError = "";
    let deleteTarget: WorkItem | null = null;
    let deleteDescendantCount = 0;
    let deleteTopReferenceCount = 0;
    let deleteDependencyReferenceCount = 0;
    let deleting = false;
    let deleteError = "";
    let draftSourceId: string | null = null;
    let detailDraft = emptyDetailDraft();
    let areaAndIdeaRoots: WorkItem[] = [];
    let topLevelProjects: WorkItem[] = [];
    let independentTransactions: WorkItem[] = [];
    let uncategorizedRoots: WorkItem[] = [];
    let draggingId: string | null = null;
    let reordering = false;
    let reorderError = "";
    let appliedInitialWorkItemId: string | null = null;
    let appliedInitialViewState = false;
    let sidebarElement: HTMLElement | null = null;
    let treeScrollElement: HTMLElement | null = null;
    let detailElement: HTMLElement | null = null;

    $: selected = selectedId ? tree.byId.get(selectedId) ?? null : null;

    export function getSelectedWorkItemId(): string | null {
        return selectedId;
    }

    export function getViewState(): WorkItemViewState {
        return {
            page,
            filter,
            includeClosed,
            scope,
            selectedId,
            expandedIds: [...expandedIds],
            weekStart,
            sidebarScrollTop: sidebarElement?.scrollTop ?? 0,
            treeScrollTop: treeScrollElement?.scrollTop ?? 0,
            detailScrollTop: detailElement?.scrollTop ?? 0,
        };
    }

    /** 数据就绪后即武装保存（与是否有历史状态无关）；状态一变立即写入，避免“点击后立刻关页签”丢失。 */
    function scheduleViewStateSave() {
        if (!data || !saveViewState) return;
        saveViewState?.(getViewState());
    }

    function flushViewState() {
        if (data) saveViewState?.(getViewState());
    }

    $: { data; page; filter; includeClosed; scope; selectedId; expandedIds; weekStart; scheduleViewStateSave(); }

    onDestroy(() => {
        flushViewState();
        actionPreviewDialog?.destroy();
        actionPreviewDialog = null;
        closeCleanupManager();
    });

    function revealRestoredItem(item: WorkItem | undefined) {
        if (!item) return;
        selectedId = item.id;
        const next = new Set(expandedIds);
        const seen = new Set<string>();
        let parentId: string | undefined = item.parentIds[0];
        while (parentId && !seen.has(parentId)) {
            seen.add(parentId);
            next.add(parentId);
            parentId = tree.byId.get(parentId)?.parentIds[0];
        }
        expandedIds = next;
    }
    // 图片行必须由响应式语句派生，并在块内显式引用依赖：
    // 模板里调用函数或 `$: x = f("literal")` 都无法追踪 detailDraft / 上传队列的变化
    $: currentActionImageRows = buildActionImageRows("currentAction", detailDraft.currentAction, actionImageUploads.currentAction, actionImageSizes.currentAction);
    $: nextActionImageRows = buildActionImageRows("nextAction", detailDraft.nextAction, actionImageUploads.nextAction, actionImageSizes.nextAction);
    $: currentActionImageTotal = buildActionImageTotal(detailDraft.currentAction, actionImageUploads.currentAction);
    $: nextActionImageTotal = buildActionImageTotal(detailDraft.nextAction, actionImageUploads.nextAction);
    $: todayFocusCounts = getTodayFocusCounts(data?.items ?? [], tree);
    // 数据换一轮（含跨午夜刷新）就推进今日锚点，使筛选与标记使用同一个「今天」
    $: { data; todayNow = Date.now(); }
    $: todayFocusCount = (data?.items ?? []).filter((item) => isTodayFocusItem(item, localDateKey(todayNow))).length;
    $: selectedProfile = selected ? getWorkItemProfile(selected, tree) : null;
    $: deleteDescendantCount = deleteTarget ? Math.max(0, collectDescendantIds(deleteTarget.id, tree).size - 1) : 0;
    $: {
        const deleteTargetId = deleteTarget?.id;
        deleteTopReferenceCount = deleteTargetId
            ? (data?.items ?? []).filter((item) => item.id !== deleteTargetId && item.topProjectIds.includes(deleteTargetId)).length
            : 0;
    }
    $: allAreaAndIdeaRoots = sortSidebarItems((data?.items ?? []).filter((item) => item.type === "长期领域" || (item.type === "想法" && !item.parentIds[0])));
    $: longTermAreas = allAreaAndIdeaRoots.filter((item) => item.type === "长期领域");
    $: allTopLevelProjects = sortSidebarItems((data?.items ?? []).filter((item) => {
        if (item.type !== "项目") return false;
        const parentItem = item.parentIds[0] ? tree.byId.get(item.parentIds[0]) : null;
        return !parentItem || parentItem.type === "长期领域";
    }));
    $: allIndependentTransactions = sortSidebarItems(tree.roots.filter((item) => item.type === "事务"));
    $: categorizedSidebarIds = new Set([...allAreaAndIdeaRoots, ...allTopLevelProjects, ...allIndependentTransactions].map((item) => item.id));
    $: allUncategorizedRoots = sortSidebarItems(tree.roots.filter((item) => !categorizedSidebarIds.has(item.id)));
    $: {
        filter; includeClosed; tree; todayNow; pinnedFocusId;
        areaAndIdeaRoots = allAreaAndIdeaRoots.filter(shouldShowSidebarRoot);
        topLevelProjects = allTopLevelProjects.filter(shouldShowSidebarRoot);
        independentTransactions = allIndependentTransactions.filter(shouldShowSidebarRoot);
        uncategorizedRoots = allUncategorizedRoots.filter(shouldShowSidebarRoot);
    }
    /*
     * 选中项归属与「钉住」：放在同一个响应式块里是有意的。
     * 钉住状态一改，可见性必须在同一次更新里跟着重算；拆成两个块时 Svelte 按源码顺序
     * 单趟执行，先算完可见性再改钉子，本轮就不会重算，钉住的行会缺席到下一次刷新。
     */
    $: {
        page; filter; selectedId; data; scope; tree; includeClosed; todayNow; focusPinRejected;
        if (focusPinRejected) {
            /*
             * 刚由用户主动切了筛选：此刻的选中项是从上一个筛选带过来的，不是用户在本次筛选里选的。
             * 所以既不钉住它（否则切到「今日」会被上一个视图的选中项接管，看不清今天的清单），
             * 也不让它在详情面板里继续挂着——回落到本次筛选里第一个该看的事务。
             */
            const freshVisibleIds = getVisibleIds(null);
            pinnedFocusId = null;
            if (data && selectedId && !freshVisibleIds.has(selectedId)) {
                selectedId = pickFallbackTransaction(data.items, tree, freshVisibleIds);
            }
            focusPinRejected = false;
        } else {
            pinnedFocusId = resolvePinnedFocusId(page, filter, selectedId, tree, todayNow);
        }
        visibleIds = getVisibleIds(pinnedFocusId);
        visibleRoots = getVisibleRoots(pinnedFocusId);
        if (page === "all" && data && selectedId && filter !== "today" && !visibleIds.has(selectedId)) {
            // 其余筛选沿用原有回落：选中项不可见（已完成/删除）时挑今日未完成切片最多 → 树顺序第一个
            const fallbackId = pickFallbackTransaction(data.items, tree, visibleIds);
            if (fallbackId) revealRestoredItem(tree.byId.get(fallbackId));
            else selectedId = null;
        }
    }
    $: parent = selected?.parentIds[0] ? tree.byId.get(selected.parentIds[0]) ?? null : null;
    $: derivedTopProjectId = selected ? deriveTopProjectId(selected.parentIds[0] ?? "", tree) : "";
    $: topProject = derivedTopProjectId ? tree.byId.get(derivedTopProjectId) ?? null : null;
    $: parentCandidates = selected ? getParentCandidates(selected) : [];
    $: selectedIssues = selected ? tree.issues.filter((issue) => issue.itemId === selected.id) : [];
    $: dependencyCandidates = selected
        ? sortSidebarItems((data?.items ?? []).filter((item) => item.id !== selected.id && dependencyCandidateStatuses.has(item.status)))
        : [];
    $: selectedPrerequisiteIds = new Set(selected ? prerequisiteIds(selected) : []);
    $: hardPrerequisites = selected ? resolveItems(selected.hardPrerequisiteIds ?? []) : [];
    $: softPrerequisites = selected ? resolveItems(selected.softPrerequisiteIds ?? []) : [];
    $: unmetHardPrerequisites = hardPrerequisites.filter((item) => item.status !== "已完成");
    $: selectedDependents = selected
        ? sortSidebarItems((data?.items ?? []).filter((item) => prerequisiteIds(item).includes(selected.id)))
        : [];
    $: {
        const deleteTargetId = deleteTarget?.id;
        deleteDependencyReferenceCount = deleteTargetId
            ? (data?.items ?? []).filter((item) => item.id !== deleteTargetId && prerequisiteIds(item).includes(deleteTargetId)).length
            : 0;
    }
    $: weekDays = buildWeekDays(weekStart);
    $: weekItemsByDate = groupWeekOccurrences(data?.items ?? [], weekStart);
    $: weekLoadsByDate = weekDayLoads(data?.items ?? [], weekStart);
    $: scheduledWeekIds = new Set([...weekItemsByDate.values()].flatMap((occurrences) => occurrences.filter(({ slice }) => !slice || slice.status === "scheduled").map(({ item }) => item.id)));
    $: scheduledWeekCount = [...weekItemsByDate.values()].flat().filter(({ slice }) => !slice || slice.status === "scheduled").length;
    $: unscheduledWeekItems = getUnscheduledWeekItems(data?.items ?? []);
    $: activeWindowItems = getActiveWindowItems(data?.items ?? [], scheduledWeekIds);
    $: reviewFocusedDomains = getReviewFocusedDomains(data?.items ?? []);
    $: reviewOngoingProjects = getReviewOngoingProjects(data?.items ?? []);
    $: reviewDateItems = getReviewDateItems(data?.items ?? []);
    $: reviewMissingActionItems = getReviewMissingActionItems(data?.items ?? [], new Set(reviewDateItems.map((item) => item.id)));
    $: reviewCompletedThisWeek = getReviewCompletedThisWeek(data?.items ?? []);
    $: if (selected && selected.id !== draftSourceId) resetDetailDraft(selected);
    /**
     * 大编辑窗口是命令式创建的，这里把「与它相关的外部状态」持续同步进去：
     * 图片上传进度、错误信息、保存中、拖拽高亮、字数。
     */
    $: if (actionWindow && editingAction && detailDraft) {
        const field = editingAction;
        const next = {
            saving: savingAction === field,
            error: actionErrors[field],
            restoredNotice: actionRestoredNotice[field],
            dragging: actionDragging === field,
            // 图片行按字段推导：结构化细则的每个字段都能贴图，不能再按字段名二选一
            imageRows: buildActionImageRows(field, draftOf(field), actionImageUploads[field], actionImageSizes[field]),
            imageTotal: buildActionImageTotal(draftOf(field), actionImageUploads[field]),
            pendingUploads: listPendingActionImages(draftOf(field)).length,
        };
        // 只在真的变化时同步：这个块每次按键都会跑到，无条件 $set 会让窗口白重渲染一次
        const changed: Partial<typeof next> = {};
        let dirty = false;
        for (const key of Object.keys(next) as Array<keyof typeof next>) {
            if (actionWindowProps[key] !== next[key]) {
                (changed as Record<string, unknown>)[key] = next[key];
                dirty = true;
            }
        }
        if (dirty) {
            actionWindowProps = { ...actionWindowProps, ...changed };
            actionWindow.$set(changed);
        }
    }

    Promise.resolve().then(() => void refresh());

    onMount(() => {
        try {
            includeClosed = localStorage.getItem(includeClosedStorageKey) === "true";
        } catch {
            includeClosed = false;
        }
        scheduleTemporalRefresh();
        void loadActionTemplates().then((templates) => {
            actionTemplates = templates;
        }).catch(() => {
            actionTemplates = [];
        });
        return () => {
            clearCompletionUndo();
            if (temporalRefreshTimer) clearTimeout(temporalRefreshTimer);
        };
    });

    export async function refresh() {
        loading = true;
        error = "";
        const started = Date.now();
        try {
            if (!appliedInitialViewState && !initialViewState && loadSavedViewState) {
                const saved = await loadSavedViewState();
                if (saved && !initialViewState) initialViewState = saved;
            }
            const loaded = await load();
            applyData(loaded);
            log.verbose("ui", "ui.refresh.ok", { items: loaded.items.length, ms: Date.now() - started });
            try {
                applyData(await reconcileAutomaticStatuses(loaded));
            } catch (caught) {
                inlineError = `日期状态自动更新失败：${caught instanceof Error ? caught.message : String(caught)}`;
                log.warn("ui", "ui.reconcile.failed", { err: caught instanceof Error ? caught.message : String(caught) });
            }
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : String(caught);
            error = message;
            log.error("ui", "ui.refresh.failed", { err: message, ms: Date.now() - started });
        } finally {
            loading = false;
        }
    }

    async function reconcileAutomaticStatuses(loaded: WorkItemData): Promise<WorkItemData> {
        let current = loaded;
        for (const original of loaded.items) {
            if (original.type !== "事务") continue;
            const expired = expirePastSlices(original);
            if (!expired) continue;
            const currentItem = current.items.find((item) => item.rowId === original.rowId);
            if (currentItem) current = await saveItem(current, currentItem, { executionSlices: expired });
        }
        if (!loaded.fields.status) return current;
        for (const original of loaded.items) {
            if (original.type === "事务") continue;
            const targetStatus = automaticStatusForPlanDate(original.status, formatInputDate(original.planDate), formatInputDate(Date.now()));
            if (!targetStatus || targetStatus === original.status) continue;
            const currentItem = current.items.find((item) => item.rowId === original.rowId);
            if (currentItem) current = await saveItem(current, currentItem, { status: targetStatus });
        }
        for (const change of getAutomaticHierarchyStatusChanges(current.items)) {
            const currentItem = current.items.find((item) => item.rowId === change.rowId);
            if (currentItem && currentItem.status !== change.status) current = await saveItem(current, currentItem, { status: change.status });
        }
        return current;
    }

    function scheduleTemporalRefresh() {
        const nextMidnight = new Date();
        nextMidnight.setHours(24, 0, 1, 0);
        temporalRefreshTimer = setTimeout(async () => {
            await refresh();
            scheduleTemporalRefresh();
        }, Math.max(1000, nextMidnight.getTime() - Date.now()));
    }

    function applyData(nextData: WorkItemData) {
        const hadData = Boolean(data);
        const previouslyExpanded = expandedIds;
        data = nextData;
        tree = buildWorkItemTree(nextData.items);
        if (initialViewState && !appliedInitialViewState) {
            page = initialViewState.page === "inbox" ? "all" : initialViewState.page;
            filter = initialViewState.filter;
            includeClosed = initialViewState.includeClosed;
            scope = initialViewState.scope === "all" || tree.byId.has(initialViewState.scope) ? initialViewState.scope : "all";
            selectedId = initialViewState.selectedId && tree.byId.has(initialViewState.selectedId)
                ? initialViewState.selectedId
                : nextData.items[0]?.id ?? null;
            expandedIds = new Set(initialViewState.expandedIds.filter((id) => tree.byId.has(id)));
            weekStart = initialViewState.weekStart;
            appliedInitialViewState = true;
            restoreScrollPositions(initialViewState);
        } else {
            selectedId = selectedId && tree.byId.has(selectedId) ? selectedId : nextData.items[0]?.id ?? null;
            expandedIds = hadData
                ? new Set([...previouslyExpanded].filter((id) => tree.byId.has(id)))
                : getDefaultExpandedIds(filter, nextData.items);
        }
        if (initialWorkItemId && appliedInitialWorkItemId !== initialWorkItemId) {
            const requested = tree.byId.get(initialWorkItemId);
            appliedInitialWorkItemId = initialWorkItemId;
            if (requested) revealInboxItem(requested);
        }
        loading = false;
    }

    function restoreScrollPositions(state: WorkItemViewState) {
        void tick().then(() => {
            if (sidebarElement) sidebarElement.scrollTop = state.sidebarScrollTop;
            if (treeScrollElement) treeScrollElement.scrollTop = state.treeScrollTop;
            if (detailElement) detailElement.scrollTop = state.detailScrollTop;
        });
    }

    function sortSidebarItems(items: WorkItem[]): WorkItem[] {
        return [...items].sort(compareWorkItemOrder);
    }

    function resolveItems(ids: string[]): WorkItem[] {
        return ids.map((id) => tree.byId.get(id)).filter((item): item is WorkItem => Boolean(item));
    }

    function matchesFilter(item: WorkItem, todayKey: string): boolean {
        if (filter === "today") return isTodayFocusItem(item, todayKey);
        if (filter === "active") return isActive(item);
        if (filter === "future") return item.status === "将来" || item.status === "将来／也许" || item.status === "暂停";
        if (filter === "closed") return isClosed(item);
        return includeClosed || !isClosed(item);
    }

    /**
     * 计算「钉住」的选中项：在「今日」下，选中项一旦不再命中筛选（例如你刚取消了今天的切片），
     * 就把它钉住——视图保留它、详情面板不换人，只在你主动切换时才放下。
     */
    function resolvePinnedFocusId(
        currentPage: MainPage,
        currentFilter: ItemFilter,
        currentSelectedId: string | null,
        currentTree: WorkItemTree,
        now: number,
    ): string | null {
        if (currentPage !== "all" || currentFilter !== "today" || !currentSelectedId) return null;
        const current = currentTree.byId.get(currentSelectedId);
        if (!current) return null;
        return matchesFilter(current, localDateKey(now)) ? null : current.id;
    }

    function shouldShowSidebarRoot(item: WorkItem): boolean {
        if (filter === "today") {
            // 钉住的选中项所在路径同样留在左栏，避免选中项在范围列表里凭空消失
            if (pinnedFocusId && hasDescendantOrSelf(item.id, pinnedFocusId)) return true;
            const todayKey = localDateKey(todayNow);
            return matchesFilter(item, todayKey) || hasDescendantMatching(item.id, (candidate) => matchesFilter(candidate, todayKey));
        }
        if (filter === "closed") return isClosed(item) || hasDescendantMatching(item.id, isClosed);
        if (filter === "all" && includeClosed) return true;
        return !isClosed(item) || hasDescendantMatching(item.id, (candidate) => !isClosed(candidate));
    }

    function hasDescendantMatching(itemId: string, predicate: (item: WorkItem) => boolean): boolean {
        const seen = new Set<string>();
        const visit = (id: string): boolean => {
            if (seen.has(id)) return false;
            seen.add(id);
            return (tree.children.get(id) ?? []).some((child) => predicate(child) || visit(child.id));
        };
        return visit(itemId);
    }

    /** 目标项是否位于该项自身或其下级路径上（用于判断选中项属于哪条侧栏根路径）。 */
    function hasDescendantOrSelf(itemId: string, targetId: string): boolean {
        const seen = new Set<string>();
        let current: WorkItem | undefined = tree.byId.get(targetId);
        while (current && !seen.has(current.id)) {
            if (current.id === itemId) return true;
            seen.add(current.id);
            const parentId = current.parentIds[0];
            current = parentId ? tree.byId.get(parentId) : undefined;
        }
        return false;
    }

    function toggleIncludeClosed() {
        if (filter !== "all") return;
        includeClosed = !includeClosed;
        if (!includeClosed && scope !== "all") {
            const scoped = tree.byId.get(scope);
            if (scoped && isClosed(scoped) && !hasDescendantMatching(scoped.id, (item) => !isClosed(item))) scope = "all";
        }
        try {
            localStorage.setItem(includeClosedStorageKey, String(includeClosed));
        } catch {
            // 无法访问本地存储时仍保留本次会话中的选择。
        }
    }

    function canAddChild(item: WorkItem): boolean {
        return item.type === "长期领域" || item.type === "项目";
    }

    function openChildCapture(parent: WorkItem) {
        const mode: CaptureDialogMode = "child";
        openCaptureDialog({
            mode,
            parent: { id: parent.id, title: parent.title, type: parent.type },
            areas: longTermAreas.map(({ id, title, type }) => ({ id, title, type })),
            onSubmit: (values) => submitQuickCapture(mode, parent, values),
        });
    }

    function openSidebarCapture(mode: Exclude<CaptureDialogMode, "child">) {
        openCaptureDialog({
            mode,
            areas: longTermAreas.map(({ id, title, type }) => ({ id, title, type })),
            onSubmit: (values) => submitQuickCapture(mode, null, values),
        });
    }

    async function submitQuickCapture(mode: CaptureDialogMode, parent: WorkItem | null, values: CaptureDialogValues): Promise<void> {
        const title = values.title.trim();
        if (!title) throw new Error("请先填写名称。");
        if (capturing) throw new Error("另一项内容仍在保存，请稍候再试。");
        const previousIds = new Set(data?.items.map((item) => item.id) ?? []);
        let options: InboxCaptureOptions | undefined;
        if (mode === "child" && parent) {
            options = {
                type: values.type ?? (parent.type === "长期领域" ? "项目" : "事务"),
                status: "待开始",
                parentId: parent.id,
                topProjectId: parent.type === "项目" ? deriveTopProjectId(parent.id, tree) : "",
            };
        } else if (mode === "areaOrIdea") {
            const type = values.type ?? "长期领域";
            options = { type, status: type === "长期领域" ? "将来" : "待开始" };
        } else if (mode === "topProject") {
            options = { type: "项目", status: "待开始", parentId: values.areaId ?? "" };
        } else if (mode === "transaction") {
            options = { type: "事务", status: "待开始" };
        }
        capturing = true;
        try {
            const refreshed = await captureInbox(title, options);
            log.info("ui", "ui.capture.ok", { length: title.trim().length, items: refreshed.items.length });
            applyData(refreshed);
            const created = refreshed.items.find((item) => !previousIds.has(item.id));
            quickCaptureNotice = mode === "child" && parent
                ? `已在“${parent.title}”下创建：${title}`
                : `已创建：${title}`;
            if (created && options) revealInboxItem(created, true);
        } finally {
            capturing = false;
        }
    }

    function revealInboxItem(item: WorkItem, preserveCurrentScope = false) {
        page = "all";
        filter = "all";
        if (!preserveCurrentScope || !isInsideScope(item, scope)) {
            scope = item.parentIds[0] || item.id;
        }
        selectedId = item.id;
        pinnedFocusId = null;
        compactDetailOpen = true;
        const next = new Set(expandedIds);
        const seen = new Set<string>();
        let parentId: string | undefined = item.parentIds[0];
        while (parentId && !seen.has(parentId)) {
            seen.add(parentId);
            next.add(parentId);
            parentId = tree.byId.get(parentId)?.parentIds[0];
        }
        expandedIds = next;
    }

    function selectScopeItem(item: WorkItem) {
        scope = item.id;
        selectedId = item.id;
        pinnedFocusId = null;
        scopeDrawerOpen = false;
        compactDetailOpen = true;
    }

    function selectTreeItem(id: string) {
        selectedId = id;
        // 主动选中别的条目就放下钉子：只有这一步才允许视图把你从原事务上移开
        pinnedFocusId = null;
        compactDetailOpen = true;
    }

    function isInsideScope(item: WorkItem, scopeId: "all" | string): boolean {
        if (scopeId === "all") return true;
        const seen = new Set<string>();
        let current: WorkItem | undefined = item;
        while (current && !seen.has(current.id)) {
            if (current.id === scopeId) return true;
            seen.add(current.id);
            current = current.parentIds[0] ? tree.byId.get(current.parentIds[0]) : undefined;
        }
        return false;
    }

    function handleContextMenu(event: MouseEvent) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (!target.closest(".xz-app")) return;
        if (target.closest("input, textarea, select, [contenteditable='true']")) return;
        const itemElement = target.closest<HTMLElement>("[data-work-item-id]");
        const itemId = itemElement?.dataset.workItemId;
        if (!itemId || !tree.byId.has(itemId)) {
            return;
        }
        const item = tree.byId.get(itemId);
        if (item) openActionsMenu(event, item);
    }

    function openActionsMenu(event: MouseEvent, item: WorkItem) {
        const addChild = canAddChild(item)
            ? { label: item.type === "长期领域" ? "添加顶层项目…" : "添加下级工作项…", onClick: () => void openChildCapture(item) }
            : undefined;
        const parentId = item.parentIds[0] ?? null;
        const siblings = (parentId ? tree.children.get(parentId) ?? [] : tree.roots)
            .filter((candidate) => visibleIds.has(candidate.id));
        const index = siblings.findIndex((candidate) => candidate.id === item.id);
        const actions: Array<{ label: string; icon?: string; onClick: () => void }> = [];
        if (!reordering && index > 0) actions.push({ label: "上移", icon: "iconUp", onClick: () => moveSibling(item.id, -1) });
        if (!reordering && index >= 0 && index < siblings.length - 1) actions.push({ label: "下移", icon: "iconDown", onClick: () => moveSibling(item.id, 1) });
        openItemMenu(event, () => requestDelete(item), addChild, actions);
    }

    function handleWindowKeydown(event: KeyboardEvent) {
        if (event.key !== "Escape") return;
        if (deleteTarget && !deleting) {
            deleteTarget = null;
            deleteError = "";
        }
    }

    function requestDelete(item: WorkItem) {
        deleteTarget = item;
        deleteError = "";
        log.info("ui", "ui.item.delete.request", { itemId: item.id, type: item.type });
    }

    async function confirmDelete() {
        if (!data || !deleteTarget || deleting) return;
        const target = deleteTarget;
        deleting = true;
        deleteError = "";
        log.info("ui", "ui.item.delete.confirm", { itemId: target.id, type: target.type });
        try {
            const refreshed = await deleteItem(data, target);
            if (scope === target.id) scope = "all";
            if (selectedId === target.id) selectedId = null;
            // 条目已删除，钉子无处可钉：交回回落逻辑去挑下一个可见事务
            if (pinnedFocusId === target.id) pinnedFocusId = null;
            applyData(refreshed);
            deleteTarget = null;
            log.info("ui", "ui.item.delete.ok", { itemId: target.id });
        } catch (caught) {
            deleteError = caught instanceof Error ? caught.message : String(caught);
            log.error("ui", "ui.item.delete.failed", { itemId: target.id, err: deleteError });
        } finally {
            deleting = false;
        }
    }

    function emptyDetailDraft() {
        return {
            title: "", type: "", status: "", parent: "", topProject: "", planDate: "", deadline: "",
            deadlineMode: "pending", duration: "", energy: "", currentAction: "", nextAction: "",
            detail: { currentState: "", background: "", prompt: "", guidance: "", definition: "" },
        };
    }

    function resetDetailDraft(item: WorkItem) {
        detailDraft = {
            title: item.title,
            type: item.type,
            status: item.status,
            parent: item.parentIds[0] ?? "",
            topProject: item.topProjectIds[0] ?? "",
            planDate: formatInputDate(item.planDate),
            deadline: formatInputDate(item.deadline),
            deadlineMode: item.deadline ? "date" : item.noDeadline ? "none" : "pending",
            duration: item.durationMinutes === null ? "" : String(item.durationMinutes),
            energy: item.energy,
            currentAction: item.currentAction,
            nextAction: item.nextAction,
            detail: {
                currentState: itemActionDetail(item).currentState,
                background: itemActionDetail(item).background,
                prompt: itemActionDetail(item).prompt,
                guidance: itemActionDetail(item).guidance,
                definition: itemActionDetail(item).definition,
            },
        };
        draftSourceId = item.id;
        editingAction = null;
        savingAction = null;
        actionErrors = emptyEditorErrors();
        actionCursor = emptyEditorRecord(0);
        actionComposing = emptyEditorRecord(false);
        actionRestoredNotice = emptyEditorErrors();
        savedActionValues = editorRecord((field) => savedValueOf(field, item));
        resetActionImages();
        inlineError = "";
    }

    function isDetailField(field: EditorField): field is `detail:${ActionDetailField}` | "detail:nextAction" {
        return field.startsWith("detail:");
    }

    /** 细则字段在状态表里的键：点号改成不冲突的前缀形式。 */
    function editorFieldKey(field: EditorField): string {
        return isDetailField(field) ? field.replace(":", ".") : field;
    }

    function editorFieldLabel(field: EditorField): string {
        if (!isDetailField(field)) return field === "currentAction" ? fieldLabel(selected as WorkItem) : "下一步行动";
        const name = field.slice("detail:".length);
        if (name === "nextAction") return "下一步行动";
        return ACTION_DETAIL_FIELDS.find((entry) => entry.key === name)?.label ?? name;
    }

    /** 读取当前草稿值：旧的行动字段在顶层，细则字段在 detail 子对象里。 */
    function draftOf(field: EditorField): string {
        if (!isDetailField(field)) return draftOf(field);
        return detailDraft.detail[field.slice("detail:".length) as ActionDetailField];
    }

    function setDraftOf(field: EditorField, value: string): void {
        if (!isDetailField(field)) {
            detailDraft = { ...detailDraft, [field]: value };
            return;
        }
        const name = field.slice("detail:".length) as ActionDetailField;
        detailDraft = { ...detailDraft, detail: { ...detailDraft.detail, [name]: value } };
    }

    /** 条目里已保存的值：用于判断"有没有改动"。 */
    function savedValueOf(field: EditorField, item: WorkItem): string {
        if (!isDetailField(field)) return item[field];
        const name = field.slice("detail:".length);
        if (name === "nextAction") return item.nextAction;
        return itemActionDetail(item)[name as ActionDetailField];
    }

    function actionDraftStorageKey(field: EditorField): string {
        return `siyuan-plugin-xingzhou:action-draft:${draftSourceId ?? ""}:${editorFieldKey(field)}`;
    }

    /**
     * 草稿快照：输入内容先落到 sessionStorage。
     * 这不是保存（正式内容仍在点击外部／⌘Enter 时写入插件数据），只用于
     * 「刚打的字整段消失」这种系统级输入异常后的找回。
     */
    function rememberActionDraft(field: EditorField, value: string) {
        try {
            sessionStorage.setItem(actionDraftStorageKey(field), value);
        } catch {
            // 无痕模式或配额不足：草稿兜底不可用，不影响正常编辑
        }
    }

    function clearActionDraft(field: EditorField) {
        try {
            sessionStorage.removeItem(actionDraftStorageKey(field));
        } catch {
            // 同上
        }
    }

    function readActionDraft(field: EditorField): string {
        try {
            return sessionStorage.getItem(actionDraftStorageKey(field)) ?? "";
        } catch {
            return "";
        }
    }

    function startActionEditing(field: EditorField, point?: { x: number; y: number }) {
        const fieldAvailable = field === "currentAction" ? data?.fields.currentAction
            : isDetailField(field) ? true
                : data?.fields.nextAction;
        if (!selected || !fieldAvailable) return;
        // 窗口已经打开：不要用条目里的旧值重置草稿，否则点一下卡片就会吞掉刚输入的内容
        if (editingAction === field) return;
        const saved = savedValueOf(field, selected);
        const draft = readActionDraft(field);
        const recovering = draft !== "" && draft !== saved;
        const value = recovering ? draft : saved;
        setDraftOf(field, value);
        actionRestoredNotice = { ...actionRestoredNotice, [field]: recovering ? "已恢复上次未保存的草稿（本地快照）" : "" };
        actionErrors = { ...actionErrors, [field]: "" };
        fieldSaveError = "";
        actionCursor = { ...actionCursor, [field]: value.length };
        // 只记坐标；真正的落点在窗口打开后用它自己的编辑框换算（落点因此不再受卡片重排影响）
        actionWindowCaret = null;
        pendingActionCaretPoint = point ? { field, x: point.x, y: point.y } : null;
        // 窗口是浮层：打开它不该让详情面板挪位置。浏览器偶尔会因内容重排改变滚动位置，
        // 这里在打开前后把面板位置按原样写回（浮层期间面板本就应当不动）。
        const panel = detailElement;
        const panelTop = panel?.scrollTop ?? null;
        const panelMax = panel ? panel.scrollHeight - panel.clientHeight : null;
        openEditorWindow(field, value);
        if (panel && panelTop !== null) {
            /**
             * 浮层打开不应改变面板位置。只在「面板可滚动范围没变」时校正：
             * 若可滚动范围本身变了（内容真的变短），把位置硬拉回去只会与浏览器对着干。
             */
            const restore = () => {
                if (!panel.isConnected) return;
                const max = panel.scrollHeight - panel.clientHeight;
                if (panelMax !== null && Math.abs(max - panelMax) > 8) return;
                if (Math.abs(panel.scrollTop - panelTop) > 0.5) panel.scrollTop = panelTop;
            };
            restore();
            requestAnimationFrame(() => { restore(); requestAnimationFrame(restore); });
        }
    }

    /**
     * 记住点击坐标，等窗口打开后用它把光标放到对应字符处。
     * 之前会造一个不可见的量尺 textarea 来测量，那既多一次强制布局又会扰动文档；
     * 现在直接用窗口里真实的编辑框做 caretPositionFromPoint，元素为零、布局读取一次。
     */
    function caretOffsetInWindow(node: HTMLTextAreaElement | null, x: number, y: number): number | null {
        if (!node || !node.isConnected) return null;
        const rect = node.getBoundingClientRect();
        if (rect.height <= 0) return null;
        // 点在正文之外（卡片标题/提示行）：按上下位置取开头或末尾
        if (x < rect.left - 40 || x > rect.right + 40) return null;
        if (y < rect.top) return 0;
        if (y > rect.bottom) return node.value.length;
        const clampedX = Math.min(Math.max(x, rect.left + 4), rect.right - 4);
        const clampedY = Math.min(Math.max(y, rect.top + 4), rect.bottom - 4);
        if (typeof document.caretPositionFromPoint === "function") {
            const position = document.caretPositionFromPoint(clampedX, clampedY);
            if (position && position.offsetNode === node) return position.offset;
        }
        if (typeof document.caretRangeFromPoint === "function") {
            const range = document.caretRangeFromPoint(clampedX, clampedY);
            if (range && range.startContainer === node) return range.startOffset;
        }
        // 少数环境对 textarea 不返回 caret 位置：按行高估算兜底，避免直接掉到末尾
        const styles = getComputedStyle(node);
        const lineHeight = Number.parseFloat(styles.lineHeight) || 21;
        const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
        const lineIndex = Math.max(0, Math.round((clampedY - rect.top + node.scrollTop - paddingTop - lineHeight / 2) / lineHeight));
        const lines = node.value.split("\n");
        let offset = 0;
        for (let index = 0; index < Math.min(lineIndex, lines.length); index += 1) offset += lines[index].length + 1;
        return Math.min(offset, node.value.length);
    }

    /**
     * 打开大编辑窗口。卡片本身不动，编辑框位置稳定，因此不会再有"进入编辑时跳一下"，
     * 落点也不受卡片重排影响。
     */
    /** 打开大编辑窗口。旧的行动字段与结构化细则字段共用这一条链路（草稿、光标、图片、保存都复用）。 */
    function openEditorWindow(field: EditorField, value: string) {
        actionWindowDialog?.destroy();
        actionWindowField = field;
        log.info("editor", "editor.window.open", { field, length: value.length, itemId: selected?.id ?? null });
        const host = document.createElement("div");
        host.className = "xz-action-editor-window__host";
        const component = new ActionEditorWindow({
            target: host,
            props: {
                // 标题必须取当前编辑的字段：细则字段曾一律显示「下一步行动」，看起来像开错了字段
                label: editorFieldLabel(field),
                initialValue: value,
                caretOffset: actionWindowCaret,
                restoredNotice: actionRestoredNotice[field],
                saving: savingAction === field,
                error: actionErrors[field],
                dragging: actionDragging === field,
                imageRows: buildActionImageRows(field, draftOf(field), actionImageUploads[field], actionImageSizes[field]),
                imageTotal: buildActionImageTotal(draftOf(field), actionImageUploads[field]),
                pendingUploads: listPendingActionImages(draftOf(field)).length,
                onInput: (next: string, _selectionStart: number, composing: boolean) => {
                    // 列表编号只做最小就地替换；合成期间完全不碰 DOM
                    const editorNode = actionWindowNode();
                    const value = composing || !editorNode ? next : applyOrderedListNormalization(editorNode);
                    applyActionDraft(field, value, actionWindow?.currentCaret() ?? value.length);
                    void composing;
                },
                onKeydown: (event: KeyboardEvent) => handleActionKeydown(event, field),
                onPaste: (event: ClipboardEvent) => handleActionPaste(event, field),
                onDragover: (event: DragEvent) => handleActionDragOver(event, field),
                onDragleave: (event: DragEvent) => handleActionDragLeave(event, field),
                onDrop: (event: DragEvent) => handleActionDrop(event, field),
                onRemoveImage: (syntax: string) => removeDraftImage(field, syntax),
                onSave: () => void saveAction(field),
                onCancel: () => cancelActionEditing(field),
                onExplainImages: () => showMessage("直接粘贴截图，或把图片文件拖到编辑窗口里", 4000),
                onImageContextMenu: (event: MouseEvent) => handleImageContextMenu(event),
            },
        });
        actionWindow = component;
        actionWindowProps = {};
        const dialog = new Dialog({
            // 与窗口内标题同源：细则字段显示自己的字段名，不再统一写「下一步行动」
            title: editorFieldLabel(field),
            width: "82vw",
            height: "82vh",
            // 思源 Dialog 只接受字符串内容：先占位，再把组件挂进去
            content: '<div class="xz-action-editor-window__slot"></div>',
            // 点窗口外关闭时，思源只会销毁对话框，不会通知插件：必须在这里收尾，否则编辑态会卡住
            destroyCallback: () => {
                // 只处理「宿主自己关掉」的情况；插件主动关闭时已经收尾过
                if (closingActionWindow) return;
                handleActionWindowDismissed();
            },
        });
        // 兜底：部分版本点遮罩只关 DOM 不走 destroyCallback
        dialog.element.parentElement?.addEventListener("mousedown", (event) => {
            if (event.target !== event.currentTarget) return;
            handleActionWindowDismissed();
        });
        const slot = dialog.element.querySelector<HTMLElement>(".xz-action-editor-window__slot");
        if (slot) slot.append(host);
        actionWindowDialog = dialog;
        editingAction = field;
        // 打开后聚焦，并用记下的点击坐标在真实编辑框里定位光标（一次布局读取，不造额外节点）。
        // 这一帧里窗口可能已经被关掉（例如打开后立刻保存/取消，或宿主销毁对话框），
        // 所以每一步都要重新确认它还在，避免对已销毁的节点读布局。
        requestAnimationFrame(() => {
            const node = actionWindowNode();
            if (!node || !node.isConnected || !actionWindow) {
                pendingActionCaretPoint = null;
                return;
            }
            let offset = actionWindowCaret;
            const point = pendingActionCaretPoint;
            if (point && point.field === field) {
                pendingActionCaretPoint = null;
                offset = caretOffsetInWindow(node, point.x, point.y);
            }
            actionWindow.focusAt(offset);
        });
    }

    /**
     * 窗口里的实际编辑框节点；窗口可能已经被关掉（保存、取消、点窗口外），因此返回可空。
     * 不能在这里用 `as` 断言成非空：调用点如果发生在下一帧，窗口早已销毁。
     */
    /**
     * 打开细则字段的大编辑窗口。
     * 走和旧行动字段完全相同的链路：草稿兜底、光标落点、图片上传、保存与取消都复用。
     */
    function openDetailEditorWindow(field: ActionDetailField | "nextAction") {
        if (!selected) return;
        const editorField = (field === "nextAction" ? "detail:nextAction" : `detail:${field}`) as EditorField;
        detailEditingField = null;
        startActionEditing(editorField);
    }

    function actionWindowNode(): HTMLTextAreaElement | null {
        const host = actionWindowDialog?.element.querySelector<HTMLTextAreaElement>(".xz-action-editor-window__input");
        if (host) return host;
        return document.querySelector<HTMLTextAreaElement>(".xz-action-editor-window__input");
    }

    /**
     * 关闭大编辑窗口（保存、取消、以及用户在窗口外点击都走这里）。
     * 必须幂等：思源的对话框自己也会因为"点外面"而销毁，销毁回调与我们的关闭流程可能同时进来。
     */
    let closingActionWindow = false;
    function closeActionEditorWindow() {
        if (closingActionWindow) return;
        closingActionWindow = true;
        const dialog = actionWindowDialog;
        const component = actionWindow;
        actionWindowDialog = null;
        actionWindow = null;
        actionWindowField = null;
        actionWindowProps = {};
        try {
            component?.$destroy();
        } catch {
            // 组件可能已随对话框一起移除
        }
        try {
            // destroy 会触发 destroyCallback；此时 actionWindowDialog 已置空，
            // 回调里的「是否仍是当前对话框」判断会跳过重复收尾，不会递归
            dialog?.destroy();
        } catch {
            // 对话框可能已经被宿主销毁
        }
        closingActionWindow = false;
    }

    /**
     * 窗口被外部关闭（点窗口外、宿主关闭）时的收尾：
     * 不清编辑态就会出现"窗口没了，卡片还显示正在编辑，而且再也点不开"的死状态。
     */
    function handleActionWindowDismissed() {
        if (!editingAction) return;
        const field = editingAction;
        // 与卡片内联编辑时的规则保持一致：点到外面 = 保存。
        // 内容已经在 detailDraft 里（每次 input 都同步），所以先把编辑态收干净，
        // 再走统一保存流程；保存失败会写明错误并保留草稿兜底，不会静默丢内容。
        actionErrors = { ...actionErrors, [editorFieldKey(field) as EditorField]: "" };
        editingAction = null;
        actionWindowCaret = null;
        void saveAction(field);
    }

    /** 编辑结束：先卸下编辑器，再让异步结果决定草稿与保存状态。 */
    function finishActionEditing(field: EditorField) {
        if (editingAction !== field) return;
        closeActionEditorWindow();
        editingAction = null;
        actionWindowCaret = null;
    }

    function cancelActionEditing(field: EditorField) {
        if (!selected) return;
        setDraftOf(field, savedValueOf(field, selected));
        actionErrors = { ...actionErrors, [editorFieldKey(field) as EditorField]: "" };
        actionRestoredNotice = { ...actionRestoredNotice, [editorFieldKey(field) as EditorField]: "" };
        clearActionDraft(field);
        resetActionImages(field);
        finishActionEditing(field);
    }

    /** 输入链路写入草稿：光标由浏览器维护，这里只记录位置并留一份本地快照。 */
    function applyActionDraft(field: EditorField, value: string, cursor: number) {
        setDraftOf(field, value);
        
        actionCursor = { ...actionCursor, [field]: cursor };
        rememberActionDraft(field, value);
    }

    /**
     * 程序化改动草稿（插入图片、回填、移除图片）：编辑中要同步到 DOM，已收起时只改草稿。
     * 提前写入 actionSyncedValues 可让紧随其后的响应式同步跳过，从而保留光标位置。
     */
    function writeActionDraft(field: EditorField, value: string, cursor: number) {
        // 编辑中：程序化变更（插入图片、移除图片、上传回填）直接写进窗口里的编辑框
        if (editingAction === field) actionWindow?.applyValue(value, cursor);
        actionCursor = { ...actionCursor, [field]: cursor };
        setDraftOf(field, value);
        rememberActionDraft(field, value);
    }

    /** 保存前取值：窗口里的编辑框是唯一真源（输入法合成中的内容也在里面）。 */
    /**
     * 编辑结果 → 可写入的变更。
     * 旧的行动字段直接写同名字段；细则字段要落到结构化对象上（必要时连带更新下一步行动）。
     */
    function detailChangesFor(field: EditorField, value: string): WorkItemChanges {
        if (!selected) return {};
        if (!isDetailField(field)) return { [field]: value };
        const name = field.slice("detail:".length);
        if (name === "nextAction") return { nextAction: value };
        return { actionDetail: setActionDetailField(itemActionDetail(selected), name as ActionDetailField, value) };
    }

    function actionValueForSave(field: EditorField): string {
        if (editingAction === field && actionWindow) return actionWindow.currentValue();
        return draftOf(field);
    }

    /** 保存返回后草稿是否已被更新的编辑接管；接管后绝不能用旧快照覆盖。 */
    async function saveAction(field: EditorField) {
        if (!data || !selected || savingAction) return;
        // 草稿必须属于当前选中条目，否则条目切换中的失焦会把内容写进错误的条目
        if (draftSourceId !== selected.id) return;
        if (pendingUploadCount(field) > 0) {
            // 图片还在上传：先留在编辑态，上传流程结束后会补一次保存；
            // 不写入半成品后仍可能被其它流程触发保存，这里退化为移除未完成的占位符。
            const cleaned = markdownForStorage(reconcileActionUploads(field, actionValueForSave(field)));
            setDraftOf(field, cleaned);
            actionImageUploads = { ...actionImageUploads, [editorFieldKey(field) as EditorField]: [] };
            resetActionImages(field);
            return;
        }
        const value = markdownForStorage(reconcileActionUploads(field, actionValueForSave(field)));
        if (value === savedValueOf(field, selected)) {
            actionImageUploads = { ...actionImageUploads, [editorFieldKey(field) as EditorField]: [] };
            savedActionValues = { ...savedActionValues, [editorFieldKey(field) as EditorField]: value };
            clearActionDraft(field);
            finishActionEditing(field);
            return;
        }
        const sourceId = selected.id;
        const sourceRowId = selected.rowId;
        log.info("editor", "editor.action.save.start", { field, length: value.length, images: countActionImages(value), itemId: sourceId });
        savingAction = field;
        actionErrors = { ...actionErrors, [editorFieldKey(field) as EditorField]: "" };
        try {
            applyData(await saveItem(data, selected, detailChangesFor(field, value)));
            const updated = data?.items.find((item) => item.rowId === sourceRowId);
            const savedValue = updated ? savedValueOf(field, updated) : value;
            setDraftOf(field, savedValue);
            if (updated && selectedId === sourceId) draftSourceId = updated.id;
            fieldSaveError = "";
            actionImageUploads = { ...actionImageUploads, [editorFieldKey(field) as EditorField]: [] };
            savedActionValues = { ...savedActionValues, [editorFieldKey(field) as EditorField]: savedValue };
            clearActionDraft(field);
            finishActionEditing(field);
            log.info("editor", "editor.action.save.ok", { field, length: savedValue.length, itemId: sourceId });
        } catch (caught) {
            // 写入失败：内容留在草稿与窗口里，绝不静默丢掉；详情面板也显示错误，
            // 否则窗口一关错误就看不见了（窗口按 Esc／点外面关闭后不再存在）。
            setDraftOf(field, value);
            rememberActionDraft(field, value);
            const message = caught instanceof Error ? caught.message : String(caught);
            actionErrors = { ...actionErrors, [field]: message };
            fieldSaveError = message;
            log.error("editor", "editor.action.save.failed", { field, length: value.length, itemId: sourceId, err: message });
        } finally {
            savingAction = null;
        }
    }

    function handleActionKeydown(event: KeyboardEvent, field: EditorField) {
        if (event.key === "Escape") {
            event.preventDefault();
            cancelActionEditing(field);
            return;
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void saveAction(field);
            return;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.isComposing && event.target instanceof HTMLTextAreaElement) {
            const edit = continueMarkdownList(event.target.value, event.target.selectionStart, event.target.selectionEnd);
            if (!edit) return;
            event.preventDefault();
            const node = event.target;
            // 整段重写会让原生撤销栈失效：只在「新建列表项」处插入，编号重排用 setRangeText 就地改
            const inserted = edit.value.slice(node.selectionStart, edit.cursor);
            node.setRangeText(inserted, node.selectionStart, node.selectionEnd, "preserve");
            node.setSelectionRange(edit.cursor, edit.cursor);
            applyActionDraft(field, applyOrderedListNormalization(node), node.selectionStart ?? edit.cursor);
        }
    }

    function handleActionInput(event: Event, field: EditorField) {
        if (!(event.target instanceof HTMLTextAreaElement)) return;
        if ((event as InputEvent).isComposing) {
            // 输入法合成期间不回写 DOM，也不在这里做规范化：那会把候选串打散
            setDraftOf(field, event.target.value);
            return;
        }
        // 列表编号只做最小就地替换；不需要替换时完全不碰 DOM，浏览器自带的撤销与光标不受影响
        const value = applyOrderedListNormalization(event.target);
        applyActionDraft(field, value, event.target.selectionStart ?? value.length);
    }

    /**
     * 组合结束要等下一轮事件循环再解除「合成中」标记：
     * compositionend 与浏览器补发的最后一个 input 之间有一个空隙，
     * 在那个空隙里同步草稿会读到还没更新的旧值，把刚上屏的字顶掉。
     */
    function finishActionComposition(field: ActionField) {
        window.setTimeout(() => {
            actionComposing = { ...actionComposing, [editorFieldKey(field) as EditorField]: false };
        }, 0);
    }

    function handleActionCardKeydown(event: KeyboardEvent, field: ActionField) {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        startActionEditing(field);
    }

    /**
     * 编辑器挂载：写入一次草稿值并聚焦，之后输入期间不再有程序的 DOM 写入。
     * 之前用 `value={...}` 绑定会让每一帧都重设 textarea.value：
     * 拼音合成被打断、光标被拉回末尾、原生撤销栈被清空（⌘Z 无法恢复）。
     */
    async function saveInline(role: "title" | "type" | "status" | "parent" | "topProject" | "planDate" | "deadline" | "duration" | "energy", value: string) {
        if (!data || !selected || savingInline || savingSlices) return;
        if (role === "title" && !value.trim()) {
            detailDraft.title = selected.title;
            inlineError = "名称不能为空。";
            return;
        }
        const normalized: string | number | null = role === "title"
            ? value.trim()
            : role === "duration"
                ? (value === "" ? null : Number(value))
                : (role === "planDate" || role === "deadline") && value === ""
                    ? null
                    : value;
        const currentValue = role === "title" ? selected.title
            : role === "type" ? selected.type
                : role === "status" ? selected.status
                    : role === "parent" ? (selected.parentIds[0] ?? "")
                        : role === "topProject" ? (selected.topProjectIds[0] ?? "")
                            : role === "planDate" ? formatInputDate(selected.planDate)
                                : role === "deadline" ? formatInputDate(selected.deadline)
                                    : role === "duration" ? (selected.durationMinutes === null ? null : selected.durationMinutes)
                                        : selected.energy;
        if (normalized === currentValue) return;

        const changes: WorkItemChanges = { [role]: normalized };
        /*
         * 完成门槛：状态改成「已完成」但还有未完成切片／待办时，先打开处置层。
         * 这里和「标记为完成」按钮共用同一个入口，避免两条路径给出不同规则。
         */
        if (role === "status" && normalized === "已完成" && requestCompletion(selected)) {
            resetDetailDraft(selected);
            return;
        }
        if (role === "status" || role === "type") {
            // 进入终态时登记待清理图片；由终态改回进行中时清除登记
            const nextStatus = String(changes.status ?? normalized ?? "");
            const cleanup = cleanupForStatusChange(selected, nextStatus, data.items);
            if (cleanup) changes.imageCleanup = cleanup;
            else if (selected.imageCleanup && !isClosed({ ...selected, status: nextStatus })) changes.imageCleanup = null;
        }
        if (role === "parent" && data.fields.topProject) changes.topProject = deriveTopProjectId(value, tree) || null;
        if (role === "type") {
            const prospective = { ...selected, type: value };
            const profile = getWorkItemProfile(prospective, tree);
            if (!profile.statuses.includes(selected.status) && data.fields.status) changes.status = profile.statuses[0] ?? null;
            if (value === "长期领域") {
                if (data.fields.parent) changes.parent = null;
                if (data.fields.topProject) changes.topProject = null;
            } else if (data.fields.topProject) {
                changes.topProject = deriveTopProjectId(selected.parentIds[0] ?? "", tree) || null;
            }
            if (value === "事务") {
                changes.planDate = null;
                changes.completedDates = [];
            }
        }
        if (role === "planDate") {
            const targetStatus = automaticStatusForPlanDate(selected.status, value, formatInputDate(Date.now()));
            if (targetStatus && targetStatus !== selected.status) changes.status = targetStatus;
        }
        savingInline = role;
        inlineError = "";
        log.info("ui", "ui.item.field.save", { field: role, itemId: selected.id, changedFields: Object.keys(changes).sort() });
        try {
            const selectedRowId = selected.rowId;
            const refreshed = await saveItem(data, selected, changes);
            applyData(role === "status" || role === "type" || role === "parent" || role === "planDate"
                ? await reconcileAutomaticStatuses(refreshed)
                : refreshed);
            const updated = data?.items.find((item) => item.rowId === selectedRowId);
            if (updated) {
                selectedId = updated.id;
                resetDetailDraft(updated);
            }
            log.info("ui", "ui.item.field.saved", { field: role, ok: true });
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : String(caught);
            resetDetailDraft(selected);
            inlineError = message;
            log.error("ui", "ui.item.field.failed", { field: role, err: message });
        } finally {
            savingInline = null;
        }
    }

    async function addDependency(kind: DependencyKind, event: Event) {
        const select = event.currentTarget as HTMLSelectElement;
        const targetId = select.value;
        select.value = "";
        if (!selected || !targetId) return;
        const current = kind === "hardPrerequisites" ? selected.hardPrerequisiteIds ?? [] : selected.softPrerequisiteIds ?? [];
        await saveDependencies(kind, [...current, targetId]);
    }

    async function removeDependency(kind: DependencyKind, targetId: string) {
        if (!selected) return;
        const current = kind === "hardPrerequisites" ? selected.hardPrerequisiteIds ?? [] : selected.softPrerequisiteIds ?? [];
        await saveDependencies(kind, current.filter((id) => id !== targetId));
    }

    async function saveDependencies(kind: DependencyKind, ids: string[]) {
        if (!data || !selected || savingInline || savingSlices) return;
        const normalized = [...new Set(ids)];
        const validationError = validateDependencyUpdate(data.items, selected.id, kind, normalized);
        if (validationError) {
            inlineError = validationError;
            return;
        }
        const selectedRowId = selected.rowId;
        savingInline = kind;
        inlineError = "";
        log.info("ui", "ui.dependency.save", { kind, count: normalized.length, itemId: selected.id });
        try {
            applyData(await saveItem(data, selected, { [kind]: normalized }));
            const updated = data?.items.find((item) => item.rowId === selectedRowId);
            if (updated) {
                selectedId = updated.id;
                resetDetailDraft(updated);
            }
        } catch (caught) {
            inlineError = caught instanceof Error ? caught.message : String(caught);
            log.error("ui", "ui.dependency.failed", { kind, err: inlineError });
        } finally {
            savingInline = null;
        }
    }

    /* ── 本次行动细则：结构化字段与待办 ───────────────────────────────── */

    /** 细则内容（读取时补齐默认值，旧数据在存储层已完成迁移）。 */
    function itemActionDetail(item: WorkItem): ActionDetail {
        return item.actionDetail ?? createEmptyActionDetail();
    }

    function itemTodos(item: WorkItem): Todo[] {
        return item.todos ?? [];
    }

    /** 当前状态的自动行：只放系统知道的事实，不让人手抄一遍。 */
    function itemAutoFacts(item: WorkItem): string[] {
        const facts: string[] = [];
        const todos = itemTodos(item);
        if (todos.length > 0) {
            const progress = todoProgress(todos);
            facts.push(`待办 ${progress.done}/${progress.denominator}`);
        }
        if (item.type === "事务" && (item.sliceTargetCount ?? 0) > 0) {
            facts.push(`切片 ${completedSliceCount(item)}/${item.sliceTargetCount}`);
        }
        if (item.updatedAt) facts.push(`最近更新${relativeDayLabel(item.updatedAt)}`);
        if (item.deadline) {
            const days = Math.ceil((startOfLocalDay(item.deadline) - startOfLocalDay(Date.now())) / 86400000);
            facts.push(days >= 0 ? `${formatDate(item.deadline)} 截止（剩 ${days} 天）` : `${formatDate(item.deadline)} 已逾期 ${Math.abs(days)} 天`);
        }
        return facts;
    }

    /** 保存细则：结构化字段变化时由存储层同步生成兼容文本；这里只负责把新值交出去。 */
    async function saveActionDetail(item: WorkItem, nextDetail: ActionDetail, extra: WorkItemChanges = {}) {
        if (!data || savingInline || savingSlices) return;
        savingInline = "actionDetail";
        inlineError = "";
        try {
            applyData(await saveItem(data, item, { actionDetail: nextDetail, ...extra }));
            const updated = data?.items.find((candidate) => candidate.rowId === item.rowId);
            if (updated) {
                selectedId = updated.id;
                resetDetailDraft(updated);
            }
        } catch (caught) {
            inlineError = caught instanceof Error ? caught.message : String(caught);
            log.error("ui", "ui.actionDetail.failed", { itemId: item.id, err: inlineError });
        } finally {
            savingInline = null;
        }
    }

    async function saveTodos(item: WorkItem, todos: Todo[]) {
        if (!data || savingInline || savingSlices) return;
        savingInline = "todos";
        inlineError = "";
        try {
            applyData(await saveItem(data, item, { todos: normalizeTodos(todos) }));
            const updated = data?.items.find((candidate) => candidate.rowId === item.rowId);
            if (updated) {
                selectedId = updated.id;
                resetDetailDraft(updated);
            }
        } catch (caught) {
            inlineError = caught instanceof Error ? caught.message : String(caught);
            log.error("ui", "ui.todos.failed", { itemId: item.id, err: inlineError });
        } finally {
            savingInline = null;
        }
    }

    async function handleTodoAdd(item: WorkItem, text: string) {
        await saveTodos(item, addTodo(itemTodos(item), text));
    }

    async function handleTodoText(item: WorkItem, id: string, text: string) {
        const todos = itemTodos(item);
        if (findTodo(todos, id)?.text === text.trim()) return;
        await saveTodos(item, updateTodoText(todos, id, text));
    }

    async function handleTodoDetail(item: WorkItem, id: string, note: string, links: string[]) {
        const todos = itemTodos(item);
        const current = findTodo(todos, id);
        if (!current) return;
        let next = todos;
        if (current.note !== note) next = updateTodoNote(next, id, note);
        if (current.links.join("\n") !== links.join("\n")) next = updateTodoLinks(next, id, links);
        if (next === todos) return;
        await saveTodos(item, next);
    }

    async function handleTodoDone(item: WorkItem, id: string) {
        const todos = toggleTodoDone(itemTodos(item), id, localDateKey());
        await saveTodos(item, todos);
    }

    async function handleTodoDropped(item: WorkItem, id: string) {
        await saveTodos(item, toggleTodoDropped(itemTodos(item), id));
    }

    async function handleTodoRestore(item: WorkItem, id: string) {
        await saveTodos(item, toggleTodoDropped(itemTodos(item), id));
    }

    async function handleTodoRemove(item: WorkItem, id: string) {
        await saveTodos(item, removeTodo(itemTodos(item), id));
    }

    /**
     * 把待办放进今天这一片：只补今天的执行切片，不动待办本身。
     * 已有安排、目标数不够或日期不合法时按 scheduleSlice 的规则报错，不静默失败。
     */
    async function handleTodosToToday(item: WorkItem, ids: string[]) {
        if (!data || savingInline || savingSlices) return;
        if (item.type !== "事务") {
            inlineError = "只有事务可以安排执行切片；待办会留在清单里。";
            return;
        }
        const today = localDateKey();
        if ((item.executionSlices ?? []).some((slice) => slice.scheduledDate === today)) {
            inlineError = "今天已经为这个事务安排过一片了，先把那一片做完或取消。";
            return;
        }
        savingSlices = true;
        inlineError = "";
        try {
            applyData(await saveItem(data, item, withAutomaticSliceStatus(item, { executionSlices: scheduleSlice(item, today) })));
            const updated = data?.items.find((candidate) => candidate.rowId === item.rowId);
            if (updated) {
                selectedId = updated.id;
                resetDetailDraft(updated);
            }
        } catch (caught) {
            inlineError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            savingSlices = false;
        }
    }

    function handleOutcomeAdd(item: WorkItem, text: string) {
        const detail = addOutcome(itemActionDetail(item), text);
        return saveActionDetail(item, detail);
    }

    function handleOutcomeText(item: WorkItem, id: string, text: string) {
        const detail = itemActionDetail(item);
        const current = outcomesForDisplay(detail).find((outcome) => outcome.id === id);
        if (current?.text === text.trim()) return Promise.resolve();
        return saveActionDetail(item, updateOutcome(detail, id, text));
    }

    function handleOutcomeRemove(item: WorkItem, id: string) {
        return saveActionDetail(item, removeOutcome(itemActionDetail(item), id));
    }

    function handleDetailFieldSave(item: WorkItem, field: ActionDetailField, value: string) {
        return saveActionDetail(item, setActionDetailField(itemActionDetail(item), field, value));
    }

    function handleNextActionSave(item: WorkItem, value: string) {
        const nextAction = value.trim();
        if (nextAction === item.nextAction.trim()) return Promise.resolve();
        // 下一步行动是独立字段，但兼容文本由它开头，所以要把结构一起带上重新生成。
        return saveActionDetail(item, itemActionDetail(item), { nextAction });
    }

    async function copyPrompt(item: WorkItem) {
        const prompt = itemActionDetail(item).prompt.trim();
        if (!prompt) return;
        try {
            await navigator.clipboard.writeText(prompt);
            showMessage("已复制 Prompt");
        } catch {
            showMessage("复制失败，请手动选中复制");
        }
    }

    /** 套用模板：只补空字段，已写内容不覆盖；没有可补的字段时明确说一句，不静默无反应。 */
    async function applyActionTemplate(item: WorkItem, name: string) {
        const template = actionTemplates.find((candidate) => candidate.name === name);
        if (!template) {
            inlineError = `没有找到模板「${name}」。`;
            return;
        }
        const before = itemActionDetail(item);
        const after = fillDetailFromTemplate(before, template);
        const filled = (["currentState", "background", "prompt", "guidance", "definition"] as ActionDetailField[])
            .filter((field) => !before[field].trim() && after[field].trim());
        if (filled.length === 0) {
            showMessage(`模板「${name}」没有可填的空字段（已写的内容不会被覆盖）`, 4000);
            return;
        }
        await saveActionDetail(item, after);
        showMessage(`已套用模板「${name}」，补上了 ${filled.length} 个空字段`, 4000);
    }

    /**
     * 把当前细则存为模板（只存结构，不含成果条目）。
     * 名字由卡片里的输入框给出：Electron 渲染进程不支持 window.prompt，之前用它会导致
     * 「点了没反应」——这里不再依赖任何浏览器弹窗。
     */
    async function saveActionTemplate(item: WorkItem, name: string) {
        const detail = itemActionDetail(item);
        let template: ActionTemplate;
        try {
            template = templateFromDetail(name, detail);
        } catch (caught) {
            inlineError = caught instanceof Error ? caught.message : String(caught);
            return;
        }
        if (isTemplateEmpty(template)) {
            inlineError = "这份细则还是空的，没有可保存的内容。";
            return;
        }
        actionTemplates = upsertActionTemplate(actionTemplates, template);
        await saveActionTemplates(actionTemplates);
        showMessage(`已保存模板「${template.name}」`);
    }

    /* ── 完成门槛：未完成项必须显式处置 ─────────────────────────────── */

    /** 完成事务时若有未完成切片／待办，先打开处置层；否则直接完成。 */
    function requestCompletion(item: WorkItem): boolean {
        const blockers = completionBlockers(item.executionSlices ?? [], itemTodos(item), localDateKey());
        if (!blockers.needsDisposition) return false;
        completionDialogError = "";
        completionDialog = { rowId: item.rowId, title: item.title, blockers };
        return true;
    }

    /** 处置层的三个选项：全部放弃 / 原样保留 / 记录原因。 */
    async function confirmCompletion(disposition: CompletionDisposition, reason: string) {
        if (!data || !completionDialog || completionBusy) return;
        const rowId = completionDialog.rowId;
        const item = data.items.find((candidate) => candidate.rowId === rowId);
        if (!item) {
            completionDialog = null;
            return;
        }
        const blockers = completionDialog.blockers;
        const extra: WorkItemChanges = {};
        if (disposition === "drop-unfinished") {
            extra.todos = dropOpenTodos(itemTodos(item));
            extra.executionSlices = abandonUnfinishedSlices(item);
        } else if (disposition === "keep-outstanding") {
            extra.actionDetail = withCompletionNote(item, `（结束时有 ${blockers.summary}未完成，已保留为遗留项。）`);
        } else {
            const line = completionReasonLine(reason) || `（${localDateKey()} 结束事务。）`;
            extra.actionDetail = withCompletionNote(item, line);
        }
        completionBusy = true;
        completionDialogError = "";
        try {
            await performCompletion(item, extra);
            completionDialog = null;
            log.info("ui", "ui.item.complete.disposition", { itemId: item.id, disposition, remaining: blockers.items.length });
        } catch (caught) {
            completionDialogError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            completionBusy = false;
        }
    }

    /** 把未完成的切片记为放弃，而不是删除：历史保留，且不再占用待安排名额。 */
    function abandonUnfinishedSlices(item: WorkItem): ExecutionSlice[] {
        const now = Date.now();
        return (item.executionSlices ?? []).map((slice) => slice.status === "scheduled" || slice.status === "missed"
            ? { ...slice, status: "abandoned" as const, completedAt: null, updatedAt: now }
            : slice);
    }

    /** 在当前状态里追加一行说明（结束原因、遗留项数量）。 */
    function withCompletionNote(item: WorkItem, line: string): ActionDetail {
        const detail = itemActionDetail(item);
        const current = detail.currentState.trim();
        return setActionDetailField(detail, "currentState", current ? `${current}\n${line}` : line);
    }

    async function markSelectedComplete() {
        if (!selected || savingInline || savingSlices) return;
        if (requestCompletion(selected)) return;
        await performCompletion(selected);
    }

    /**
     * 真正完成：写状态（可带处置产生的附带变更），并维护撤销入口。
     * 失败时把错误抛给调用方：处置层要留在屏幕上并显示原因，不能静默吞掉。
     */
    async function performCompletion(item: WorkItem, extra: WorkItemChanges = {}) {
        if (!data) return;
        if (!data.fields.status) {
            await saveInline("status", "已完成");
            return;
        }
        const previous = { rowId: item.rowId, title: item.title, status: item.status };
        savingInline = "status";
        inlineError = "";
        try {
            const cleanup = cleanupForStatusChange(item, "已完成", data.items);
            applyData(await saveItem(data, item, {
                ...extra,
                status: "已完成",
                ...(cleanup ? { imageCleanup: cleanup } : {}),
            }));
        } catch (caught) {
            inlineError = caught instanceof Error ? caught.message : String(caught);
            throw caught instanceof Error ? caught : new Error(inlineError);
        } finally {
            savingInline = null;
        }
        const updated = data?.items.find((candidate) => candidate.rowId === previous.rowId);
        if (updated?.status !== "已完成") return;
        if (filter !== "closed" && !(filter === "all" && includeClosed)) {
            if (scope === updated.id) scope = "all";
            const nextVisible = data?.items.find((item) => !isClosed(item));
            selectedId = nextVisible?.id ?? null;
        }
        clearCompletionUndo();
        completionUndo = previous;
        completionUndoTimer = setTimeout(clearCompletionUndo, 8000);
    }

    async function undoCompletion() {
        if (!data || !completionUndo || savingInline || savingSlices || undoingCompletion) return;
        const snapshot = completionUndo;
        const item = data.items.find((candidate) => candidate.rowId === snapshot.rowId);
        if (!item) {
            clearCompletionUndo();
            return;
        }
        undoingCompletion = true;
        savingInline = "status";
        inlineError = "";
        try {
            const refreshed = await saveItem(data, item, { status: snapshot.status || null });
            applyData(refreshed);
            const restored = refreshed.items.find((candidate) => candidate.rowId === snapshot.rowId);
            if (restored) {
                selectedId = restored.id;
                resetDetailDraft(restored);
            }
            clearCompletionUndo();
        } catch (caught) {
            inlineError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            savingInline = null;
            undoingCompletion = false;
        }
    }

    function clearCompletionUndo() {
        if (completionUndoTimer) clearTimeout(completionUndoTimer);
        completionUndoTimer = null;
        completionUndo = null;
    }

    async function saveDeadlineMode(mode: string) {
        if (!data || !selected || savingInline || savingSlices) return;
        detailDraft.deadlineMode = mode;
        if (mode === "date") return;
        if (!data.fields.noDeadline) {
            detailDraft.deadlineMode = selected.deadline ? "date" : "pending";
            inlineError = "内部数据字段暂不可用，无法明确保存为“无”。";
            return;
        }
        await saveDeadlineChanges(mode === "none"
            ? { deadline: null, noDeadline: true }
            : { deadline: null, noDeadline: false });
    }

    async function saveDeadlineDate(value: string) {
        if (!data || !selected || savingInline || savingSlices) return;
        if (value && selected.type === "事务" && (selected.executionSlices ?? []).some((slice) => slice.scheduledDate > value)) {
            detailDraft.deadline = formatInputDate(selected.deadline);
            inlineError = "截止日期不能早于已有执行记录；请先取消或调整受影响的切片。";
            return;
        }
        detailDraft.deadline = value;
        if (!value) {
            detailDraft.deadlineMode = "pending";
            if (data.fields.noDeadline) await saveDeadlineChanges({ deadline: null, noDeadline: false });
            else await saveDeadlineChanges({ deadline: null });
            return;
        }
        detailDraft.deadlineMode = "date";
        await saveDeadlineChanges(data.fields.noDeadline
            ? { deadline: value, noDeadline: false }
            : { deadline: value });
    }

    async function saveDeadlineChanges(changes: WorkItemChanges) {
        if (!data || !selected || savingInline || savingSlices) return;
        const selectedRowId = selected.rowId;
        savingInline = "deadline";
        inlineError = "";
        try {
            applyData(await saveItem(data, selected, changes));
            const updated = data?.items.find((item) => item.rowId === selectedRowId);
            if (updated) {
                selectedId = updated.id;
                resetDetailDraft(updated);
            }
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : String(caught);
            resetDetailDraft(selected);
            inlineError = message;
        } finally {
            savingInline = null;
        }
    }

    async function updateWeekItem(item: WorkItem, changes: WorkItemChanges, options: { sliceUndo?: boolean } = {}) {
        if (!data || weekSavingIds.has(item.id)) return;
        weekSavingIds = new Set(weekSavingIds).add(item.id);
        weekError = "";
        try {
            const prepared = options.sliceUndo
                ? withSliceUndoStatus(item, changes)
                : withAutomaticSliceStatus(item, changes);
            applyData(await reconcileAutomaticStatuses(await saveItem(data, item, prepared)));
        } catch (caught) {
            weekError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            const next = new Set(weekSavingIds);
            next.delete(item.id);
            weekSavingIds = next;
        }
    }

    async function toggleLegacyWeekDateCompletion(item: WorkItem, dateKey: string) {
        const completedDates = new Set(item.completedDates ?? []);
        completedDates.has(dateKey) ? completedDates.delete(dateKey) : completedDates.add(dateKey);
        await updateWeekItem(item, { completedDates: [...completedDates].sort() });
    }

    /**
     * 详情页日历里保存切片：默认走“完成”的自动规则；撤销时走 undo 规则
     * （事务若已是「已完成」，撤销后不再满额就退回「进行中」）。
     */
    async function saveSelectedSlices(changes: WorkItemChanges, options: { sliceUndo?: boolean } = {}) {
        if (!data || !selected || savingInline || savingSlices) return;
        const selectedRowId = selected.rowId;
        savingSlices = true;
        inlineError = "";
        try {
            const prepared = options.sliceUndo
                ? withSliceUndoStatus(selected, changes)
                : withAutomaticSliceStatus(selected, changes);
            applyData(await saveItem(data, selected, prepared));
            const updated = data?.items.find((item) => item.rowId === selectedRowId);
            if (updated) {
                selectedId = updated.id;
                resetDetailDraft(updated);
            }
        } catch (caught) {
            inlineError = caught instanceof Error ? caught.message : String(caught);
            throw caught;
        } finally {
            savingSlices = false;
        }
    }

    function withAutomaticSliceStatus(item: WorkItem, changes: WorkItemChanges): WorkItemChanges {
        return withSliceCleanup(item, automaticSliceStatusChanges(item, changes));
    }

    function withSliceUndoStatus(item: WorkItem, changes: WorkItemChanges): WorkItemChanges {
        return withSliceCleanup(item, automaticSliceUndoChanges(item, changes));
    }

    /**
     * 切片动作把事务自动推进到终态时，图片登记要和「标记为完成」保持一致：
     * 进入终态就登记待清理，退回进行中则清除登记。
     */
    function withSliceCleanup(item: WorkItem, changes: WorkItemChanges): WorkItemChanges {
        const status = typeof changes.status === "string" ? changes.status : "";
        if (!status || status === item.status) return changes;
        const cleanup = cleanupForStatusChange(item, status, data?.items ?? []);
        if (cleanup) return { ...changes, imageCleanup: cleanup };
        if (item.imageCleanup && !isClosed({ ...item, status })) return { ...changes, imageCleanup: null };
        return changes;
    }

    async function updateWeekSlice(item: WorkItem, slice: ExecutionSlice, action: "complete" | "miss" | "abandon" | "undo") {
        try {
            const executionSlices = action === "undo"
                ? undoCompletedSlice(item, slice.id)
                : action === "complete"
                    ? completeSliceNow(item, slice.id)
                    : setSliceOutcome(item, slice.id, action === "miss" ? "missed" : "abandoned");
            await updateWeekItem(item, { executionSlices }, { sliceUndo: action === "undo" });
        } catch (caught) {
            weekError = caught instanceof Error ? caught.message : String(caught);
        }
    }

    async function scheduleWeekSlice(item: WorkItem, dateKey: string) {
        try {
            await updateWeekItem(item, { executionSlices: scheduleSlice(item, dateKey) });
        } catch (caught) {
            weekError = caught instanceof Error ? caught.message : String(caught);
        }
    }

    async function changeWeekSliceDate(item: WorkItem, slice: ExecutionSlice, dateKey: string) {
        try {
            const executionSlices = dateKey
                ? moveScheduledSlice(item, slice.id, dateKey)
                : cancelScheduledSlice(item, slice.id);
            await updateWeekItem(item, { executionSlices });
        } catch (caught) {
            weekError = caught instanceof Error ? caught.message : String(caught);
        }
    }

    function handleWeekSliceAssignment(event: Event, item: WorkItem, slice: ExecutionSlice) {
        const select = event.currentTarget as HTMLSelectElement;
        const dateKey = select.value === "__clear" ? "" : select.value;
        select.value = "";
        void changeWeekSliceDate(item, slice, dateKey);
    }

    function handleNewWeekSliceAssignment(event: Event, item: WorkItem) {
        const select = event.currentTarget as HTMLSelectElement;
        const dateKey = select.value;
        select.value = "";
        if (dateKey) void scheduleWeekSlice(item, dateKey);
    }

    async function assignWeekDate(item: WorkItem, dateKey: string) {
        const deadlineKey = formatInputDate(item.deadline);
        if (dateKey && deadlineKey && dateKey > deadlineKey) {
            weekError = `“${item.title}”的计划开始日不能晚于截止日期 ${deadlineKey}。如需整体后移，请先在详情中调整截止日期。`;
            return;
        }
        const changes: WorkItemChanges = { planDate: dateKey || null };
        const targetStatus = automaticStatusForPlanDate(item.status, dateKey, formatInputDate(Date.now()));
        if (targetStatus && targetStatus !== item.status) changes.status = targetStatus;
        await updateWeekItem(item, changes);
    }

    function handleWeekAssignment(event: Event, item: WorkItem) {
        const select = event.currentTarget as HTMLSelectElement;
        const dateKey = select.value === "__clear" ? "" : select.value;
        select.value = "";
        void assignWeekDate(item, dateKey);
    }

    function startOfWeek(timestamp: number): number {
        const date = new Date(timestamp);
        date.setHours(0, 0, 0, 0);
        const day = date.getDay();
        date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
        return date.getTime();
    }

    function buildWeekDays(start: number): WeekDay[] {
        const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
        return labels.map((label, index) => {
            const date = new Date(start);
            date.setDate(date.getDate() + index);
            return {
                timestamp: date.getTime(),
                key: formatInputDate(date.getTime()),
                label,
                dateLabel: `${date.getMonth() + 1}月${date.getDate()}日`,
                isToday: isToday(date.getTime()),
            };
        });
    }

    function getUnscheduledWeekItems(items: WorkItem[]): WorkItem[] {
        const excludedStatuses = new Set(["收件箱", "暂停", "将来", "将来／也许", "已完成", "已失败", "已取消", "已放弃"]);
        return items
            .filter((item) => {
                if (excludedStatuses.has(item.status)) return false;
                if (item.type === "事务") return Boolean(item.deadline && item.sliceTargetCount && availableSliceCount(item) > 0);
                return item.type === "想法" && !item.planDate;
            })
            .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    }

    function getActiveWindowItems(items: WorkItem[], scheduledIds: Set<string>): WorkItem[] {
        const excludedStatuses = new Set(["收件箱", "暂停", "将来", "将来／也许", "已完成", "已失败", "已取消", "已放弃"]);
        const today = formatInputDate(Date.now());
        return items
            .filter((item) => {
                if (scheduledIds.has(item.id) || item.type !== "想法" || !item.planDate || !item.deadline || excludedStatuses.has(item.status)) return false;
                return formatInputDate(item.planDate) <= today && formatInputDate(item.deadline) >= today;
            })
            .sort((a, b) => (a.deadline ?? 0) - (b.deadline ?? 0) || a.title.localeCompare(b.title, "zh-CN"));
    }

    function getReviewFocusedDomains(items: WorkItem[]): WorkItem[] {
        return items
            .filter((item) => item.type === "长期领域" && item.status === "重点投入")
            .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    }

    function getReviewOngoingProjects(items: WorkItem[]): WorkItem[] {
        return items
            .filter((item) => {
                if (item.type !== "项目" || (item.status !== "进行中" && item.status !== "活跃")) return false;
                const parentItem = item.parentIds[0] ? tree.byId.get(item.parentIds[0]) : null;
                return !parentItem || parentItem.type === "长期领域";
            })
            .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    }

    function getReviewMissingActionItems(items: WorkItem[], higherPriorityIds: Set<string>): WorkItem[] {
        if (!data?.fields.currentAction) return [];
        const actionableStatuses = new Set(["待开始", "进行中", "阻塞"]);
        return items
            // 判据换成结构化细则 + 下一步行动：只要写过任意一处就不再提示补细则
            .filter((item) => !higherPriorityIds.has(item.id) && (item.type === "事务" || item.type === "想法")
                && actionableStatuses.has(displayStatus(item.status))
                && actionDetailMissing(itemActionDetail(item), item.nextAction))
            .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    }

    function getReviewDateItems(items: WorkItem[]): WorkItem[] {
        const excludedStatuses = new Set(["收件箱", "暂停", "将来", "将来／也许"]);
        return items
            .filter((item) => !isClosed(item) && !excludedStatuses.has(item.status) && (needsDeadlineDecision(item, tree) || isOverdue(item)))
            .sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || (a.deadline ?? a.planDate ?? 0) - (b.deadline ?? b.planDate ?? 0));
    }

    function getReviewCompletedThisWeek(items: WorkItem[]): WorkItem[] {
        const thisWeekStart = startOfWeek(Date.now());
        return items
            .filter((item) => isClosed(item) && Boolean(item.updatedAt && item.updatedAt >= thisWeekStart))
            .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    }

    function reviewDateReason(item: WorkItem): string {
        if (isOverdue(item)) return `截止日期已过 · ${formatDate(item.deadline)}`;
        return "截止日期待确认";
    }

    function getParentCandidates(item: WorkItem): WorkItem[] {
        const descendants = collectDescendantIds(item.id, tree);
        const currentParentId = item.parentIds[0] ?? "";
        return (data?.items ?? []).filter((candidate) => {
            if (candidate.id === item.id || descendants.has(candidate.id)) return false;
            if (candidate.id === currentParentId) return true;
            if (item.type === "项目") return candidate.type === "长期领域" || candidate.type === "项目";
            // 「任务」已退役：执行层（事务／想法）只挂在项目下，层级简化为 领域 → 项目 → 事务／想法。
            if (item.type === "事务" || item.type === "想法") return candidate.type === "项目";
            return true;
        });
    }

    function shiftWeek(offset: number) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + offset * 7);
        weekStart = date.getTime();
    }

    function formatWeekRange(): string {
        const end = new Date(weekStart);
        end.setDate(end.getDate() + 6);
        const start = new Date(weekStart);
        return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 — ${end.getMonth() + 1}月${end.getDate()}日`;
    }

    function getVisibleIds(pinnedFocusId: string | null): Set<string> {
        if (!data) return new Set();
        let candidates = data.items;
        if (scope !== "all") {
            const ids = collectDescendantIds(scope, tree);
            candidates = data.items.filter((item) => ids.has(item.id));
        }

        const todayKey = localDateKey(todayNow);
        const matched = candidates.filter((item) => matchesFilter(item, todayKey));
        const pinnedId = pinnedFocusId && tree.byId.has(pinnedFocusId) ? pinnedFocusId : null;
        // 被钉住的选中项按“命中”参与可见性计算：即使它已不再匹配筛选，完整上层路径也会留在树里
        if (pinnedId && !matched.some((item) => item.id === pinnedId)) matched.push(tree.byId.get(pinnedId)!);
        if (filter === "all" && includeClosed) return new Set(matched.map((item) => item.id));

        const result = new Set(matched.map((item) => item.id));
        for (const item of matched) {
            const seen = new Set<string>();
            let parentId: string | undefined = item.parentIds[0];
            while (parentId && !seen.has(parentId)) {
                seen.add(parentId);
                result.add(parentId);
                parentId = tree.byId.get(parentId)?.parentIds[0];
            }
        }
        return result;
    }

    function getVisibleRoots(pinnedFocusId: string | null): WorkItem[] {
        if (scope !== "all") {
            const scoped = tree.byId.get(scope);
            return scoped && visibleIds.has(scoped.id) ? [scoped] : [];
        }
        const roots = tree.roots.filter((item) => visibleIds.has(item.id));
        // 钉住的选中项若落在常规根路径之外，单独作为一条根路径显示；已在常规根路径之内的不重复显示
        const pinned = pinnedFocusId ? tree.byId.get(pinnedFocusId) : undefined;
        if (pinned && visibleIds.has(pinned.id) && !roots.some((item) => item.id === pinned.id)) {
            const visibleRootIds = new Set(roots.map((item) => item.id));
            const seen = new Set<string>();
            let parentId: string | undefined = pinned.parentIds[0];
            let coveredByRoot = false;
            while (parentId && !seen.has(parentId)) {
                seen.add(parentId);
                if (visibleRootIds.has(parentId)) {
                    coveredByRoot = true;
                    break;
                }
                parentId = tree.byId.get(parentId)?.parentIds[0];
            }
            if (!coveredByRoot) roots.push(pinned);
        }
        return roots;
    }

    function toggle(id: string) {
        const next = new Set(expandedIds);
        next.has(id) ? next.delete(id) : next.add(id);
        expandedIds = next;
    }

    async function reorderRelative(draggedId: string, targetId: string, position: "before" | "after") {
        if (!data || reordering || draggedId === targetId) return;
        const dragged = tree.byId.get(draggedId);
        const target = tree.byId.get(targetId);
        if (!dragged || !target) return;
        const parentId = dragged.parentIds[0] ?? null;
        if ((target.parentIds[0] ?? null) !== parentId) {
            reorderError = "只能调整同一上层下的工作项顺序。";
            return;
        }
        const siblings = parentId ? [...(tree.children.get(parentId) ?? [])] : [...tree.roots];
        const withoutDragged = siblings.filter((item) => item.id !== draggedId);
        const targetIndex = withoutDragged.findIndex((item) => item.id === targetId);
        if (targetIndex < 0) return;
        withoutDragged.splice(targetIndex + (position === "after" ? 1 : 0), 0, dragged);
        const orderedIds = withoutDragged.map((item) => item.id);
        if (orderedIds.every((id, index) => id === siblings[index]?.id)) return;

        const previousExpandedIds = new Set(expandedIds);
        reordering = true;
        reorderError = "";
        try {
            applyData(await reorderItems(data, parentId, orderedIds));
            expandedIds = new Set([...previousExpandedIds].filter((id) => tree.byId.has(id)));
        } catch (caught) {
            reorderError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            draggingId = null;
            reordering = false;
        }
    }

    function moveSibling(itemId: string, direction: -1 | 1) {
        const item = tree.byId.get(itemId);
        if (!item || reordering) return;
        const parentId = item.parentIds[0] ?? null;
        const siblings = (parentId ? tree.children.get(parentId) ?? [] : tree.roots)
            .filter((candidate) => visibleIds.has(candidate.id));
        const index = siblings.findIndex((candidate) => candidate.id === itemId);
        const target = siblings[index + direction];
        if (!target) return;
        void reorderRelative(itemId, target.id, direction < 0 ? "before" : "after");
    }

    function expandActivePaths() {
        expandedIds = new Set((data?.items ?? []).filter((item) => hasActiveDescendant(item.id, tree)).map((item) => item.id));
    }

    function expandAllVisible() {
        expandedIds = new Set((data?.items ?? []).filter((item) => (tree.children.get(item.id) ?? []).some((child) => visibleIds.has(child.id))).map((item) => item.id));
    }

    function getDefaultExpandedIds(targetFilter: ItemFilter, items: WorkItem[]): Set<string> {
        if (targetFilter === "active") return new Set(items.filter((item) => hasActiveDescendant(item.id, tree)).map((item) => item.id));
        // 今日与其余筛选一样默认完整展开：今日命中项本来就少，祖先收起等于看不见
        return new Set(items.filter((item) => (tree.children.get(item.id) ?? []).length > 0).map((item) => item.id));
    }

    function setFilter(nextFilter: ItemFilter) {
        const previousFilter = filter;
        filter = nextFilter;
        scope = "all";
        log.verbose("ui", "ui.filter.changed", { from: previousFilter, to: nextFilter });
        // 主动切筛选属于用户明确动作：放下钉子，让本轮筛选如实生效
        pinnedFocusId = null;
        focusPinRejected = nextFilter !== previousFilter;
        expandedIds = getDefaultExpandedIds(nextFilter, data?.items ?? []);
    }

    function collapseAll() {
        expandedIds = new Set();
    }

    /** 「3 天前」这类相对说法；同一天统一说「今天」。 */
    function relativeDayLabel(timestamp: number | null): string {
        if (!timestamp) return "";
        const days = Math.floor((startOfLocalDay(Date.now()) - startOfLocalDay(timestamp)) / 86400000);
        if (days <= 0) return "今天";
        if (days === 1) return "昨天";
        if (days < 30) return `${days} 天前`;
        const months = Math.floor(days / 30);
        return months < 12 ? `${months} 个月前` : `${Math.floor(months / 12)} 年前`;
    }

    function startOfLocalDay(timestamp: number): number {
        const date = new Date(timestamp);
        date.setHours(0, 0, 0, 0);
        return date.getTime();
    }

    function formatDate(timestamp: number | null): string {
        if (!timestamp) return "—";
        return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
    }

    function formatInputDate(timestamp: number | null): string {
        if (!timestamp) return "";
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function displayStatus(status: string): string {
        if (status === "活跃") return "进行中";
        if (status === "规划中") return "待开始";
        if (status === "等待") return "阻塞";
        if (status === "将来／也许") return "将来";
        if (status === "已计划") return "待开始";
        return status;
    }

    function sliceStatusLabel(status: ExecutionSlice["status"]): string {
        if (status === "completed") return "✓ 已完成";
        if (status === "missed") return "未完成";
        if (status === "abandoned") return "已放弃";
        return "已安排";
    }

    function isEarlyCompletedSlice(slice: ExecutionSlice): boolean {
        return slice.status === "completed" && Boolean(slice.completedAt)
            && localDateKey(slice.completedAt ?? 0) < slice.scheduledDate;
    }

    function shortDateLabel(dateKey: string): string {
        const [, month, day] = dateKey.split("-");
        return `${Number(month)}月${Number(day)}日`;
    }

    function sliceCompletionDateLabel(slice: ExecutionSlice): string {
        if (!slice.completedAt) return "";
        const completedDate = localDateKey(slice.completedAt);
        return completedDate === localDateKey() ? "今天" : shortDateLabel(completedDate);
    }

    function isToday(timestamp: number | null): boolean {
        if (!timestamp) return false;
        const date = new Date(timestamp);
        const today = new Date();
        return date.getFullYear() === today.getFullYear()
            && date.getMonth() === today.getMonth()
            && date.getDate() === today.getDate();
    }

    function isFuturePlanDate(timestamp: number | null): boolean {
        return Boolean(timestamp && formatInputDate(timestamp) > formatInputDate(Date.now()));
    }

    function isOverdue(item: WorkItem): boolean {
        if (!item.deadline || isClosed(item)) return false;
        const deadline = new Date(item.deadline);
        deadline.setHours(23, 59, 59, 999);
        return deadline.getTime() < Date.now();
    }

    // ===== 图片待清理 =====

    $: pendingImageCleanups = listPendingImageCleanup(data?.items ?? []);
    $: cleanupPageRows = cleanupRowsFor(data?.items ?? []);
    // 依赖必须出现在表达式层级：放进 map 回调里 Svelte 追踪不到（会不重算）
    $: cleanupConfirmExcluded = `${cleanupExcludedImages.size}:${cleanupExcludedItems.size}`;
    $: cleanupConfirmCandidateSrcs = cleanupConfirmRows.flatMap((row) => cleanupImagesOf(row.item).map((image) => image.src));
    $: cleanupConfirmPlan = cleanupConfirming
        ? (void cleanupConfirmExcluded, buildCleanupPlanFromSelection())
        : [];
    $: cleanupConfirmRemovable = removablePathsOf(cleanupConfirmPlan);
    $: cleanupConfirmBytes = cleanupConfirmRemovable.reduce(
        (sum, path) => sum + (actionImageSizes.currentAction[path] ?? actionImageSizes.nextAction[path] ?? 0), 0);
    $: storageStats = buildStorageStats(data?.items ?? [], assetSizes);
    $: pendingCleanupBytes = pendingImageCleanups.reduce(
        (sum, entry) => sum + entry.images.reduce((inner, image) => inner + (assetSizes[image.src] ?? 0), 0), 0);
    $: storageShare = assetLibraryBytes && assetLibraryBytes > 0
        ? Math.min(100, Math.round((storageStats.bytes / assetLibraryBytes) * 1000) / 10)
        : null;
    $: activeBytesForBar = Math.max(0, storageStats.bytes - pendingCleanupBytes);
    $: storageSegments = assetLibraryBytes && assetLibraryBytes > 0
        ? (() => {
            const other = Math.max(0, assetLibraryBytes - storageStats.bytes);
            const total = assetLibraryBytes;
            return {
                active: (activeBytesForBar / total) * 100,
                pending: (pendingCleanupBytes / total) * 100,
                other: (other / total) * 100,
                otherBytes: other,
            };
        })()
        : null;
    $: cleanupConfirmGroups = cleanupConfirming
        ? cleanupConfirmRows.map((row) => {
            const images = cleanupImagesOf(row.item);
            return {
                row,
                images: images.map((image) => {
                    // 可删除只看"是否仍被其它未结束条目引用"，与勾选状态无关
                    const referencedBy = referencingActiveItems(image.src, [row.item.id], data?.items ?? [])
                        .map((item) => item.title)
                        .join("、");
                    return {
                        ...image,
                        removable: referencedBy === "",
                        selected: cleanupSelectedImages.has(image.src),
                        blockedReason: referencedBy,
                    };
                }),
            };
        })
        : [];
    $: pendingImageCleanupTotal = pendingImageCleanups.reduce((sum, entry) => sum + entry.images.length, 0);
    $: selectedCleanupBadge = selected ? cleanupBadgeLabel(selected) : null;

    type CleanupRow = { item: WorkItem; entry: ActionImageCleanupEntry; chain: string[] };
    type CleanupResult = { deleted: number; kept: number; bytes: number; failures: string[] };

    let cleanupConfirmRows: CleanupRow[] = [];
    let cleanupConfirming = false;
    /** 页内确认步骤：用户取消勾选的图片路径（默认全部勾选） */
    let cleanupExcludedImages = new Set<string>();
    /** 每张图的勾选状态：进入确认步骤时初始化一次，之后只由交互改变 */
    let cleanupSelectedImages = new Set<string>();
    let cleanupExcludedItems = new Set<string>();
    /** 页内确认的进行状态与结果 */
    let cleanupRunning = false;
    let cleanupError = "";
    let cleanupResult: CleanupResult | null = null;
    /** 图库体检：行舟引用的图片体积（按资源路径）与资源库总量 */
    let assetSizes: Record<string, number> = {};
    let assetLibraryBytes: number | null = null;
    let assetLibraryCount = 0;
    let assetStatsLoading = false;
    let assetStatsLoaded = false;
    let assetStatsError = "";

    function cleanupRowsFor(items: WorkItem[]): CleanupRow[] {
        const byId = new Map(items.map((item) => [item.id, item]));
        return pendingImageCleanups
            .filter((entry) => byId.has(entry.item.id))
            .map((entry) => ({ item: entry.item, entry, chain: cleanupParentChain(entry.item, items) }));
    }

    function formatCleanupCountdown(entry: ActionImageCleanupEntry): string {
        if (entry.remainingDays <= 0) return "今天到期，可确认清理";
        return `还剩 ${entry.remainingDays} 天（${IMAGE_CLEANUP_GRACE_DAYS} 天后解锁）`;
    }

    function cleanupEscape(value: string): string {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");
    }

    /** 页内确认后真正执行：先摘引用 → 只删思源认为未引用的文件 → 清登记 */
    async function runImageCleanup() {
        if (!data || cleanupRunning) return;
        // 必须在这里一次性取定：后面会清空勾选状态，重算会退回全选
        const plan = buildCleanupPlanFromSelection();
        const paths = removablePathsOf(plan);
        if (paths.length === 0) {
            cleanupError = "当前没有可删除的图片（被保留的图片仍被其它未结束条目引用，或你已取消勾选）。";
            return;
        }
        cleanupRunning = true;
        cleanupError = "";
        cleanupResult = null;
        const result: CleanupResult = { deleted: 0, kept: keptPathsOf(plan).length, bytes: 0, failures: [] };
        try {
                const touched = new Set<string>();
            let current = data;
            for (const entry of plan) {
                const item = current.items.find((candidate) => candidate.id === entry.itemId);
                if (!item) continue;
                // 一次写完：摘引用 + 清登记。避免之后再写一次去覆盖正文
                current = await saveItem(current, item, {
                    ...entry.changes,
                    imageCleanup: entry.hasImagesAfter ? item.imageCleanup ?? null : null,
                });
                touched.add(entry.itemId);
            }
            void touched;
            applyData(current);

            const unused = await listUnusedAssetPaths();
            for (const path of paths) {
                if (!unused.paths.has(path)) {
                    result.kept += 1;
                    continue;
                }
                const removal = await removeUnusedAsset(path);
                if (removal.removed) result.deleted += 1;
                else result.failures.push(`${removal.path}：${removal.reason}`);
            }
            if (unused.truncated && result.failures.length > 0) {
                result.failures.push("思源一次最多返回 512 条未引用资源，部分图片需要稍后重试。");
            }

            cleanupResult = result;
            cleanupConfirmRows = [];
            cleanupExcludedImages = new Set();
            cleanupExcludedItems = new Set();
        } catch (caught) {
            cleanupError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            cleanupRunning = false;
        }
    }

    let cleanupManagerDialog: Dialog | null = null;
    let cleanupManagerEvents: Array<() => void> = [];

    /** 进入图片清理页面（整页渲染，避免弹窗宽度受限导致文字被截断）。 */
    function openCleanupPage() {
        closeCleanupManager();
        page = "cleanup";
        void loadAssetStats();
    }

    /** 图库体检：取行舟图片体积与资源库总量。结果缓存，避免每次进页面都重扫。 */
    async function loadAssetStats(force = false) {
        if (assetStatsLoading) return;
        if (assetStatsLoaded && !force) return;
        assetStatsLoading = true;
        assetStatsError = "";
        try {
            const paths = [...new Set((data?.items ?? []).flatMap((item) =>
                listItemImages(item)
                    .map((image) => image.src)
                    .filter((src): src is string => Boolean(src) && src.startsWith("assets/"))))];
            const sizes = await readAssetSizes(paths);
            if (sizes.size > 0) {
                const merged: Record<string, number> = { ...assetSizes };
                for (const [path, bytes] of sizes) merged[path] = bytes;
                assetSizes = merged;
            }
            const library = await readAssetLibrarySize();
            if (library) {
                assetLibraryBytes = library.totalBytes;
                assetLibraryCount = library.fileCount;
            }
        } catch (caught) {
            assetStatsError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            assetStatsLoading = false;
            assetStatsLoaded = true;
        }
    }

    /** 进入页内确认步骤（不再用弹窗：弹窗宽度不可控，内容右侧会留白） */
    function openCleanupConfirmForItem(itemId: string) {
        const item = data?.items.find((candidate) => candidate.id === itemId);
        if (!item) return;
        closeCleanupManager();
        cleanupConfirmRows = cleanupRowsFor([item]);
        cleanupExcludedImages = new Set();
        cleanupSelectedImages = new Set(cleanupImagesOf(item).map((image) => image.src));
        cleanupExcludedItems = new Set();
        cleanupResult = null;
        cleanupError = "";
        cleanupConfirming = true;
    }

    function openCleanupConfirmForAll() {
        closeCleanupManager();
        cleanupConfirmRows = cleanupPageRows;
        cleanupExcludedImages = new Set();
        cleanupSelectedImages = new Set(cleanupPageRows.flatMap((row) => cleanupImagesOf(row.item).map((image) => image.src)));
        cleanupExcludedItems = new Set();
        cleanupResult = null;
        cleanupError = "";
        cleanupConfirming = true;
    }

    function leaveCleanupConfirm() {
        cleanupConfirming = false;
        cleanupExcludedImages = new Set();
        cleanupExcludedItems = new Set();
        cleanupResult = null;
        cleanupError = "";
    }

    /** 点图片本身也能切换勾选（不只是点小方块） */
    function toggleCleanupPick(src: string, removable: boolean) {
        if (!removable) return;
        toggleCleanupImage(src, !cleanupSelectedImages.has(src));
    }

    /**
     * 勾选状态只由交互改变（cleanupSelectedImages），删除范围 = 未选中的那些。
     * 之前每帧从派生值推导 checked，取消勾选后 Svelte 认为值仍是 true，导致无法再选。
     */
    function toggleCleanupImage(src: string, checked: boolean) {
        const selected = new Set(cleanupSelectedImages);
        if (checked) selected.add(src);
        else selected.delete(src);
        cleanupSelectedImages = selected;
        cleanupExcludedImages = new Set(cleanupConfirmCandidateSrcs.filter((path) => !selected.has(path)));
    }

    /** 页内确认用的执行范围：按勾选状态现算 */
    function buildCleanupPlanFromSelection(): ImageCleanupTextUpdate[] {
        const rows = cleanupConfirmRows.filter((row) => !cleanupExcludedItems.has(row.item.id));
        const all = cleanupImagesOf;
        void all;
        // 删除范围 = 已勾选的图片；未勾选的不参与删除
        const onlyPaths = cleanupConfirmCandidateSrcs.filter((src) => cleanupSelectedImages.has(src));
        return buildImageCleanupPlan(rows.map((row) => row.item), data?.items ?? [], { onlyPaths });
    }

    function closeCleanupManager() {
        for (const off of cleanupManagerEvents) off();
        cleanupManagerEvents = [];
        cleanupManagerDialog?.destroy();
        cleanupManagerDialog = null;
    }

    /** 工具栏入口：列出全部待清理条目；没有内容时给出空状态说明。 */


    function fieldLabel(item: WorkItem): string {
        return getWorkItemProfile(item, tree).actionLabel;
    }

    function otherActionField(field: ActionField): ActionField {
        return field === "currentAction" ? "nextAction" : "currentAction";
    }

    function updateActionCursor(event: Event, field: ActionField) {
        if (event.target instanceof HTMLTextAreaElement) actionCursor[field] = event.target.selectionStart ?? 0;
    }

    function resetActionImages(field?: EditorField) {
        const target = field ? [field] : (["currentAction", "nextAction"] as ActionField[]);
        const uploads = { ...actionImageUploads };
        const sizes = { ...actionImageSizes };
        for (const name of target) {
            uploads[name] = [];
            sizes[name] = {};
        }
        actionImageUploads = uploads;
        actionImageSizes = sizes;
    }

    function applyDetailEdit(field: EditorField, edit: ActionEdit) {
        writeActionDraft(field, edit.value, edit.cursor);
    }

    /** 程序化插入的内容（含图片）按规范重排引用页，用户手动输入保持原样。 */
    function markdownForStorage(value: string): string {
        return compactImageSpacing(value).replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
    }
    function pendingUploadCount(field: EditorField): number {
        return listPendingActionImages(draftOf(field)).length;
    }

    function actionDraftKey(field: EditorField): string {
        return `${selected?.id ?? ""}:${field}`;
    }

    function queueUpload(field: EditorField, record: ActionImageUpload) {
        actionImageUploads = { ...actionImageUploads, [field]: [...actionImageUploads[field], record] };
    }

    function patchUpload(field: EditorField, uploadId: string, changes: Partial<ActionImageUpload>) {
        actionImageUploads = {
            ...actionImageUploads,
            [field]: actionImageUploads[field].map((entry) => (entry.uploadId === uploadId ? { ...entry, ...changes } : entry)),
        };
    }

    function setImageSize(field: EditorField, src: string, bytes: number | null) {
        actionImageSizes = { ...actionImageSizes, [field]: { ...actionImageSizes[field], [src]: bytes } };
    }

    function imageLabel(src: string): string {
        return fileNameFromSource(src) || src;
    }

    function handleActionPaste(event: ClipboardEvent, field: EditorField) {
        const images = extractClipboardImages(event.clipboardData);
        if (images.length === 0) return;
        event.preventDefault();
        void uploadActionImages(field, images);
    }

    function handleActionDragOver(event: DragEvent, field: EditorField) {
        const types = event.dataTransfer ? Array.from(event.dataTransfer.types) : [];
        if (!types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer!.dropEffect = "copy";
        actionDragging = field;
    }

    function handleActionDragLeave(event: DragEvent, field: EditorField) {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(next)) return;
        if (actionDragging === field) actionDragging = null;
    }

    function handleActionDrop(event: DragEvent, field: EditorField) {
        const images = extractDroppedImages(event.dataTransfer);
        actionDragging = null;
        if (images.length === 0) return;
        event.preventDefault();
        void uploadActionImages(field, images);
    }

    function handleActionImageClick(event: MouseEvent, field: EditorField) {
        const target = event.target;
        if (!(target instanceof HTMLImageElement)) return;
        const src = target.currentSrc || target.src;
        if (!src) return;
        event.stopPropagation();
        openActionImagePreview(field, src);
    }

    /**
     * 图片右键：只有图片本身算命中区（体积角标与「×」按钮不弹菜单）。
     * 监听挂在容器上而不是 window 上：既覆盖 Lute 渲染出来的正文图，
     * 又不会和思源那个全局 contextmenu 监听抢时序。
     */
    function handleImageContextMenu(event: MouseEvent) {
        const target = event.target;
        if (!(target instanceof HTMLImageElement)) return;
        const src = target.currentSrc || target.src;
        if (!src) return;
        event.preventDefault();
        event.stopPropagation();
        openImageMenu(event, {
            src,
            width: target.naturalWidth || 0,
            height: target.naturalHeight || 0,
        });
    }

    function openActionImagePreview(field: EditorField, src: string) {
        actionPreviewDialog?.destroy();
        const name = imageLabel(src);
        const known = actionImageSizes[field][src];
        const size = typeof known === "number" ? ` · ${formatImageBytes(known)}` : "";
        const dialog = new Dialog({
            title: name,
            width: "880px",
            content: `<div class="xz-action-image-preview"><img src="${src}" alt="${name}"></div><p class="xz-action-image-preview__note">按原分辨率显示${size}</p>`,
        });
        actionPreviewDialog = dialog;
        // 弹窗内容是思源 Dialog 生成的 HTML，挂不上 Svelte 事件：在同一处理函数上补一层监听。
        dialog.element.querySelector<HTMLElement>(".xz-action-image-preview")?.addEventListener("contextmenu", handleImageContextMenu);
        window.setTimeout(() => {
            dialog.element.querySelector<HTMLButtonElement>(".b3-dialog__close")?.focus();
        }, 0);
    }

    /** 草稿是否仍属于发起操作时的那条条目；用于丢弃条目切换后的迟到结果。 */
    function isStaleActionDraft(field: EditorField, draftKey: string, sourceItemId: string): boolean {
        return draftKey !== `${sourceItemId}:${field}` || actionDraftKey(field) !== draftKey;
    }

    async function uploadActionImages(field: EditorField, files: File[]) {
        const draftKey = actionDraftKey(field);
        const sourceItemId = selected?.id ?? "";
        const staleUpload = () => isStaleActionDraft(field, draftKey, sourceItemId);
        for (const file of files) {
            let hash = "";
            try {
                hash = await hashImageFile(file);
            } catch (caught) {
                actionErrors = { ...actionErrors, [editorFieldKey(field)]: caught instanceof Error ? caught.message : String(caught) };
                return;
            }
            const uploadId = placeholderIdFor(hash);
            if (findPlaceholderSyntax(draftOf(field), uploadId)) {
                showMessage(`这张图片已经插入过：${imageFileNameFor(hash, file)}`, 4000);
                continue;
            }

            const cursor = actionCursor[field];
            const inserted = insertImageSyntax(draftOf(field), cursor, cursor, uploadPlaceholderSyntax(uploadId, file.name));
            writeActionDraft(field, inserted.value, inserted.cursor);
            const upload: ActionImageUpload = {
                uploadId,
                name: file.name || imageFileNameFor(hash, file),
                bytes: file.size || null,
                status: "uploading",
                src: "",
                error: "",
                field,
                draftKey,
            };
            queueUpload(field, upload);

            try {
                const result = await uploadActionImage(file, hash);
                if (staleUpload()) continue;
                const done = { status: "done" as const, src: result.path, bytes: result.bytes ?? upload.bytes, name: result.name || upload.name };
                patchUpload(field, uploadId, done);
                setImageSize(field, result.path, result.bytes ?? upload.bytes);
                const placeholder = findPlaceholderSyntax(draftOf(field), uploadId);
                if (placeholder) {
                    const replacement = markdownImageSyntax(result.path);
                    const cursor = shiftCursorForReplacement(draftOf(field).indexOf(placeholder), placeholder.length, replacement.length, actionCursor[field]);
                    writeActionDraft(field, draftOf(field).replace(placeholder, replacement), cursor);
                }
            } catch (caught) {
                if (staleUpload()) continue;
                const message = caught instanceof Error ? caught.message : String(caught);
                patchUpload(field, uploadId, { status: "failed", error: message });
                actionErrors = { ...actionErrors, [field]: message };
                // 失败后不能把占位符留在内容里：整行移除，用户可重新粘贴。
                const placeholder = findPlaceholderSyntax(draftOf(field), uploadId);
                if (placeholder) writeActionDraft(field, removeImageLine(draftOf(field), placeholder), actionCursor[field]);
            }
        }
        await flushActionImages(field, draftKey, sourceItemId);
    }

    /** 上传完成后把占位符换回真实路径；失败或中止的占位符不会写进条目。 */
    function reconcileActionUploads(field: EditorField, saved: string) {
        const uploads = actionImageUploads[field];
        if (uploads.length === 0) return saved;
        let next = saved;
        let dropped = 0;
        for (const upload of uploads) {
            if (upload.status === "done" && upload.src) {
                next = resolveUploadPlaceholder(next, upload.uploadId, { path: upload.src, bytes: upload.bytes ?? 0, reused: false });
            } else {
                const before = next;
                next = resolveUploadPlaceholder(next, upload.uploadId, null);
                if (before !== next) dropped += 1;
            }
        }
        if (dropped > 0) showMessage(`${dropped} 张图片尚未上传完成，已从内容中移除占位符`, 5000);
        return markdownForStorage(next);
    }

    /** 上传结束后按需补一次保存；占位符未就绪或草稿已失效时不写入。 */
    async function flushActionImages(field: EditorField, draftKey: string, sourceItemId: string) {
        if (!selected || savingAction) return;
        if (isStaleActionDraft(field, draftKey, sourceItemId)) return;
        if (pendingUploadCount(field) > 0) return;
        if (draftOf(field) === savedActionValues[field]) return;
        await saveAction(field);
    }

    function removeDraftImage(field: EditorField, syntax: string) {
        applyDetailEdit(field, { value: removeImageLine(draftOf(field), syntax), cursor: actionCursor[field] });
    }

    /** 缩略图行始终由当前内容推导：从内容里删掉的图片不会从上传统计里"复活"。 */
    function buildActionImageRows(
        field: EditorField,
        draft: string,
        uploads: ActionImageUpload[],
        sizes: Record<string, number | null>,
    ): ActionImageRow[] {
        const rows: ActionImageRow[] = [];
        for (const upload of uploads) {
            if (upload.status === "done") continue;
            const syntax = findPlaceholderSyntax(draft, upload.uploadId);
            if (!syntax) continue;
            rows.push({
                key: upload.uploadId,
                status: upload.status,
                src: upload.src,
                syntax,
                label: upload.name,
                bytes: upload.bytes,
                error: upload.error,
            });
        }
        for (const image of listActionImages(draft)) {
            if (!image.src) continue;
            rows.push({
                key: image.src,
                status: "done",
                src: image.src,
                syntax: image.syntax,
                label: image.name || image.src,
                bytes: sizes[image.src] ?? null,
                error: "",
            });
        }
        return rows;
    }

    function buildActionImageTotal(draft: string, uploads: ActionImageUpload[]): number {
        return countActionImages(draft) + uploads.filter((upload) => upload.status !== "failed").length;
    }

    function retryActionUpload(field: EditorField, uploadId: string) {
        const upload = actionImageUploads[field].find((entry) => entry.uploadId === uploadId);
        if (!upload) return;
        removeDraftImage(field, findPlaceholderSyntax(draftOf(field), uploadId) ?? "");
        actionImageUploads = { ...actionImageUploads, [field]: actionImageUploads[field].filter((entry) => entry.uploadId !== uploadId) };
        showMessage("请重新粘贴这张图片", 4000);
    }
</script>

<svelte:window on:contextmenu={handleContextMenu} on:keydown={handleWindowKeydown} />

<div class="xz-app">
    {#if !embedded}<header class="xz-header">
        <div><div class="xz-eyebrow">个人行动与生活系统</div><h1>行舟</h1></div>
        <div class="xz-header-actions">
            {#if quickCaptureNotice}<span class="xz-quick-capture-notice" aria-live="polite">{quickCaptureNotice}</span>{/if}
            <span class="xz-data-source">插件内部数据</span>
            <button class="b3-button b3-button--outline" type="button" on:click={() => void refresh()} disabled={loading}>
                <svg><use href="#iconRefresh"></use></svg>{loading ? "读取中" : "刷新"}
            </button>
            <button class="b3-button b3-button--outline" type="button" on:click={() => openLog()}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 3.5h8.5L19 8v11.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                    <path d="M14 3.5V8h4.5M8 12h8M8 15.5h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>日志
            </button>
        </div>
    </header>{/if}

    <div class="xz-project-toolbar">
        <div class="xz-project-toolbar__scroll">
        <nav class="xz-main-nav" aria-label="主页面">
            {#each mainPages as entry}
                <button class:active={page === entry.id} type="button" on:click={() => { if (page !== entry.id) log.verbose("ui", "ui.page.changed", { from: page, to: entry.id }); page = entry.id; }}>
                    {entry.label}
                </button>
            {/each}
        </nav>
        {#if page === "all" && data}
            <div class="xz-secondary-bar">
                <div class="xz-filter-controls">
                    <div class="xz-segmented">
                        {#each itemFilters as entry}
                            <button
                                class:active={filter === entry.id}
                                class:xz-segmented__today={entry.id === "today"}
                                class:xz-segmented__primary={entry.id === "today"}
                                type="button"
                                title={entry.id === "today" ? "只看今天安排了未完成执行切片的事务" : ""}
                                on:click={() => setFilter(entry.id)}
                            >
                                {entry.label}{#if entry.id === "today" && todayFocusCount > 0}<span class="xz-segmented__count" title={`${todayFocusCount} 个事务今天有未完成的执行切片`}>{todayFocusCount}</span>{/if}
                            </button>
                        {/each}
                    </div>
                    {#if filter === "all"}
                        <button class:active={includeClosed} class="xz-include-closed-toggle" type="button" aria-pressed={includeClosed} title="控制“全部”中是否包含已经结束的工作项" on:click={toggleIncludeClosed}>
                            {includeClosed ? "✓ " : ""}包含已结束
                        </button>
                    {/if}
                </div>
                <div class="xz-secondary-actions">
                    {#if filter === "active"}
                        <button class="xz-link-button" type="button" on:click={expandActivePaths}>展开活跃路径</button>
                    {:else}
                        <button class="xz-link-button" type="button" on:click={expandAllVisible}>全部展开</button>
                    {/if}
                    <button class="xz-link-button" type="button" on:click={collapseAll}>全部收起</button>
                </div>
            </div>
        {/if}
        </div>
        {#if page === "all" && data}
            <div class="xz-project-toolbar__aside">
                <button
                    class="xz-cleanup-entry"
                    class:xz-cleanup-entry--idle={pendingImageCleanups.length === 0}
                    type="button"
                    title={pendingImageCleanups.length === 0 ? "当前没有可清理的图片" : `${pendingImageCleanups.length} 条已结束条目有图片待清理`}
                    on:click={openCleanupPage}
                >
                    <span class="xz-cleanup-entry__icon" aria-hidden="true">🧹</span>
                    <span class="xz-cleanup-entry__label">清理图片</span>
                    <span class="xz-cleanup-entry__count">{pendingImageCleanups.length}</span>
                </button>
            </div>
        {/if}
    </div>

    {#if page === "graph"}
        {#if loading && !data}
            <main class="xz-state"><span class="xz-spinner"></span><p>正在生成未完成工作关系图……</p></main>
        {:else if error && !data}
            <main class="xz-state xz-error"><h2>暂时无法生成关系图</h2><p>{error}</p><button class="b3-button" type="button" on:click={() => void refresh()}>重试</button></main>
        {:else if data}
            <RelationshipGraph items={data.items} bind:selectedId openItem={(item) => revealInboxItem(item)} />
        {/if}
    {:else if page === "week"}
        <main class="xz-week-page">
            <header class="xz-week-header">
                <div>
                    <span class="xz-section-kicker">按实际日期安排</span>
                    <h2>本周</h2>
                    <p>{formatWeekRange()} · 已安排 {scheduledWeekCount} 项</p>
                </div>
                <div class="xz-week-navigation">
                    <button class="b3-button b3-button--outline" type="button" on:click={() => shiftWeek(-1)}>上一周</button>
                    <button class="b3-button b3-button--outline" type="button" on:click={() => weekStart = startOfWeek(Date.now())}>回到本周</button>
                    <button class="b3-button b3-button--outline" type="button" on:click={() => shiftWeek(1)}>下一周</button>
                </div>
            </header>

            {#if loading && !data}
                <div class="xz-state"><span class="xz-spinner"></span><p>正在读取本周安排……</p></div>
            {:else if error && !data}
                <div class="xz-state xz-error"><h2>暂时无法读取本周安排</h2><p>{error}</p><button class="b3-button" type="button" on:click={() => void refresh()}>重试</button></div>
            {:else if data}
                {#if weekError}<p class="xz-week-error" role="alert">{weekError}</p>{/if}
                <div class="xz-week-layout">
                    <section class="xz-week-board" aria-label="一周安排">
                        {#each weekDays as day (day.key)}
                            {@const dayLoad = weekLoadsByDate.get(day.key)}
                            {@const dayRemaining = dayLoadValue(dayLoad?.remaining)}
                            {@const dayTotal = dayLoadValue(dayLoad?.load)}
                            {@const dayCleared = day.key >= localDateKey() && dayTotal.count > 0 && dayRemaining.count === 0}
                            <article class:xz-week-day--today={day.isToday} class:is-clear={dayCleared} class="xz-week-day" data-week-day={day.key}>
                                <header>
                                    <div><strong>{day.label}</strong><span>{day.dateLabel}</span></div>
                                    {#if day.isToday}<em>今天</em>{/if}
                                    {#if dayCleared || dayRemaining.count > 0}
                                        <em class:is-clear={dayCleared} class="xz-week-day-remaining">
                                            <span class="xz-week-chip-prefix">待做</span><span class="xz-week-chip-value">{dayRemaining.unestimatedOnly ? "未估时" : `${dayRemaining.atLeast ? "≥" : ""}${dayRemaining.minutes}`}</span>{#if !dayRemaining.unestimatedOnly}<span class="xz-week-chip-unit">分</span>{/if}
                                        </em>
                                    {/if}
                                </header>
                                <div class="xz-week-day-items">
                                    {#if (weekItemsByDate.get(day.key) ?? []).length === 0}
                                        <p class="xz-week-day-empty">暂无安排</p>
                                    {:else}
                                        {#each weekItemsByDate.get(day.key) ?? [] as occurrence (`${occurrence.item.id}-${occurrence.slice?.id ?? occurrence.phase}`)}
                                            {@const item = occurrence.item}
                                            {@const slice = occurrence.slice}
                                            {@const compactOccurrence = isWeekOccurrenceCompact(occurrence.phase)}
                                            {@const dateCompleted = slice ? slice.status === "completed" : item.completedDates?.includes(day.key) ?? false}
                                            <article class:xz-week-item--closed={isClosed(item)} class:xz-week-item--date-completed={dateCompleted} class:xz-week-item--missed={slice?.status === "missed"} class:xz-week-item--abandoned={slice?.status === "abandoned"} class:xz-week-item--continuation={compactOccurrence} class:xz-week-item--early-achievement={occurrence.phase === "early-completion"} class="xz-week-item" data-work-item-id={item.id} data-week-date={day.key} data-week-phase={occurrence.phase}>
                                                {#if occurrence.phase === "early-completion" && slice}
                                                    <span class="xz-week-early-achievement-label">✓ {day.isToday ? "今日提前完成" : "提前完成"}</span>
                                                    <button class="xz-week-item-title" type="button" on:click={() => revealInboxItem(item)}>{item.title}</button>
                                                    <small class="xz-week-early-achievement-plan">原计划 {shortDateLabel(slice.scheduledDate)} · 不计入当日安排</small>
                                                {:else}
                                                <button class="xz-week-item-title" type="button" on:click={() => revealInboxItem(item)}>{item.title}</button>
                                                <div class="xz-week-item-meta">
                                                    <span class="xz-week-item-phase">{weekOccurrenceLabel(occurrence.phase)}</span>
                                                    {#if slice}<span class={`xz-week-slice-status ${slice.status}`}>{isEarlyCompletedSlice(slice) ? "✓ 已提前完成" : sliceStatusLabel(slice.status)}</span>{:else if dateCompleted}<span class="xz-week-item-date-done">✓ 当日已完成</span>{/if}
                                                    {#if slice && isEarlyCompletedSlice(slice)}<span>完成于{sliceCompletionDateLabel(slice)}</span>{/if}
                                                    <span>{displayStatus(item.status) || "未设置"}</span>
                                                    {#if slice}<span>{sliceCompletionPercent(item)}%</span>{/if}
                                                    {#if !compactOccurrence && item.durationMinutes !== null}<span>{item.durationMinutes} 分钟／片</span>{/if}
                                                    {#if !compactOccurrence && item.energy}<span>{item.energy}精力</span>{/if}
                                                </div>
                                                <div class="xz-week-item-actions">
                                                    {#if slice?.status === "scheduled"}
                                                        <select aria-label={`移动“${item.title}”的执行切片`} disabled={weekSavingIds.has(item.id)} on:change={(event) => handleWeekSliceAssignment(event, item, slice)}>
                                                            <option value="">移动到…</option>
                                                            {#each weekDays as targetDay}<option value={targetDay.key} disabled={targetDay.key < localDateKey() || Boolean(item.deadline && targetDay.key > formatInputDate(item.deadline))}>{targetDay.label} · {targetDay.dateLabel}</option>{/each}
                                                            <option value="__clear">取消安排</option>
                                                        </select>
                                                        {#if day.key < localDateKey()}
                                                            <button type="button" disabled={weekSavingIds.has(item.id)} on:click={() => void updateWeekSlice(item, slice, "complete")}>补记完成</button>
                                                            <button class="xz-week-missed-button" type="button" disabled={weekSavingIds.has(item.id)} on:click={() => void updateWeekSlice(item, slice, "miss")}>记为未完成</button>
                                                        {:else if day.key === localDateKey()}
                                                            <button type="button" disabled={weekSavingIds.has(item.id)} on:click={() => void updateWeekSlice(item, slice, "complete")}>完成</button>
                                                            <button class="xz-week-abandon-button" type="button" disabled={weekSavingIds.has(item.id)} on:click={() => void updateWeekSlice(item, slice, "abandon")}>放弃</button>
                                                        {:else}
                                                            <button type="button" title="保留原计划日期，并将切片标记为已完成" disabled={weekSavingIds.has(item.id)} on:click={() => void updateWeekSlice(item, slice, "complete")}>提前完成</button>
                                                        {/if}
                                                    {:else if slice?.status === "completed"}
                                                        <button class="xz-week-complete-button--done" type="button" disabled={weekSavingIds.has(item.id)} on:click={() => void updateWeekSlice(item, slice, "undo")}>撤销完成</button>
                                                    {:else if slice?.status === "missed"}
                                                        <button type="button" title="补记后仍保留原计划日期" disabled={weekSavingIds.has(item.id)} on:click={() => void updateWeekSlice(item, slice, "complete")}>补记完成</button>
                                                    {:else if !slice}
                                                        {#if !compactOccurrence}<select aria-label={occurrence.phase === "start" ? `修改“${item.title}”的开始日` : `移动“${item.title}”`} disabled={weekSavingIds.has(item.id)} on:change={(event) => handleWeekAssignment(event, item)}>
                                                                <option value="">{occurrence.phase === "start" ? "修改开始日…" : "移动到…"}</option>
                                                                {#each weekDays as targetDay}<option value={targetDay.key} disabled={Boolean(item.deadline && targetDay.key > formatInputDate(item.deadline))}>{targetDay.label} · {targetDay.dateLabel}</option>{/each}
                                                                <option value="__clear">{occurrence.phase === "start" ? "清除开始日" : "取消安排"}</option>
                                                            </select>{/if}
                                                        <button class:xz-week-complete-button--done={dateCompleted} type="button" aria-label={`${dateCompleted ? "撤销" : "完成"}“${item.title}”在 ${day.key} 的每日记录`} disabled={weekSavingIds.has(item.id)} on:click={() => void toggleLegacyWeekDateCompletion(item, day.key)}>{dateCompleted ? "撤销" : "完成"}</button>
                                                    {/if}
                                                </div>
                                                {/if}
                                            </article>
                                        {/each}
                                    {/if}
                                </div>
                            </article>
                        {/each}
                    </section>

                    <aside class="xz-week-backlog">
                        <header><div><span class="xz-section-kicker">可执行事项</span><h3>待安排</h3></div><span>{unscheduledWeekItems.length + activeWindowItems.length} 项</span></header>
                        {#if unscheduledWeekItems.length === 0 && activeWindowItems.length === 0}
                            <div class="xz-week-backlog-empty"><p>当前没有需要安排日期的可执行条目。</p></div>
                        {:else}
                            <div class="xz-week-backlog-list">
                                {#if activeWindowItems.length > 0}
                                    <section class="xz-week-backlog-group">
                                        <h4><span>进行窗口</span><em>今天可推进</em></h4>
                                        {#each activeWindowItems as item (item.id)}
                                            <article class="xz-week-backlog-item xz-week-backlog-item--window" data-work-item-id={item.id}>
                                                <button type="button" on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{item.type} · 截止 {item.deadline ? formatInputDate(item.deadline) : "—"}</span></button>
                                            </article>
                                        {/each}
                                    </section>
                                {/if}
                                {#if unscheduledWeekItems.length > 0}
                                    <section class="xz-week-backlog-group">
                                        <h4><span>尚未选择日期</span><em>{unscheduledWeekItems.length} 项</em></h4>
                                        {#each unscheduledWeekItems as item (item.id)}
                                            <article class="xz-week-backlog-item" data-work-item-id={item.id}>
                                                <button type="button" on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{item.type === "事务" ? `${sliceCompletionPercent(item)}% · 待安排 ${availableSliceCount(item)} 片` : `${item.type || "未分类"} · ${displayStatus(item.status) || "未设置"}`}</span></button>
                                                <select aria-label={`安排“${item.title}”`} disabled={weekSavingIds.has(item.id)} on:change={(event) => item.type === "事务" ? handleNewWeekSliceAssignment(event, item) : handleWeekAssignment(event, item)}>
                                                    <option value="">{item.type === "事务" ? "安排一个切片到…" : "安排到…"}</option>{#each weekDays as targetDay}<option value={targetDay.key} disabled={targetDay.key < localDateKey() || Boolean(item.deadline && targetDay.key > formatInputDate(item.deadline))}>{targetDay.label} · {targetDay.dateLabel}</option>{/each}
                                                </select>
                                            </article>
                                        {/each}
                                    </section>
                                {/if}
                            </div>
                        {/if}
                    </aside>
                </div>
            {/if}
        </main>
    {:else if page === "review"}
        <main class="xz-review-page">
            <header class="xz-review-header">
                <div><span class="xz-section-kicker">建议 10–15 分钟</span><h2>每周整理</h2><p>按顺序处理真正需要决定的内容；没有问题的部分会自动标记为已就绪。</p></div>
                <button class="b3-button b3-button--outline" type="button" on:click={() => void refresh()} disabled={loading}>重新检查</button>
            </header>
            {#if loading && !data}
                <div class="xz-state"><span class="xz-spinner"></span><p>正在检查个人项目与事务……</p></div>
            {:else if error && !data}
                <div class="xz-state xz-error"><h2>暂时无法进行整理</h2><p>{error}</p><button class="b3-button" type="button" on:click={() => void refresh()}>重试</button></div>
            {:else if data}
                <section class="xz-review-summary" aria-label="整理概况">
                    <div><strong>{reviewFocusedDomains.length}</strong><span>重点投入的长期领域</span></div>
                    <div class:xz-review-metric--warning={reviewOngoingProjects.length > 3}><strong>{reviewOngoingProjects.length}<small> / 3</small></strong><span>进行中的顶层项目</span></div>
                    <div><strong>{reviewDateItems.length}</strong><span>日期待确认</span></div>
                    <div><strong>{reviewMissingActionItems.length}</strong><span>缺少行动细则</span></div>
                    <div class="xz-review-metric--positive"><strong>{reviewCompletedThisWeek.length}</strong><span>本周已结束</span></div>
                </section>

                <div class="xz-review-steps">
                    <section class:xz-review-step--ready={reviewFocusedDomains.length > 0} class="xz-review-step">
                        <header><span class="xz-review-step-number">1</span><div><h3>确认重视什么</h3><p>列出投入状态为“重点投入”的长期领域，明确近期需要优先关注的生活与责任方向。</p></div><em>{reviewFocusedDomains.length === 0 ? "暂无重点领域" : `${reviewFocusedDomains.length} 个重点领域`}</em></header>
                        {#if reviewFocusedDomains.length > 0}<div class="xz-review-item-list">{#each reviewFocusedDomains as item (item.id)}<button type="button" data-work-item-id={item.id} on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{item.status}</span></button>{/each}</div>{/if}
                    </section>

                    <section class:xz-review-step--warning={reviewOngoingProjects.length > 3} class:xz-review-step--ready={reviewOngoingProjects.length > 0 && reviewOngoingProjects.length <= 3} class="xz-review-step">
                        <header><span class="xz-review-step-number">2</span><div><h3>确认正在做什么</h3><p>列出项目状态为“进行中”的顶层项目；建议同时推进不超过 2–3 个。</p></div><em>{reviewOngoingProjects.length > 3 ? "并行项目过多" : reviewOngoingProjects.length === 0 ? "暂无进行中项目" : "数量合适"}</em></header>
                        {#if reviewOngoingProjects.length > 0}<div class="xz-review-item-list">{#each reviewOngoingProjects as item (item.id)}<button type="button" data-work-item-id={item.id} on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{displayStatus(item.status)}</span></button>{/each}</div>{/if}
                    </section>

                    <section class:xz-review-step--ready={reviewDateItems.length === 0} class="xz-review-step">
                        <header><span class="xz-review-step-number">3</span><div><h3>确认期限</h3><p>补充尚未确认的截止日期，并确认逾期事项是否仍然有效。</p></div><em>{reviewDateItems.length === 0 ? "已就绪" : `${reviewDateItems.length} 项`}</em></header>
                        {#if reviewDateItems.length > 0}<div class="xz-review-item-list">{#each reviewDateItems as item (item.id)}<button type="button" data-work-item-id={item.id} on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span class:xz-review-item-overdue={isOverdue(item)}>{reviewDateReason(item)}</span></button>{/each}</div>{/if}
                    </section>

                    <section class:xz-review-step--ready={reviewMissingActionItems.length === 0} class="xz-review-step">
                        <header><span class="xz-review-step-number">4</span><div><h3>让执行项可以直接开始</h3><p>日期有效后，再检查事务与想法是否写明本次行动细则。</p></div><em>{reviewMissingActionItems.length === 0 ? "已就绪" : `${reviewMissingActionItems.length} 项`}</em></header>
                        {#if reviewMissingActionItems.length > 0}<div class="xz-review-item-list">{#each reviewMissingActionItems as item (item.id)}<button type="button" data-work-item-id={item.id} on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{item.type} · {displayStatus(item.status)}</span></button>{/each}</div>{/if}
                    </section>

                    <section class="xz-review-step xz-review-step--reflection">
                        <header><span class="xz-review-step-number">5</span><div><h3>看一眼本周留下了什么</h3><p>这里只用于获得反馈，不评价推进速度；缓慢推进也是正常推进。</p></div><em>{reviewCompletedThisWeek.length} 项</em></header>
                        {#if reviewCompletedThisWeek.length > 0}<div class="xz-review-item-list">{#each reviewCompletedThisWeek as item (item.id)}<button type="button" data-work-item-id={item.id} on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{displayStatus(item.status)} · {formatDate(item.updatedAt)}</span></button>{/each}</div>{:else}<p class="xz-review-empty-note">本周还没有已结束条目，这不代表没有发生有效推进。</p>{/if}
                    </section>
                </div>
            {/if}
        </main>
    {:else if page === "cleanup"}
        <main class="xz-cleanup-page">
            {#if cleanupResult}
                <section class="xz-cleanup-page__done">
                    <span class="xz-cleanup-page__done-icon" aria-hidden="true">✓</span>
                    <h3>清理完成</h3>
                    <p>已删除 <b>{cleanupResult.deleted}</b> 张图片{cleanupResult.kept > 0 ? `，保留 ${cleanupResult.kept} 张（仍被引用）` : ""}。需要找回时可在思源「历史」里恢复被清理的资源文件。</p>
                    {#if cleanupResult.failures.length > 0}
                        <ul class="xz-cleanup-page__failures">
                            {#each cleanupResult.failures as failure}<li>{failure}</li>{/each}
                        </ul>
                    {/if}
                    <div class="xz-cleanup-page__actions">
                        <button class="b3-button" type="button" on:click={leaveCleanupConfirm}>返回清理列表</button>
                    </div>
                </section>
            {:else if cleanupConfirming}
                <header class="xz-cleanup-page__head">
                    <div>
                        <span class="xz-section-kicker">第 2 步 · 确认范围</span>
                        <h2>勾选要删除的图片</h2>
                        <p>行舟会先摘掉引用，再逐张确认思源认为它没有被引用才删除。不想清的条目或图片，取消勾选即可，图片会留在条目里。</p>
                    </div>
                    <div class="xz-cleanup-page__actions">
                        <button class="b3-button b3-button--outline" type="button" disabled={cleanupRunning} on:click={leaveCleanupConfirm}>返回</button>
                        <button class="b3-button xz-danger-button" type="button" disabled={cleanupRunning || cleanupConfirmRemovable.length === 0} on:click={() => void runImageCleanup()}>
                            {cleanupRunning ? "正在清理…" : `确认删除 ${cleanupConfirmRemovable.length} 张`}
                        </button>
                    </div>
                </header>

                {#if cleanupError}<p class="xz-cleanup-page__error" role="alert">{cleanupError}</p>{/if}

                <div class="xz-cleanup-confirm-list">
                    {#each cleanupConfirmGroups as group (group.row.item.id)}
                        <section class="xz-cleanup-confirm-item">
                            <header>
                                <label class="xz-cleanup-confirm-item__check">
                                    <input type="checkbox" checked={!cleanupExcludedItems.has(group.row.item.id)}
                                        on:change={(event) => {
                                            const next = new Set(cleanupExcludedItems);
                                            if (event.currentTarget.checked) next.delete(group.row.item.id);
                                            else next.add(group.row.item.id);
                                            cleanupExcludedItems = next;
                                        }} />
                                    <strong>{group.row.item.title}</strong>
                                </label>
                                <span class="xz-cleanup-confirm-item__meta">
                                    {group.images.filter((image) => image.removable).length} / {group.images.length} 张可删除
                                </span>
                            </header>
                            <div class="xz-cleanup-confirm-item__images">
                                {#each group.images as image (image.src)}
                                    <div class="xz-cleanup-pick" class:xz-cleanup-pick--kept={!image.removable}>
                                        <label class="xz-cleanup-pick__check">
                                            <input type="checkbox" checked={cleanupSelectedImages.has(image.src)} disabled={!image.removable}
                                                on:change={(event) => toggleCleanupImage(image.src, event.currentTarget.checked)} />
                                            <span>{image.removable ? "删除" : "不可删除"}</span>
                                        </label>
                                        <button class="xz-cleanup-pick__image" type="button" disabled={!image.removable}
                                            title={image.removable ? "点击切换是否删除这张图片" : image.blockedReason || "仍被引用，不可删除"}
                                            on:click={() => toggleCleanupPick(image.src, image.removable)}>
                                            <img src={image.src} alt={image.name} loading="lazy" />
                                        </button>
                                        <strong title={image.name}>{image.name}</strong>
                                        {#if image.blockedReason}<em>仍被「{image.blockedReason}」引用，会保留</em>{/if}
                                    </div>
                                {/each}
                            </div>
                        </section>
                    {/each}
                </div>

                <p class="xz-cleanup-page__note">
                    本次将删除 <b>{cleanupConfirmRemovable.length}</b> 张{cleanupConfirmBytes > 0 ? `，约 ${formatImageBytes(cleanupConfirmBytes)}` : ""}；被保留的图片只摘除行舟的引用，文件留在资源库。
                </p>
            {:else}
                <header class="xz-cleanup-page__head">
                    <div>
                        <span class="xz-section-kicker">图片清理</span>
                        <h2>已结束条目的图片</h2>
                        <p>条目结束（已完成／已放弃／已取消）时登记下来的图片会集中在这里。清理只删除思源认为「没有任何引用」的文件；仍被其它未结束条目或笔记引用的图片会保留，并在确认步骤里标明原因。</p>
                    </div>
                    <div class="xz-cleanup-page__actions">
                        <button class="b3-button b3-button--outline" type="button" on:click={() => (page = "all")}>返回项目与事务</button>
                        <button class="b3-button" type="button" disabled={pendingImageCleanups.length === 0} on:click={openCleanupConfirmForAll}>一次清理全部…</button>
                    </div>
                </header>

                {#if pendingImageCleanups.length === 0}
                    <section class="xz-cleanup-page__empty">
                        <span class="xz-cleanup-page__empty-icon" aria-hidden="true">🧹</span>
                        <h3>当前没有需要清理的图片</h3>
                        <p>只有「条目结束的当下，正文里还带着图片」才会出现在这里。已经结束但只有文字的条目不会有任何待清理内容；如果某条引用的图片仍被别的未结束条目使用，它也会被保留。</p>
                    </section>
                {:else}
                    <section class="xz-cleanup-page__summary" aria-label="清理概况">
                        <div><strong>{pendingImageCleanups.length}</strong><span>条已结束条目</span></div>
                        <div><strong>{pendingImageCleanupTotal}</strong><span>张登记图片</span></div>
                        <div><strong>{IMAGE_CLEANUP_GRACE_DAYS}</strong><span>天宽限期</span></div>
                    </section>

                    <section class="xz-storage" aria-label="图库体检">
                        <header class="xz-storage__head">
                            <div>
                                <h3>图库体检</h3>
                                <p>只统计行舟引用的图片（同一张图多处引用只算一份）{assetStatsLoading ? " · 正在读取体积…" : ""}</p>
                            </div>
                            <button class="b3-button b3-button--outline" type="button" disabled={assetStatsLoading} on:click={() => void loadAssetStats(true)}>重新统计</button>
                        </header>
                        {#if assetStatsError}<p class="xz-storage__error" role="alert">{assetStatsError}</p>{/if}
                        <div class="xz-storage__cards">
                            <div><span>行舟图片</span><strong>{storageStats.imageCount}</strong><small>张 · 分布在 {storageStats.topItems.length} 条未结束条目</small></div>
                            <div><span>未结束条目占用</span><strong>{formatImageBytes(Math.max(0, storageStats.bytes - pendingCleanupBytes))}</strong><small>当前正在使用{storageStats.missingSize > 0 ? `（${storageStats.missingSize} 张体积未知）` : ""}</small></div>
                            <div class:xz-storage__card--warn={pendingCleanupBytes > 0}><span>待清理占用</span><strong>{formatImageBytes(pendingCleanupBytes)}</strong><small>{pendingImageCleanups.length} 条已结束条目 · {pendingImageCleanupTotal} 张</small></div>
                            <div><span>资源库总量</span><strong>{assetLibraryBytes === null ? "统计中…" : formatImageBytes(assetLibraryBytes)}</strong><small>{assetLibraryCount} 个文件 · 含笔记里的其它资源</small></div>
                        </div>
                        {#if storageSegments}
                            <div class="xz-storage__bar" aria-hidden="true">
                                <i class="active" style={`width:${storageSegments.active}%`}></i>
                                <i class="pending" style={`width:${storageSegments.pending}%`}></i>
                                <i class="other" style={`width:${storageSegments.other}%`}></i>
                            </div>
                            <div class="xz-storage__legend">
                                <span><i class="active"></i>行舟 · 未结束 {formatImageBytes(activeBytesForBar)}</span>
                                <span><i class="pending"></i>行舟 · 待清理 {formatImageBytes(pendingCleanupBytes)}</span>
                                <span><i class="other"></i>其它资源 {formatImageBytes(storageSegments.otherBytes)}</span>
                            </div>
                        {/if}
                        {#if storageStats.topItems.length > 0}
                            <details class="xz-storage__details">
                                <summary>按条目查看占用（{storageStats.topItems.length} 条）</summary>
                                <table class="xz-storage__table">
                                    <thead><tr><th>条目</th><th>状态</th><th>图片</th><th>占用</th></tr></thead>
                                    <tbody>
                                        {#each storageStats.topItems.slice(0, 20) as row (row.item.id)}
                                            <tr>
                                                <td>{row.item.title}</td>
                                                <td>{row.item.status || "未设置"}</td>
                                                <td class="xz-storage__num">{row.count} 张</td>
                                                <td class="xz-storage__num">{row.bytes > 0 ? formatImageBytes(row.bytes) : "未知"}</td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                                {#if storageStats.topItems.length > 20}<p class="xz-storage__more">仅显示占用最大的 20 条。</p>{/if}
                            </details>
                        {:else}
                            <p class="xz-storage__empty">目前没有任何未结束条目引用图片。</p>
                        {/if}
                    </section>

                    <div class="xz-cleanup-page__list">
                        {#each pendingImageCleanups as entry (entry.item.id)}
                            <article class="xz-cleanup-page__item" class:xz-cleanup-page__item--due={entry.due}>
                                <header>
                                    <div class="xz-cleanup-page__title">
                                        <strong>{entry.item.title}</strong>
                                        <small>{entry.images.length} 张图片 · {entry.item.status || "已结束"} · {formatCleanupCountdown(entry)}</small>
                                    </div>
                                    <button class="b3-button" type="button" on:click={() => openCleanupConfirmForItem(entry.item.id)}>{entry.due ? "确认清理" : "现在清理"}</button>
                                </header>
                                <div class="xz-cleanup-page__thumbs">
                                    {#each entry.images.slice(0, 12) as image (image.src)}
                                        <a class="xz-cleanup-page__thumb" href={image.src} target="_blank" rel="noreferrer" title={`${image.name}（点击查看原图）`}>
                                            <img src={image.src} alt={image.name} loading="lazy" />
                                        </a>
                                    {/each}
                                    {#if entry.images.length > 12}<span class="xz-cleanup-page__more">还有 {entry.images.length - 12} 张</span>{/if}
                                </div>
                            </article>
                        {/each}
                    </div>
                    <p class="xz-cleanup-page__note">点「现在清理」进入下一步，那里会逐条逐张让你勾选范围；被保留的图片会标明引用方。</p>
                {/if}
            {/if}
        </main>
    {:else if loading}
        <main class="xz-state"><span class="xz-spinner"></span><p>正在读取行舟内部数据……</p></main>
    {:else if error}
        <main class="xz-state xz-error">
            <h2>暂时无法读取内部数据</h2><p>{error}</p>
            <button class="b3-button" type="button" on:click={() => void refresh()}>重试</button>
        </main>
    {:else if data}
        {#if data.missingFields.includes("本次行动细则")}
            <div class="xz-notice"><strong>数据提示：</strong>内部数据缺少“本次行动细则”字段，请重新加载插件以恢复完整字段定义。</div>
        {/if}
        {#if tree.issues.length > 0}
            <div class="xz-notice xz-notice--warning"><strong>关系检查：</strong>发现 {tree.issues.length} 个需要人工确认的层级关系问题。插件只提示，不会自动修正。</div>
        {/if}

        <main class:xz-workspace--scope-open={scopeDrawerOpen} class:xz-workspace--detail-open={compactDetailOpen} class="xz-workspace">
            {#if scopeDrawerOpen}<button class="xz-scope-backdrop" type="button" aria-label="关闭范围选择" on:click={() => scopeDrawerOpen = false}></button>{/if}
            <aside class:xz-sidebar--open={scopeDrawerOpen} class="xz-sidebar" bind:this={sidebarElement}>
                <button class="xz-scope-drawer-close" type="button" on:click={() => scopeDrawerOpen = false}>关闭范围</button>
                <section class="xz-sidebar-group xz-sidebar-group--areas">
                    <h2><span>长期领域与想法</span><span class="xz-sidebar-group-actions"><small>{areaAndIdeaRoots.length}</small><button type="button" aria-label="添加长期领域或想法" title="添加长期领域或想法" on:click={() => void openSidebarCapture("areaOrIdea")}>＋</button></span></h2>
                    {#if areaAndIdeaRoots.length === 0}<p class="xz-sidebar-empty">暂无内容</p>{/if}
                    {#each areaAndIdeaRoots as item (item.id)}
                        <button class:active={scope === item.id} class="xz-scope-button" type="button" data-work-item-id={item.id} on:click={() => selectScopeItem(item)}>
                            <span>{item.title}</span><small>{item.status || "未设置"}</small>
                        </button>
                    {/each}
                </section>
                <section class="xz-sidebar-group xz-sidebar-group--projects">
                    <h2><span>顶层项目</span><span class="xz-sidebar-group-actions"><small>{topLevelProjects.length}</small><button type="button" aria-label="添加顶层项目" title="添加顶层项目" on:click={() => void openSidebarCapture("topProject")}>＋</button></span></h2>
                    {#if topLevelProjects.length === 0}<p class="xz-sidebar-empty">暂无内容</p>{/if}
                    {#each topLevelProjects as item (item.id)}
                        <button class:active={scope === item.id} class="xz-scope-button" type="button" data-work-item-id={item.id} on:click={() => selectScopeItem(item)}>
                            <span>{item.title}</span><small>{item.status || "未设置"}</small>
                        </button>
                    {/each}
                </section>
                <section class="xz-sidebar-group xz-sidebar-group--transactions">
                    <h2><span>独立事务</span><span class="xz-sidebar-group-actions"><small>{independentTransactions.length}</small><button type="button" aria-label="添加独立事务" title="添加独立事务" on:click={() => void openSidebarCapture("transaction")}>＋</button></span></h2>
                    {#if independentTransactions.length === 0}<p class="xz-sidebar-empty">暂无内容</p>{/if}
                    {#each independentTransactions as item (item.id)}
                        <button class:active={scope === item.id} class="xz-scope-button" type="button" data-work-item-id={item.id} on:click={() => selectScopeItem(item)}>
                            <span>{item.title}</span><small>{item.status || "未设置"}</small>
                        </button>
                    {/each}
                </section>
                {#if uncategorizedRoots.length > 0}
                    <section class="xz-sidebar-group xz-sidebar-group--uncategorized">
                        <h2><span>待归类</span><small>{uncategorizedRoots.length}</small></h2>
                        {#each uncategorizedRoots as item (item.id)}
                            <button class:active={scope === item.id} class="xz-scope-button" type="button" data-work-item-id={item.id} on:click={() => selectScopeItem(item)}>
                                <span>{item.title}</span><small>{item.type || "未分类"}</small>
                            </button>
                        {/each}
                    </section>
                {/if}
                <footer>{data.attributeViewName}<br><span>{data.items.length} 个工作项</span></footer>
            </aside>

            <section class="xz-tree-panel">
                <div class="xz-panel-heading">
                    <div class="xz-panel-heading-main"><button class="xz-tablet-scope-button" type="button" aria-expanded={scopeDrawerOpen} on:click={() => scopeDrawerOpen = !scopeDrawerOpen}>范围</button><div><span>层级浏览</span><small>{filter === "active" ? "只展开活跃路径" : filter === "today" ? "只看今天安排了未完成切片的事务" : "当前筛选默认完整展开"}</small></div></div>
                    <div class="xz-role-legend" aria-label="层级颜色含义">
                        {#each WORK_ITEM_ROLE_LEGEND as role}<RoleBadge {role} compact />{/each}
                    </div>
                </div>
                <div class="xz-tree-scroll" bind:this={treeScrollElement}>
                    {#if reorderError}<p class="xz-tree-order-error" role="alert">{reorderError}</p>{/if}
                    {#if visibleRoots.length === 0}
                        {#if filter === "today"}
                            <div class="xz-empty">
                                <div class="xz-empty-hint">
                                    <p>今天还没有安排执行切片。</p>
                                    <button class="xz-link-button" type="button" on:click={() => page = "week"}>去「本周」安排今天要做的事务</button>
                                </div>
                            </div>
                        {:else}
                            <div class="xz-empty"><p>当前范围没有符合条件的工作项。</p></div>
                        {/if}
                    {:else}
                        {#each visibleRoots as root (root.id)}
                            <TreeNode
                                item={root}
                                {tree}
                                {selectedId}
                                {expandedIds}
                                {visibleIds}
                                {todayFocusCounts}
                                {pinnedFocusId}
                                {draggingId}
                                reorderDisabled={reordering}
                                on:select={(event) => selectTreeItem(event.detail.id)}
                                on:toggle={(event) => toggle(event.detail.id)}
                                on:dragstate={(event) => draggingId = event.detail.id}
                                on:reorder={(event) => void reorderRelative(event.detail.draggedId, event.detail.targetId, event.detail.position)}
                                on:move={(event) => moveSibling(event.detail.id, event.detail.direction)}
                                on:actions={(event) => {
                                    const item = tree.byId.get(event.detail.id);
                                    if (item) openActionsMenu(event.detail.event, item);
                                }}
                            />
                        {/each}
                    {/if}
                </div>
            </section>

            <aside class:xz-detail--open={compactDetailOpen} class="xz-detail" bind:this={detailElement}>
                {#if selected}
                    <div class="xz-detail-header">
                        <button class="xz-detail-back-button" type="button" on:click={() => compactDetailOpen = false}>‹ 返回列表</button>
                        <div class="xz-detail-identity">
                            <div class="xz-detail-role-row">
                                {#if selectedProfile}<RoleBadge role={selectedProfile.role} />{/if}
                                <div class="xz-detail-role-actions">
                                    {#if canAddChild(selected)}
                                        <button class="xz-add-child-button" type="button" on:click={() => void openChildCapture(selected)}>
                                            ＋ {selected.type === "长期领域" ? "添加顶层项目" : "添加下级"}
                                        </button>
                                    {/if}
                                    {#if selectedProfile?.showComplete && !isClosed(selected)}
                                        <button class="xz-complete-button" type="button" title="将状态改为已完成" disabled={Boolean(savingInline)} on:click={() => void markSelectedComplete()}>
                                            ✓ 标记为完成
                                        </button>
                                    {/if}
                                </div>
                            </div>
                            <div class="xz-detail-title-row" data-work-item-id={selected.id}>
                                <input class="xz-inline-title" aria-label="名称" bind:value={detailDraft.title} disabled={Boolean(savingInline)} on:blur={() => void saveInline("title", detailDraft.title)} on:keydown={(event) => event.key === "Enter" && event.currentTarget.blur()} />
                                <button class="xz-detail-menu-button" type="button" aria-label={`打开“${selected.title}”的操作菜单`} title="更多操作" on:click={(event) => openActionsMenu(event, selected)}>⋯</button>
                            </div>
                        </div>
                    </div>

                    <div class="xz-meta-grid xz-meta-grid--editable">
                        <label><span>工作项类型</span><select class="b3-select xz-meta-type-select" aria-label="工作项类型" bind:value={detailDraft.type} disabled={Boolean(savingInline)} on:change={() => void saveInline("type", detailDraft.type)}><option value="">未分类</option>{#if detailDraft.type && !(data.fields.type?.options ?? []).some((option) => option.name === detailDraft.type)}<option value={detailDraft.type}>{detailDraft.type}（旧类型）</option>{/if}{#each data.fields.type?.options ?? [] as option}<option value={option.name}>{option.name}</option>{/each}</select></label>
                        <label><span>{selectedProfile?.statusLabel ?? "状态"} {#if selected.type !== "长期领域" && hasOngoingDescendant(selected.id, tree) && selected.status !== "进行中" && selected.status !== "活跃" && selected.status !== "收件箱" && selected.status !== "待开始" && selected.status !== "已计划"}<em class="xz-date-hint xz-date-hint--pending">下级仍在进行</em>{/if}</span><select class="b3-select xz-meta-status-select" aria-label={selectedProfile?.statusLabel ?? "状态"} bind:value={detailDraft.status} disabled={Boolean(savingInline)} on:change={() => void saveInline("status", detailDraft.status)}><option value="">未设置</option>{#if detailDraft.status && !selectedProfile?.statuses.includes(detailDraft.status)}<option value={detailDraft.status}>{detailDraft.status}{legacyStatuses.has(detailDraft.status) ? "（旧状态）" : "（当前值）"}</option>{/if}{#each selectedProfile?.statuses ?? [] as status}<option value={status}>{status}</option>{/each}</select></label>
                        {#if selectedProfile?.showParent}
                            <label><span>{selectedProfile.parentLabel}</span><select class="b3-select" bind:value={detailDraft.parent} disabled={Boolean(savingInline)} on:change={() => void saveInline("parent", detailDraft.parent)}><option value="">—</option>{#each parentCandidates as item}<option value={item.id}>{item.title}</option>{/each}</select></label>
                        {/if}
                        {#if selectedProfile?.showTopProject}
                            <div class="xz-meta-readonly-field"><span>所属顶层项目</span><strong>{topProject?.title ?? "尚未形成顶层项目链"}</strong></div>
                        {/if}
                        {#if selectedProfile?.showPlanDate}
                            <label><span>计划开始日 {#if isToday(selected.planDate) && !isClosed(selected)}<em class="xz-date-hint xz-date-hint--today">今日</em>{:else if isFuturePlanDate(selected.planDate) && !isClosed(selected)}<em class="xz-date-hint xz-date-hint--scheduled">已安排</em>{/if}</span><input class="b3-text-field" type="date" bind:value={detailDraft.planDate} disabled={Boolean(savingInline)} on:change={() => void saveInline("planDate", detailDraft.planDate)} /></label>
                        {/if}
                        {#if selectedProfile?.showDeadline}
                            <label class="xz-deadline-field"><span>截止日期 {#if isOverdue(selected)}<em class="xz-date-hint xz-date-hint--overdue">已逾期</em>{:else if detailDraft.deadlineMode === "pending"}<em class="xz-date-hint xz-date-hint--pending">待确认</em>{/if}</span><div class="xz-deadline-control"><select class="b3-select" aria-label="截止日期设置" bind:value={detailDraft.deadlineMode} disabled={Boolean(savingInline)} on:change={() => void saveDeadlineMode(detailDraft.deadlineMode)}><option value="pending">待确认</option><option value="none" disabled={!data.fields.noDeadline}>无</option><option value="date">具体日期</option></select>{#if detailDraft.deadlineMode === "date"}<input class="b3-text-field" aria-label="具体截止日期" type="date" bind:value={detailDraft.deadline} disabled={Boolean(savingInline)} on:change={() => void saveDeadlineDate(detailDraft.deadline)} />{/if}</div></label>
                        {/if}
                        {#if selectedProfile?.showExecutionCost}
                            {#if selected.type !== "事务"}<label><span>预计时长（分钟）</span><input class="b3-text-field" type="number" min="0" step="1" bind:value={detailDraft.duration} disabled={Boolean(savingInline)} on:change={() => void saveInline("duration", detailDraft.duration)} /></label>{/if}
                            <label><span>所需精力</span><select class="b3-select" bind:value={detailDraft.energy} disabled={Boolean(savingInline)} on:change={() => void saveInline("energy", detailDraft.energy)}><option value="">—</option>{#each data.fields.energy?.options ?? [] as option}<option value={option.name}>{option.name}</option>{/each}</select></label>
                        {/if}
                    </div>
                    {#if selectedProfile?.showDeadline && !data.fields.noDeadline}<p class="xz-missing-field"><strong>内部字段暂不可用</strong><span>请重新加载插件后再设置“无截止日期”。</span></p>{/if}
                    {#if savingInline}<p class="xz-inline-feedback">正在保存并复核……</p>{/if}
                    {#if inlineError}<p class="xz-save-error" role="alert">{inlineError}</p>{/if}
                    {#if fieldSaveError}<p class="xz-save-error" role="alert">{fieldSaveError}</p>{/if}

                    {#if selected.type === "事务"}
                        <ExecutionSlicePlanner item={selected} items={data.items} disabled={Boolean(savingInline)} save={saveSelectedSlices} saveUndo={(changes) => saveSelectedSlices(changes, { sliceUndo: true })} complete={() => markSelectedComplete()} />
                    {/if}

                    <section class="xz-dependency-card">
                        <header>
                            <div><h3>跨项目依赖</h3><p>独立于上下层归属，可连接任意领域中的工作项。</p></div>
                            {#if unmetHardPrerequisites.length > 0}<span class="xz-dependency-warning">{unmetHardPrerequisites.length} 项尚未完成</span>{/if}
                        </header>
                        <div class="xz-dependency-group">
                            <div class="xz-dependency-label"><strong>完成后开始</strong><span>前置项完成后再启动当前项</span></div>
                            <div class="xz-dependency-values">
                                {#each hardPrerequisites as item (item.id)}
                                    <span class="xz-dependency-chip" class:xz-dependency-chip--pending={item.status !== "已完成"}>{item.title}<small>{item.status || "未设置"}</small><button type="button" aria-label={`移除硬依赖 ${item.title}`} disabled={Boolean(savingInline)} on:click={() => void removeDependency("hardPrerequisites", item.id)}>×</button></span>
                                {/each}
                                <select class="b3-select xz-dependency-add" aria-label="添加完成后开始依赖" disabled={Boolean(savingInline)} on:change={(event) => void addDependency("hardPrerequisites", event)}>
                                    <option value="">＋ 添加前置项</option>
                                    {#each dependencyCandidates.filter((item) => !selectedPrerequisiteIds.has(item.id)) as item}<option value={item.id}>{item.title} · {item.type || "未分类"}</option>{/each}
                                </select>
                            </div>
                        </div>
                        <div class="xz-dependency-group">
                            <div class="xz-dependency-label"><strong>需先行</strong><span>允许并行，但前置项应保持领先</span></div>
                            <div class="xz-dependency-values">
                                {#each softPrerequisites as item (item.id)}
                                    <span class="xz-dependency-chip">{item.title}<small>{item.status || "未设置"}</small><button type="button" aria-label={`移除软依赖 ${item.title}`} disabled={Boolean(savingInline)} on:click={() => void removeDependency("softPrerequisites", item.id)}>×</button></span>
                                {/each}
                                <select class="b3-select xz-dependency-add" aria-label="添加需先行依赖" disabled={Boolean(savingInline)} on:change={(event) => void addDependency("softPrerequisites", event)}>
                                    <option value="">＋ 添加先行项</option>
                                    {#each dependencyCandidates.filter((item) => !selectedPrerequisiteIds.has(item.id)) as item}<option value={item.id}>{item.title} · {item.type || "未分类"}</option>{/each}
                                </select>
                            </div>
                        </div>
                        {#if selectedDependents.length > 0}
                            <div class="xz-dependency-supported"><strong>被以下工作项依赖</strong><span>{selectedDependents.map((item) => item.title).join("、")}</span></div>
                        {/if}
                    </section>

                    {#if selected.type === "事务" || selected.type === "想法"}
                        <TodoListCard
                            todos={itemTodos(selected)}
                            disabled={Boolean(savingInline || savingSlices)}
                            relativeDay={relativeDayLabel}
                            on:add={(event) => void handleTodoAdd(currentItem, event.detail.text)}
                            on:text={(event) => void handleTodoText(currentItem, event.detail.id, event.detail.text)}
                            on:detail={(event) => void handleTodoDetail(currentItem, event.detail.id, event.detail.note, event.detail.links)}
                            on:done={(event) => void handleTodoDone(currentItem, event.detail.id)}
                            on:dropped={(event) => void handleTodoDropped(currentItem, event.detail.id)}
                            on:restore={(event) => void handleTodoRestore(currentItem, event.detail.id)}
                            on:remove={(event) => void handleTodoRemove(currentItem, event.detail.id)}
                            on:today={(event) => void handleTodosToToday(currentItem, event.detail.ids)}
                        />
                    {/if}

                    <ActionDetailCard
                        title={selectedProfile?.actionLabel ?? "本次行动细则"}
                        detail={itemActionDetail(selected)}
                        nextAction={selected.nextAction}
                        autoFacts={itemAutoFacts(selected)}
                        disabled={Boolean(savingInline || savingSlices)}
                        templateNames={actionTemplateNames}
                        fieldNotice={data.fields.currentAction || data.fields.nextAction ? "" : "内部字段暂不可用，请重新加载插件。"}
                        cleanupBadge={selectedCleanupBadge ?? ""}
                        onCleanupBadge={openCleanupPage}
                        onImageClick={(event, field) => handleActionImageClick(event, field === "nextAction" ? "nextAction" : `detail:${field}`)}
                        onImageContextMenu={handleImageContextMenu}
                        on:edit={(event) => openDetailEditorWindow(event.detail.field)}
                        on:nextAction={() => openDetailEditorWindow("nextAction")}
                        on:addOutcome={(event) => void handleOutcomeAdd(currentItem, event.detail.text)}
                        on:outcomeText={(event) => void handleOutcomeText(currentItem, event.detail.id, event.detail.text)}
                        on:removeOutcome={(event) => void handleOutcomeRemove(currentItem, event.detail.id)}
                        on:copyPrompt={() => void copyPrompt(currentItem)}
                        on:applyTemplate={(event) => void applyActionTemplate(currentItem, event.detail.name)}
                                        on:saveTemplate={(event) => void saveActionTemplate(currentItem, event.detail.name)}
                    />

                    {#if selectedIssues.length > 0}
                        <section class="xz-issues"><h3>关系提示</h3>{#each selectedIssues as issue}<p>{issue.message}</p>{/each}</section>
                    {/if}

                    {#if selected.documentId}
                        <button class="b3-button xz-open-document" type="button" on:click={() => selected?.documentId && void openDocument(selected.documentId)}>
                            <svg><use href="#iconOpen"></use></svg>打开关联文档
                        </button>
                    {:else}
                        <p class="xz-detached-note">这是行舟内部工作项，当前没有关联思源文档。</p>
                    {/if}
                    <p class="xz-detail-note">待办勾选与打叉即时保存；细则字段点「编辑 / 大窗口编辑」打开编辑窗口，⌘/Ctrl+Enter 保存、Esc 取消。修改会写入插件内部数据并重新读取复核。</p>
                {:else}
                    <div class="xz-empty"><p>选择一个工作项查看详情。</p></div>
                {/if}
            </aside>
        </main>
    {/if}

    {#if completionDialog}
        <CompletionDialog
            title={completionDialog.title}
            blockers={completionDialog.blockers}
            disabled={completionBusy}
            error={completionDialogError}
            on:confirm={(event) => void confirmCompletion(event.detail.disposition, event.detail.reason)}
            on:cancel={() => { completionDialog = null; completionDialogError = ""; }}
        />
    {/if}

    {#if completionUndo}
        <div class="xz-completion-undo" role="status" aria-live="polite">
            <span>已将“{completionUndo.title}”标记为完成</span>
            <button type="button" disabled={undoingCompletion} on:click={() => void undoCompletion()}>{undoingCompletion ? "正在撤销…" : "撤销"}</button>
        </div>
    {/if}

    {#if deleteTarget}
        <div class="xz-dialog-backdrop" role="presentation" on:click|self={() => { if (!deleting) { deleteTarget = null; deleteError = ""; } }}>
            <section class="xz-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="xz-delete-title">
                <span class="xz-section-kicker">删除工作项</span>
                <h2 id="xz-delete-title">删除“{deleteTarget.title}”？</h2>
                <p>这个工作项将从行舟内部数据中移除。</p>
                {#if deleteTarget.documentId}
                    <p class="xz-delete-note">关联的思源文档不会被删除，只会移除行舟保存的关联记录。</p>
                {:else}
                    <p class="xz-delete-note">这是行舟内部工作项；删除后，其名称和属性不会保留。</p>
                {/if}
                {#if deleteDescendantCount > 0}
                    <p class="xz-delete-warning">检测到 {deleteDescendantCount} 个下级工作项。它们不会被级联删除，指向当前父项的关系会自动清除。</p>
                {/if}
                {#if deleteTopReferenceCount > 0}
                    <p class="xz-delete-warning">另有 {deleteTopReferenceCount} 个工作项把它设为所属顶层项目；这些引用会自动清除。</p>
                {/if}
                {#if deleteDependencyReferenceCount > 0}
                    <p class="xz-delete-warning">另有 {deleteDependencyReferenceCount} 个工作项把它设为前置项；这些依赖会自动清除。</p>
                {/if}
                {#if deleteError}<p class="xz-save-error" role="alert">{deleteError}</p>{/if}
                <div class="xz-delete-actions">
                    <button class="b3-button b3-button--outline" type="button" disabled={deleting} on:click={() => { deleteTarget = null; deleteError = ""; }}>取消</button>
                    <button class="b3-button xz-danger-button" type="button" disabled={deleting} on:click={() => void confirmDelete()}>{deleting ? "正在删除并复核…" : "确认删除"}</button>
                </div>
            </section>
        </div>
    {/if}
</div>
