<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import type { CaptureDialogMode, CaptureDialogRequest, CaptureDialogValues } from "./capture-dialog";
    import { prerequisiteIds, validateDependencyUpdate, type DependencyKind } from "./dependencies";
    import { continueMarkdownList, normalizeMarkdownOrderedLists } from "./markdown-editor";
    import { renderActionMarkdown } from "./markdown-renderer";
    import ExecutionSlicePlanner from "./ExecutionSlicePlanner.svelte";
    import { pickFallbackTransaction } from "./ui-state";
    import {
        availableSliceCount,
        automaticStatusForSliceCompletion,
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
    import { getTodayFocusCounts } from "./today-focus";
    import TreeNode from "./TreeNode.svelte";
    import { buildWorkItemTree, collectDescendantIds, compareWorkItemOrder, hasActiveDescendant, hasOngoingDescendant, isActive, isClosed, type WorkItemTree } from "./tree";
    import { groupWeekOccurrences, isWeekOccurrenceCompact, weekOccurrenceLabel } from "./week-schedule";
    import { deriveTopProjectId, getWorkItemProfile, needsDeadlineDecision, WORK_ITEM_ROLE_LEGEND } from "./work-item-role";
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
    ) => void = (_event, onDelete) => onDelete();
    export let openCaptureDialog: (request: CaptureDialogRequest) => void = () => undefined;
    export let openDocument: (blockId: string) => Promise<void>;
    export let embedded = false;
    export let initialWorkItemId: string | null = null;
    export let initialViewState: WorkItemViewState | null = null;
    export let saveViewState: ((state: WorkItemViewState) => Promise<void> | void) | null = null;
    export let loadSavedViewState: (() => Promise<WorkItemViewState | null>) | null = null;

    type MainPage = "week" | "all" | "review" | "graph";
    type ItemFilter = "all" | "active" | "future" | "closed";
    type WeekDay = { timestamp: number; key: string; label: string; dateLabel: string; isToday: boolean };
    type ActionField = "currentAction" | "nextAction";
    type CompletionUndo = { rowId: string; title: string; status: string };

    const mainPages: Array<{ id: MainPage; label: string }> = [
        { id: "all", label: "全部" },
        { id: "week", label: "本周" },
        { id: "review", label: "整理" },
        { id: "graph", label: "关系图" },
    ];
    const itemFilters: Array<{ id: ItemFilter; label: string }> = [
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
    let visibleIds = new Set<string>();
    let visibleRoots: WorkItem[] = [];
    export let loading = true;
    let error = "";
    let selectedId: string | null = null;
    let scope: "all" | string = "all";
    let scopeDrawerOpen = false;
    let compactDetailOpen = false;
    let expandedIds = new Set<string>();
    let capturing = false;
    export let quickCaptureNotice = "";
    let weekStart = startOfWeek(Date.now());
    let weekSavingIds = new Set<string>();
    let weekError = "";
    let editingAction: ActionField | null = null;
    let savingAction: ActionField | null = null;
    let savingInline: string | null = null;
    let savingSlices = false;
    let completionUndo: CompletionUndo | null = null;
    let completionUndoTimer: ReturnType<typeof setTimeout> | null = null;
    let temporalRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let undoingCompletion = false;
    let actionErrors: Record<ActionField, string> = { currentAction: "", nextAction: "" };
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

    onDestroy(() => flushViewState());

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
    $: todayFocusCounts = getTodayFocusCounts(data?.items ?? [], tree);
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
        filter; includeClosed; tree;
        areaAndIdeaRoots = allAreaAndIdeaRoots.filter(shouldShowSidebarRoot);
        topLevelProjects = allTopLevelProjects.filter(shouldShowSidebarRoot);
        independentTransactions = allIndependentTransactions.filter(shouldShowSidebarRoot);
        uncategorizedRoots = allUncategorizedRoots.filter(shouldShowSidebarRoot);
    }
    $: {
        data; scope; filter; tree; includeClosed;
        visibleIds = getVisibleIds();
    }
    $: {
        scope; tree; visibleIds;
        visibleRoots = getVisibleRoots();
    }
    $: if (page === "all" && data && selectedId && !visibleIds.has(selectedId)) {
        // 选中项不可见（已完成/删除/筛选）时的确定性回落：今日未完成切片最多 → 树显示顺序第一个
        const fallbackId = pickFallbackTransaction(data.items, tree, visibleIds);
        if (fallbackId) revealRestoredItem(tree.byId.get(fallbackId));
        else selectedId = null;
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

    Promise.resolve().then(() => void refresh());

    onMount(() => {
        try {
            includeClosed = localStorage.getItem(includeClosedStorageKey) === "true";
        } catch {
            includeClosed = false;
        }
        scheduleTemporalRefresh();
        return () => {
            clearCompletionUndo();
            if (temporalRefreshTimer) clearTimeout(temporalRefreshTimer);
        };
    });

    export async function refresh() {
        loading = true;
        error = "";
        try {
            if (!appliedInitialViewState && !initialViewState && loadSavedViewState) {
                const saved = await loadSavedViewState();
                if (saved && !initialViewState) initialViewState = saved;
            }
            const loaded = await load();
            applyData(loaded);
            try {
                applyData(await reconcileAutomaticStatuses(loaded));
            } catch (caught) {
                inlineError = `日期状态自动更新失败：${caught instanceof Error ? caught.message : String(caught)}`;
            }
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
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

    function shouldShowSidebarRoot(item: WorkItem): boolean {
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
        scopeDrawerOpen = false;
        compactDetailOpen = true;
    }

    function selectTreeItem(id: string) {
        selectedId = id;
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
    }

    async function confirmDelete() {
        if (!data || !deleteTarget || deleting) return;
        const target = deleteTarget;
        deleting = true;
        deleteError = "";
        try {
            const refreshed = await deleteItem(data, target);
            if (scope === target.id) scope = "all";
            if (selectedId === target.id) selectedId = null;
            applyData(refreshed);
            deleteTarget = null;
        } catch (caught) {
            deleteError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            deleting = false;
        }
    }

    function emptyDetailDraft() {
        return { title: "", type: "", status: "", parent: "", topProject: "", planDate: "", deadline: "", deadlineMode: "pending", duration: "", energy: "", currentAction: "", nextAction: "" };
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
        };
        draftSourceId = item.id;
        editingAction = null;
        savingAction = null;
        actionErrors = { currentAction: "", nextAction: "" };
        inlineError = "";
    }

    function startActionEditing(field: ActionField) {
        const fieldAvailable = field === "currentAction" ? data?.fields.currentAction : data?.fields.nextAction;
        if (!selected || !fieldAvailable) return;
        detailDraft = { ...detailDraft, [field]: selected[field] };
        actionErrors = { ...actionErrors, [field]: "" };
        editingAction = field;
    }

    function cancelActionEditing(field: ActionField) {
        if (!selected) return;
        detailDraft = { ...detailDraft, [field]: selected[field] };
        actionErrors = { ...actionErrors, [field]: "" };
        if (editingAction === field) editingAction = null;
    }

    async function saveAction(field: ActionField) {
        if (!data || !selected || savingAction) return;
        const value = detailDraft[field];
        if (value === selected[field]) {
            if (editingAction === field) editingAction = null;
            return;
        }
        const sourceId = selected.id;
        const sourceRowId = selected.rowId;
        savingAction = field;
        actionErrors = { ...actionErrors, [field]: "" };
        try {
            applyData(await saveItem(data, selected, { [field]: value }));
            const updated = data?.items.find((item) => item.rowId === sourceRowId);
            if (updated) {
                detailDraft = { ...detailDraft, [field]: updated[field] };
                if (selectedId === sourceId) draftSourceId = updated.id;
            }
            if (editingAction === field) editingAction = null;
        } catch (caught) {
            actionErrors = { ...actionErrors, [field]: caught instanceof Error ? caught.message : String(caught) };
        } finally {
            savingAction = null;
        }
    }

    function handleActionKeydown(event: KeyboardEvent, field: ActionField) {
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
            detailDraft = { ...detailDraft, [field]: edit.value };
            event.target.value = edit.value;
            event.target.setSelectionRange(edit.cursor, edit.cursor);
        }
    }

    function handleActionInput(event: Event, field: ActionField) {
        if (!(event.target instanceof HTMLTextAreaElement)) return;
        if ((event as InputEvent).isComposing) {
            detailDraft = { ...detailDraft, [field]: event.target.value };
            return;
        }
        const normalized = normalizeMarkdownOrderedLists(event.target.value, event.target.selectionStart, event.target.selectionEnd);
        detailDraft = { ...detailDraft, [field]: normalized.value };
        event.target.value = normalized.value;
        event.target.setSelectionRange(normalized.selectionStart, normalized.selectionEnd);
    }

    function handleActionCardKeydown(event: KeyboardEvent, field: ActionField) {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        startActionEditing(field);
    }

    function focusOnMount(node: HTMLTextAreaElement) {
        node.focus();
        node.setSelectionRange(node.value.length, node.value.length);
    }

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
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : String(caught);
            resetDetailDraft(selected);
            inlineError = message;
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
        try {
            applyData(await saveItem(data, selected, { [kind]: normalized }));
            const updated = data?.items.find((item) => item.rowId === selectedRowId);
            if (updated) {
                selectedId = updated.id;
                resetDetailDraft(updated);
            }
        } catch (caught) {
            inlineError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            savingInline = null;
        }
    }

    async function markSelectedComplete() {
        if (!selected || savingInline || savingSlices) return;
        const previous = { rowId: selected.rowId, title: selected.title, status: selected.status };
        await saveInline("status", "已完成");
        const updated = data?.items.find((item) => item.rowId === previous.rowId);
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

    async function updateWeekItem(item: WorkItem, changes: WorkItemChanges) {
        if (!data || weekSavingIds.has(item.id)) return;
        weekSavingIds = new Set(weekSavingIds).add(item.id);
        weekError = "";
        try {
            applyData(await reconcileAutomaticStatuses(await saveItem(data, item, withAutomaticSliceStatus(item, changes))));
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

    async function saveSelectedSlices(changes: WorkItemChanges) {
        if (!data || !selected || savingInline || savingSlices) return;
        const selectedRowId = selected.rowId;
        savingSlices = true;
        inlineError = "";
        try {
            applyData(await saveItem(data, selected, withAutomaticSliceStatus(selected, changes)));
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
        if (!changes.executionSlices || changes.status !== undefined) return changes;
        const status = automaticStatusForSliceCompletion(item, changes.executionSlices);
        return status ? { ...changes, status } : changes;
    }

    async function updateWeekSlice(item: WorkItem, slice: ExecutionSlice, action: "complete" | "miss" | "abandon" | "undo") {
        try {
            const executionSlices = action === "undo"
                ? undoCompletedSlice(item, slice.id)
                : action === "complete"
                    ? completeSliceNow(item, slice.id)
                    : setSliceOutcome(item, slice.id, action === "miss" ? "missed" : "abandoned");
            await updateWeekItem(item, { executionSlices });
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
            .filter((item) => !higherPriorityIds.has(item.id) && (item.type === "事务" || item.type === "想法") && actionableStatuses.has(displayStatus(item.status)) && !item.currentAction.trim())
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
            if (item.type === "任务") return candidate.type === "项目";
            if (item.type === "事务" || item.type === "想法") return candidate.type === "项目" || candidate.type === "任务";
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

    function getVisibleIds(): Set<string> {
        if (!data) return new Set();
        let candidates = data.items;
        if (scope !== "all") {
            const ids = collectDescendantIds(scope, tree);
            candidates = data.items.filter((item) => ids.has(item.id));
        }

        const matched = candidates.filter((item) => {
            if (filter === "active") return isActive(item);
            if (filter === "future") return item.status === "将来" || item.status === "将来／也许" || item.status === "暂停";
            if (filter === "closed") return isClosed(item);
            return includeClosed || !isClosed(item);
        });
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

    function getVisibleRoots(): WorkItem[] {
        if (scope !== "all") {
            const scoped = tree.byId.get(scope);
            return scoped && visibleIds.has(scoped.id) ? [scoped] : [];
        }
        return tree.roots.filter((item) => visibleIds.has(item.id));
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
        return new Set(items.filter((item) => (tree.children.get(item.id) ?? []).length > 0).map((item) => item.id));
    }

    function setFilter(nextFilter: ItemFilter) {
        filter = nextFilter;
        scope = "all";
        expandedIds = getDefaultExpandedIds(nextFilter, data?.items ?? []);
    }

    function collapseAll() {
        expandedIds = new Set();
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

    function fieldLabel(item: WorkItem): string {
        return getWorkItemProfile(item, tree).actionLabel;
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
        </div>
    </header>{/if}

    <div class="xz-project-toolbar">
        <nav class="xz-main-nav" aria-label="主页面">
            {#each mainPages as entry}
                <button class:active={page === entry.id} type="button" on:click={() => page = entry.id}>
                    {entry.label}
                </button>
            {/each}
        </nav>
        {#if page === "all" && data}
            <div class="xz-secondary-bar">
                <div class="xz-filter-controls">
                    <div class="xz-segmented">
                        {#each itemFilters as entry}
                            <button class:active={filter === entry.id} type="button" on:click={() => setFilter(entry.id)}>{entry.label}</button>
                        {/each}
                    </div>
                    <button class:active={includeClosed && filter === "all"} class="xz-include-closed-toggle" type="button" aria-pressed={includeClosed && filter === "all"} disabled={filter !== "all"} title={filter === "all" ? "控制“全部”中是否包含已经结束的工作项" : "此开关仅作用于“全部”筛选"} on:click={toggleIncludeClosed}>
                        {includeClosed && filter === "all" ? "✓ " : ""}包含已结束
                    </button>
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
                            <article class:xz-week-day--today={day.isToday} class="xz-week-day">
                                <header><div><strong>{day.label}</strong><span>{day.dateLabel}</span></div>{#if day.isToday}<em>今天</em>{/if}</header>
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
                    <div class="xz-panel-heading-main"><button class="xz-tablet-scope-button" type="button" aria-expanded={scopeDrawerOpen} on:click={() => scopeDrawerOpen = !scopeDrawerOpen}>范围</button><div><span>层级浏览</span><small>{filter === "active" ? "只展开活跃路径" : "当前筛选默认完整展开"}</small></div></div>
                    <div class="xz-role-legend" aria-label="层级颜色含义">
                        {#each WORK_ITEM_ROLE_LEGEND as role}<RoleBadge {role} compact />{/each}
                    </div>
                </div>
                <div class="xz-tree-scroll" bind:this={treeScrollElement}>
                    {#if reorderError}<p class="xz-tree-order-error" role="alert">{reorderError}</p>{/if}
                    {#if visibleRoots.length === 0}
                        <div class="xz-empty"><p>当前范围没有符合条件的工作项。</p></div>
                    {:else}
                        {#each visibleRoots as root (root.id)}
                            <TreeNode
                                item={root}
                                {tree}
                                {selectedId}
                                {expandedIds}
                                {visibleIds}
                                {todayFocusCounts}
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
                        <label><span>工作项类型</span><select class="b3-select xz-meta-type-select" aria-label="工作项类型" bind:value={detailDraft.type} disabled={Boolean(savingInline)} on:change={() => void saveInline("type", detailDraft.type)}><option value="">未分类</option>{#each data.fields.type?.options ?? [] as option}<option value={option.name}>{option.name}</option>{/each}</select></label>
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

                    {#if selected.type === "事务"}
                        <ExecutionSlicePlanner item={selected} items={data.items} disabled={Boolean(savingInline)} save={saveSelectedSlices} complete={() => markSelectedComplete()} />
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

                    {#if data.fields.currentAction}
                        <section
                            class:xz-action-card--editing={editingAction === "currentAction"}
                            class="xz-action-card xz-action-card--primary xz-action-card--editable"
                            role="button"
                            tabindex="0"
                            on:click={() => startActionEditing("currentAction")}
                            on:keydown={(event) => handleActionCardKeydown(event, "currentAction")}
                        >
                            <header><h3>{fieldLabel(selected)}</h3><span>{savingAction === "currentAction" ? "正在保存并复核…" : editingAction === "currentAction" ? "Esc 取消 · ⌘/Ctrl+Enter 保存" : "点击编辑"}</span></header>
                            {#if editingAction === "currentAction"}
                                <textarea use:focusOnMount use:autoResizeTextarea={detailDraft.currentAction} class="b3-text-field xz-action-editor" rows="6" aria-label={fieldLabel(selected)} value={detailDraft.currentAction} disabled={savingAction === "currentAction"} on:input={(event) => handleActionInput(event, "currentAction")} on:click|stopPropagation on:blur={() => void saveAction("currentAction")} on:keydown={(event) => handleActionKeydown(event, "currentAction")}></textarea>
                            {:else if selected.currentAction}
                                <div class="xz-markdown-preview">{@html renderActionMarkdown(selected.currentAction)}</div>
                            {:else}
                                <p class="xz-action-empty">尚未填写。</p>
                            {/if}
                            {#if actionErrors.currentAction}<p class="xz-action-error" role="alert">{actionErrors.currentAction}</p>{/if}
                        </section>
                    {:else}
                        <section class="xz-action-card xz-action-card--primary xz-action-card--missing">
                            <header><h3>{fieldLabel(selected)}</h3></header>
                            <p>内部字段暂不可用，请重新加载插件。</p>
                        </section>
                    {/if}
                    {#if selectedProfile?.showNextAction}
                        <section
                            class:xz-action-card--editing={editingAction === "nextAction"}
                            class="xz-action-card xz-action-card--editable"
                            role="button"
                            tabindex="0"
                            on:click={() => startActionEditing("nextAction")}
                            on:keydown={(event) => handleActionCardKeydown(event, "nextAction")}
                        >
                            <header><h3>下一步行动</h3><span>{savingAction === "nextAction" ? "正在保存并复核…" : editingAction === "nextAction" ? "Esc 取消 · ⌘/Ctrl+Enter 保存" : "点击编辑"}</span></header>
                            {#if editingAction === "nextAction"}
                                <textarea use:focusOnMount use:autoResizeTextarea={detailDraft.nextAction} class="b3-text-field xz-action-editor" rows="4" aria-label="下一步行动" value={detailDraft.nextAction} disabled={savingAction === "nextAction"} on:input={(event) => handleActionInput(event, "nextAction")} on:click|stopPropagation on:blur={() => void saveAction("nextAction")} on:keydown={(event) => handleActionKeydown(event, "nextAction")}></textarea>
                            {:else if selected.nextAction}
                                <div class="xz-markdown-preview">{@html renderActionMarkdown(selected.nextAction)}</div>
                            {:else}
                                <p class="xz-action-empty">尚未填写明确的下一步行动。</p>
                            {/if}
                            {#if actionErrors.nextAction}<p class="xz-action-error" role="alert">{actionErrors.nextAction}</p>{/if}
                        </section>
                    {/if}

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
                    <p class="xz-detail-note">点击行动卡片可直接编辑；失焦自动保存，Esc 取消。修改会写入插件内部数据并重新读取复核。</p>
                {:else}
                    <div class="xz-empty"><p>选择一个工作项查看详情。</p></div>
                {/if}
            </aside>
        </main>
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
