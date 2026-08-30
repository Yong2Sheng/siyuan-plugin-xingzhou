<script lang="ts">
    import { onMount, tick } from "svelte";
    import TreeNode from "./TreeNode.svelte";
    import { buildWorkItemTree, collectDescendantIds, hasActiveDescendant, isActive, isClosed, type WorkItemTree } from "./tree";
    import { deriveTopProjectId, getWorkItemProfile, needsDeadlineDecision } from "./work-item-role";
    import type { InboxCaptureOptions, WorkItem, WorkItemChanges, WorkItemData } from "./work-items";

    export let load: () => Promise<WorkItemData>;
    export let captureInbox: (title: string, options?: InboxCaptureOptions) => Promise<WorkItemData>;
    export let saveItem: (data: WorkItemData, item: WorkItem, changes: WorkItemChanges) => Promise<WorkItemData>;
    export let deleteItem: (data: WorkItemData, item: WorkItem) => Promise<WorkItemData>;
    export let openItemMenu: (event: MouseEvent, onDelete: () => void, addChild?: { label: string; onClick: () => void }) => void = (_event, onDelete) => onDelete();
    export let openDocument: (blockId: string) => Promise<void>;
    export let openDatabase: () => Promise<void>;

    type MainPage = "week" | "all" | "inbox" | "review";
    type ItemFilter = "all" | "active" | "future" | "closed";
    type WeekDay = { timestamp: number; key: string; label: string; dateLabel: string; isToday: boolean };
    type ActionField = "currentAction" | "nextAction";

    const mainPages: Array<{ id: MainPage; label: string }> = [
        { id: "all", label: "全部" },
        { id: "week", label: "本周" },
        { id: "inbox", label: "收件箱" },
        { id: "review", label: "整理" },
    ];
    const itemFilters: Array<{ id: ItemFilter; label: string }> = [
        { id: "all", label: "全部" },
        { id: "active", label: "活跃项目" },
        { id: "future", label: "将来" },
        { id: "closed", label: "已结束" },
    ];
    const legacyStatuses = new Set(["规划中", "活跃", "等待", "将来／也许"]);

    let page: MainPage = "all";
    let filter: ItemFilter = "all";
    let data: WorkItemData | null = null;
    let tree: WorkItemTree = buildWorkItemTree([]);
    let visibleIds = new Set<string>();
    let visibleRoots: WorkItem[] = [];
    let loading = true;
    let error = "";
    let selectedId: string | null = null;
    let scope: "all" | string = "all";
    let expandedIds = new Set<string>();
    let inboxDraft = "";
    let capturing = false;
    let captureError = "";
    let captureMessage = "";
    let quickCaptureOpen = false;
    let quickCaptureTitle = "";
    let quickCaptureParent: WorkItem | null = null;
    let quickCaptureType = "事务";
    let quickCaptureError = "";
    let quickCaptureNotice = "";
    let weekStart = startOfWeek(Date.now());
    let weekSavingIds = new Set<string>();
    let weekError = "";
    let editingAction: ActionField | null = null;
    let savingAction: ActionField | null = null;
    let savingInline: string | null = null;
    let actionErrors: Record<ActionField, string> = { currentAction: "", nextAction: "" };
    let inlineError = "";
    let deleteTarget: WorkItem | null = null;
    let deleteDescendantCount = 0;
    let deleteTopReferenceCount = 0;
    let deleting = false;
    let deleteError = "";
    let draftSourceId: string | null = null;
    let detailDraft = emptyDetailDraft();

    $: selected = selectedId ? tree.byId.get(selectedId) ?? null : null;
    $: selectedProfile = selected ? getWorkItemProfile(selected, tree) : null;
    $: deleteDescendantCount = deleteTarget ? Math.max(0, collectDescendantIds(deleteTarget.id, tree).size - 1) : 0;
    $: {
        const deleteTargetId = deleteTarget?.id;
        deleteTopReferenceCount = deleteTargetId
            ? (data?.items ?? []).filter((item) => item.id !== deleteTargetId && item.topProjectIds.includes(deleteTargetId)).length
            : 0;
    }
    $: areaAndIdeaRoots = sortSidebarItems((data?.items ?? []).filter((item) => item.type === "长期领域" || (item.type === "想法" && !item.parentIds[0])));
    $: topLevelProjects = sortSidebarItems((data?.items ?? []).filter((item) => {
        if (item.type !== "项目") return false;
        const parentItem = item.parentIds[0] ? tree.byId.get(item.parentIds[0]) : null;
        return !parentItem || parentItem.type === "长期领域";
    }));
    $: independentTransactions = sortSidebarItems(tree.roots.filter((item) => item.type === "事务"));
    $: categorizedSidebarIds = new Set([...areaAndIdeaRoots, ...topLevelProjects, ...independentTransactions].map((item) => item.id));
    $: uncategorizedRoots = sortSidebarItems(tree.roots.filter((item) => !categorizedSidebarIds.has(item.id)));
    $: {
        data; scope; filter; tree;
        visibleIds = getVisibleIds();
    }
    $: {
        scope; tree; visibleIds;
        visibleRoots = getVisibleRoots();
    }
    $: parent = selected?.parentIds[0] ? tree.byId.get(selected.parentIds[0]) ?? null : null;
    $: derivedTopProjectId = selected ? deriveTopProjectId(selected.parentIds[0] ?? "", tree) : "";
    $: topProject = derivedTopProjectId ? tree.byId.get(derivedTopProjectId) ?? null : null;
    $: parentCandidates = selected ? getParentCandidates(selected) : [];
    $: selectedIssues = selected ? tree.issues.filter((issue) => issue.itemId === selected.id) : [];
    $: inboxItems = [...(data?.items.filter((item) => item.status === "收件箱") ?? [])]
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    $: weekDays = buildWeekDays(weekStart);
    $: weekItemsByDate = groupWeekItems(data?.items ?? [], weekStart);
    $: scheduledWeekCount = [...weekItemsByDate.values()].reduce((count, items) => count + items.length, 0);
    $: unscheduledWeekItems = getUnscheduledWeekItems(data?.items ?? []);
    $: activeWindowItems = getActiveWindowItems(data?.items ?? []);
    $: reviewActiveProjects = getReviewActiveProjects(data?.items ?? []);
    $: reviewDateItems = getReviewDateItems(data?.items ?? []);
    $: reviewMissingActionItems = getReviewMissingActionItems(data?.items ?? [], new Set(reviewDateItems.map((item) => item.id)));
    $: reviewCompletedThisWeek = getReviewCompletedThisWeek(data?.items ?? []);
    $: if (selected && selected.id !== draftSourceId) resetDetailDraft(selected);

    onMount(() => { void refresh(); });

    async function refresh() {
        loading = true;
        error = "";
        try {
            applyData(await load());
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        } finally {
            loading = false;
        }
    }

    function applyData(nextData: WorkItemData) {
        data = nextData;
        tree = buildWorkItemTree(nextData.items);
        selectedId = selectedId && tree.byId.has(selectedId) ? selectedId : nextData.items[0]?.id ?? null;
        expandedIds = getDefaultExpandedIds(filter, nextData.items);
        loading = false;
    }

    function sortSidebarItems(items: WorkItem[]): WorkItem[] {
        return [...items].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    }

    async function submitInbox() {
        const title = inboxDraft.trim();
        if (!title || capturing) return;
        capturing = true;
        captureError = "";
        captureMessage = "";
        try {
            applyData(await captureInbox(title));
            inboxDraft = "";
            captureMessage = `已加入收件箱：${title}`;
        } catch (caught) {
            captureError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            capturing = false;
        }
    }

    function canAddChild(item: WorkItem): boolean {
        return item.type === "长期领域" || item.type === "项目";
    }

    async function openQuickCapture(parent: WorkItem | null = null) {
        quickCaptureParent = parent;
        quickCaptureType = parent?.type === "长期领域" ? "项目" : parent ? "事务" : "事务";
        quickCaptureTitle = "";
        quickCaptureError = "";
        quickCaptureOpen = true;
        await tick();
        document.querySelector<HTMLInputElement>("#xz-quick-capture-input")?.focus();
    }

    function closeQuickCapture() {
        if (capturing) return;
        quickCaptureOpen = false;
        quickCaptureParent = null;
        quickCaptureError = "";
    }

    async function submitQuickCapture() {
        const title = quickCaptureTitle.trim();
        if (!title || capturing) return;
        const previousIds = new Set(data?.items.map((item) => item.id) ?? []);
        const options: InboxCaptureOptions | undefined = quickCaptureParent
            ? {
                type: quickCaptureType,
                parentId: quickCaptureParent.id,
                topProjectId: quickCaptureParent.type === "项目" ? deriveTopProjectId(quickCaptureParent.id, tree) : "",
            }
            : undefined;
        capturing = true;
        quickCaptureError = "";
        try {
            const refreshed = await captureInbox(title, options);
            applyData(refreshed);
            const created = refreshed.items.find((item) => !previousIds.has(item.id));
            quickCaptureNotice = quickCaptureParent ? `已在“${quickCaptureParent.title}”下创建：${title}` : `已加入收件箱：${title}`;
            quickCaptureOpen = false;
            quickCaptureParent = null;
            quickCaptureTitle = "";
            if (created && options?.parentId) revealInboxItem(created);
        } catch (caught) {
            quickCaptureError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            capturing = false;
        }
    }

    function revealInboxItem(item: WorkItem) {
        page = "all";
        filter = "all";
        scope = item.parentIds[0] || item.id;
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
        if (item) {
            const addChild = canAddChild(item)
                ? { label: item.type === "长期领域" ? "添加顶层项目…" : "添加下级工作项…", onClick: () => void openQuickCapture(item) }
                : undefined;
            openItemMenu(event, () => requestDelete(item), addChild);
        }
    }

    function handleWindowKeydown(event: KeyboardEvent) {
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "i") {
            event.preventDefault();
            void openQuickCapture();
            return;
        }
        if (event.key !== "Escape") return;
        if (quickCaptureOpen && !capturing) {
            closeQuickCapture();
            return;
        }
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
        }
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
        if (!data || !selected || savingInline) return;
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
        }
        if (role === "planDate") {
            if (value && (selected.status === "收件箱" || selected.status === "待开始")) changes.status = "已计划";
            if (!value && selected.status === "已计划") changes.status = "待开始";
        }
        savingInline = role;
        inlineError = "";
        try {
            const selectedRowId = selected.rowId;
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

    async function saveDeadlineMode(mode: string) {
        if (!data || !selected || savingInline) return;
        detailDraft.deadlineMode = mode;
        if (mode === "date") return;
        if (!data.fields.noDeadline) {
            detailDraft.deadlineMode = selected.deadline ? "date" : "pending";
            inlineError = "当前数据库尚无“无截止日期”字段，无法明确保存为“无”。";
            return;
        }
        await saveDeadlineChanges(mode === "none"
            ? { deadline: null, noDeadline: true }
            : { deadline: null, noDeadline: false });
    }

    async function saveDeadlineDate(value: string) {
        if (!data || !selected || savingInline) return;
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
        if (!data || !selected || savingInline) return;
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
            applyData(await saveItem(data, item, changes));
        } catch (caught) {
            weekError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            const next = new Set(weekSavingIds);
            next.delete(item.id);
            weekSavingIds = next;
        }
    }

    async function assignWeekDate(item: WorkItem, dateKey: string) {
        const changes: WorkItemChanges = { planDate: dateKey || null };
        if (dateKey && (item.status === "收件箱" || item.status === "待开始")) changes.status = "已计划";
        if (!dateKey && item.status === "已计划") changes.status = "待开始";
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

    function groupWeekItems(items: WorkItem[], start: number): Map<string, WorkItem[]> {
        const result = new Map<string, WorkItem[]>();
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        for (const item of items) {
            if (isClosed(item) || !item.planDate || item.planDate < start || item.planDate >= end.getTime()) continue;
            const key = formatInputDate(item.planDate);
            const existing = result.get(key) ?? [];
            existing.push(item);
            result.set(key, existing);
        }
        for (const dayItems of result.values()) {
            dayItems.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
        }
        return result;
    }

    function getUnscheduledWeekItems(items: WorkItem[]): WorkItem[] {
        const excludedStatuses = new Set(["收件箱", "暂停", "将来", "将来／也许", "已完成", "已失败", "已取消", "已放弃"]);
        return items
            .filter((item) => !item.planDate && (item.type === "事务" || item.type === "想法") && !excludedStatuses.has(item.status))
            .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    }

    function getActiveWindowItems(items: WorkItem[]): WorkItem[] {
        const excludedStatuses = new Set(["收件箱", "暂停", "将来", "将来／也许", "已完成", "已失败", "已取消", "已放弃"]);
        const today = formatInputDate(Date.now());
        return items
            .filter((item) => {
                if ((item.type !== "事务" && item.type !== "想法") || !item.planDate || !item.deadline || excludedStatuses.has(item.status)) return false;
                return formatInputDate(item.planDate) <= today && formatInputDate(item.deadline) >= today;
            })
            .sort((a, b) => (a.deadline ?? 0) - (b.deadline ?? 0) || a.title.localeCompare(b.title, "zh-CN"));
    }

    function getReviewActiveProjects(items: WorkItem[]): WorkItem[] {
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
        const actionableStatuses = new Set(["待开始", "已计划", "进行中", "阻塞"]);
        return items
            .filter((item) => !higherPriorityIds.has(item.id) && (item.type === "事务" || item.type === "想法") && actionableStatuses.has(displayStatus(item.status)) && !item.currentAction.trim())
            .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    }

    function getReviewDateItems(items: WorkItem[]): WorkItem[] {
        const excludedStatuses = new Set(["收件箱", "暂停", "将来", "将来／也许"]);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        return items
            .filter((item) => !isClosed(item) && !excludedStatuses.has(item.status) && (needsDeadlineDecision(item, tree) || isOverdue(item) || Boolean(item.planDate && item.planDate < todayStart.getTime())))
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
        if (needsDeadlineDecision(item, tree)) return "截止日期待确认";
        return `计划日期已过 · ${formatDate(item.planDate)}`;
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
            return true;
        });
        if (filter === "all") return new Set(matched.map((item) => item.id));

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
        return status;
    }

    function isToday(timestamp: number | null): boolean {
        if (!timestamp) return false;
        const date = new Date(timestamp);
        const today = new Date();
        return date.getFullYear() === today.getFullYear()
            && date.getMonth() === today.getMonth()
            && date.getDate() === today.getDate();
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
    <header class="xz-header">
        <div>
            <div class="xz-eyebrow">个人项目与事务中心</div>
            <h1>行舟</h1>
        </div>
        <div class="xz-header-actions">
            {#if quickCaptureNotice}<span class="xz-quick-capture-notice" aria-live="polite">{quickCaptureNotice}</span>{/if}
            <span class="xz-data-source">本地数据库</span>
            <button class="b3-button b3-button--outline xz-global-capture-button" type="button" on:click={() => void openQuickCapture()}>
                ＋ 记录
            </button>
            <button class="b3-button b3-button--outline" type="button" on:click={() => void refresh()} disabled={loading}>
                <svg><use href="#iconRefresh"></use></svg>{loading ? "读取中" : "刷新"}
            </button>
        </div>
    </header>

    <nav class="xz-main-nav" aria-label="主页面">
        {#each mainPages as entry}
            <button class:active={page === entry.id} type="button" on:click={() => page = entry.id}>
                {entry.label}
            </button>
        {/each}
    </nav>

    {#if page === "inbox"}
        <main class="xz-inbox-page">
            <section class="xz-inbox-hero">
                <div>
                    <span class="xz-section-kicker">快速捕获</span>
                    <h2>先记下来，之后再整理</h2>
                    <p>这里只要求一个名称。类型、上层项目、日期和下一步行动，可以留到每周整理时再补。</p>
                </div>
                <button class="xz-link-button" type="button" on:click={() => void openDatabase()}>打开原始数据库</button>
            </section>

            <form class="xz-capture-card" on:submit|preventDefault={() => void submitInbox()}>
                <label for="xz-inbox-input">突然想到什么？</label>
                <div class="xz-capture-row">
                    <input
                        id="xz-inbox-input"
                        class="b3-text-field"
                        type="text"
                        bind:value={inboxDraft}
                        placeholder="例如：整理书桌上的旧合同"
                        autocomplete="off"
                        disabled={capturing}
                    />
                    <button class="b3-button" type="submit" disabled={capturing || !inboxDraft.trim()}>
                        {capturing ? "正在保存…" : "加入收件箱"}
                    </button>
                </div>
                <p class="xz-capture-hint">按 Enter 即可保存为数据库独立行，状态自动设为“收件箱”。</p>
                {#if captureMessage}<p class="xz-capture-feedback xz-capture-feedback--success" aria-live="polite">{captureMessage}</p>{/if}
                {#if captureError}<p class="xz-capture-feedback xz-capture-feedback--error" aria-live="assertive">{captureError}</p>{/if}
            </form>

            <section class="xz-inbox-list-panel">
                <div class="xz-inbox-list-heading">
                    <div><span class="xz-section-kicker">等待整理</span><h2>收件箱</h2></div>
                    <span>{inboxItems.length} 项</span>
                </div>
                {#if loading && !data}
                    <div class="xz-state"><span class="xz-spinner"></span><p>正在读取收件箱……</p></div>
                {:else if error && !data}
                    <div class="xz-state xz-error"><h2>暂时无法读取收件箱</h2><p>{error}</p><button class="b3-button" type="button" on:click={() => void refresh()}>重试</button></div>
                {:else if inboxItems.length === 0}
                    <div class="xz-inbox-empty"><div class="xz-empty-icon">舟</div><h3>收件箱是空的</h3><p>现在没有等待归类的事项。想到新内容时，直接在上方写下名称即可。</p></div>
                {:else}
                    <div class="xz-inbox-list">
                        {#each inboxItems as item (item.id)}
                            <article class="xz-inbox-item" data-work-item-id={item.id}>
                                <button class="xz-inbox-item-main" type="button" on:click={() => revealInboxItem(item)}>
                                    <span class="xz-inbox-item-title">{item.title}</span>
                                    <span class="xz-inbox-item-meta">{item.type || "未分类"} · {item.updatedAt ? formatDate(item.updatedAt) : "刚刚捕获"}</span>
                                </button>
                                <button class="xz-link-button" type="button" on:click={() => revealInboxItem(item)}>查看详情</button>
                            </article>
                        {/each}
                    </div>
                {/if}
            </section>
        </main>
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
                                        {#each weekItemsByDate.get(day.key) ?? [] as item (item.id)}
                                            <article class:xz-week-item--closed={isClosed(item)} class="xz-week-item" data-work-item-id={item.id}>
                                                <button class="xz-week-item-title" type="button" on:click={() => revealInboxItem(item)}>{item.title}</button>
                                                <div class="xz-week-item-meta"><span>{displayStatus(item.status) || "未设置"}</span>{#if item.durationMinutes !== null}<span>{item.durationMinutes} 分钟</span>{/if}{#if item.energy}<span>{item.energy}精力</span>{/if}</div>
                                                <div class="xz-week-item-actions">
                                                    <select aria-label={`移动“${item.title}”`} disabled={weekSavingIds.has(item.id)} on:change={(event) => handleWeekAssignment(event, item)}>
                                                        <option value="">移动到…</option>{#each weekDays as targetDay}<option value={targetDay.key}>{targetDay.label} · {targetDay.dateLabel}</option>{/each}<option value="__clear">取消安排</option>
                                                    </select>
                                                    <button type="button" disabled={weekSavingIds.has(item.id) || item.status === "已完成"} on:click={() => void updateWeekItem(item, { status: "已完成" })}>{item.status === "已完成" ? "已完成" : "完成"}</button>
                                                </div>
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
                                                <button type="button" on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{item.type || "未分类"} · {displayStatus(item.status) || "未设置"}</span></button>
                                                <select aria-label={`安排“${item.title}”`} disabled={weekSavingIds.has(item.id)} on:change={(event) => handleWeekAssignment(event, item)}>
                                                    <option value="">安排到…</option>{#each weekDays as targetDay}<option value={targetDay.key}>{targetDay.label} · {targetDay.dateLabel}</option>{/each}
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
                    <div><strong>{inboxItems.length}</strong><span>收件箱</span></div>
                    <div class:xz-review-metric--warning={reviewActiveProjects.length > 3}><strong>{reviewActiveProjects.length}<small> / 3</small></strong><span>活跃顶层项目</span></div>
                    <div><strong>{reviewDateItems.length}</strong><span>日期待确认</span></div>
                    <div><strong>{reviewMissingActionItems.length}</strong><span>缺少行动细则</span></div>
                    <div class="xz-review-metric--positive"><strong>{reviewCompletedThisWeek.length}</strong><span>本周已结束</span></div>
                </section>

                <div class="xz-review-steps">
                    <section class:xz-review-step--ready={inboxItems.length === 0} class="xz-review-step">
                        <header><span class="xz-review-step-number">1</span><div><h3>清空收件箱</h3><p>补充类型和状态，或确认暂时放到“将来”。</p></div><em>{inboxItems.length === 0 ? "已就绪" : `${inboxItems.length} 项`}</em></header>
                        {#if inboxItems.length > 0}<div class="xz-review-item-list">{#each inboxItems as item (item.id)}<button type="button" data-work-item-id={item.id} on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{item.type || "未分类"} · 收件箱</span></button>{/each}</div>{/if}
                    </section>

                    <section class:xz-review-step--warning={reviewActiveProjects.length > 3} class:xz-review-step--ready={reviewActiveProjects.length > 0 && reviewActiveProjects.length <= 3} class="xz-review-step">
                        <header><span class="xz-review-step-number">2</span><div><h3>确认当前投入方向</h3><p>活跃顶层项目原则上不超过 2–3 个；长期领域不计入数量。</p></div><em>{reviewActiveProjects.length > 3 ? "需要收敛" : reviewActiveProjects.length === 0 ? "尚未选择" : "数量合适"}</em></header>
                        {#if reviewActiveProjects.length > 0}<div class="xz-review-item-list">{#each reviewActiveProjects as item (item.id)}<button type="button" data-work-item-id={item.id} on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{displayStatus(item.status)}</span></button>{/each}</div>{/if}
                    </section>

                    <section class:xz-review-step--ready={reviewDateItems.length === 0} class="xz-review-step">
                        <header><span class="xz-review-step-number">3</span><div><h3>处理遗留日期</h3><p>先重新安排已经过去的计划日期，并确认逾期事项是否仍然有效。</p></div><em>{reviewDateItems.length === 0 ? "已就绪" : `${reviewDateItems.length} 项`}</em></header>
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
        <main class="xz-state"><span class="xz-spinner"></span><p>正在读取个人项目数据库……</p></main>
    {:else if error}
        <main class="xz-state xz-error">
            <h2>暂时无法读取数据库</h2><p>{error}</p>
            <button class="b3-button" type="button" on:click={() => void refresh()}>重试</button>
        </main>
    {:else if data}
        <div class="xz-secondary-bar">
            <div class="xz-segmented">
                {#each itemFilters as entry}
                    <button class:active={filter === entry.id} type="button" on:click={() => setFilter(entry.id)}>{entry.label}</button>
                {/each}
            </div>
            <div class="xz-secondary-actions">
                {#if filter === "active"}
                    <button class="xz-link-button" type="button" on:click={expandActivePaths}>展开活跃路径</button>
                {:else}
                    <button class="xz-link-button" type="button" on:click={expandAllVisible}>全部展开</button>
                {/if}
                <button class="xz-link-button" type="button" on:click={collapseAll}>全部收起</button>
                <button class="xz-link-button" type="button" on:click={() => void openDatabase()}>打开原始数据库</button>
            </div>
        </div>

        {#if data.missingFields.includes("本次行动细则")}
            <div class="xz-notice"><strong>兼容提示：</strong>当前数据库尚无“本次行动细则”字段，详情页会先显示占位内容；插件不会自动新增字段。</div>
        {/if}
        {#if tree.issues.length > 0}
            <div class="xz-notice xz-notice--warning"><strong>关系检查：</strong>发现 {tree.issues.length} 个需要人工确认的层级关系问题。插件只提示，不会自动修正。</div>
        {/if}

        <main class="xz-workspace">
            <aside class="xz-sidebar">
                <section class="xz-sidebar-group xz-sidebar-group--areas">
                    <h2><span>长期领域与想法</span><small>{areaAndIdeaRoots.length}</small></h2>
                    {#if areaAndIdeaRoots.length === 0}<p class="xz-sidebar-empty">暂无内容</p>{/if}
                    {#each areaAndIdeaRoots as item (item.id)}
                        <button class:active={scope === item.id} class="xz-scope-button" type="button" data-work-item-id={item.id} on:click={() => { scope = item.id; selectedId = item.id; }}>
                            <span>{item.title}</span><small>{item.status || "未设置"}</small>
                        </button>
                    {/each}
                </section>
                <section class="xz-sidebar-group xz-sidebar-group--projects">
                    <h2><span>顶层项目</span><small>{topLevelProjects.length}</small></h2>
                    {#if topLevelProjects.length === 0}<p class="xz-sidebar-empty">暂无内容</p>{/if}
                    {#each topLevelProjects as item (item.id)}
                        <button class:active={scope === item.id} class="xz-scope-button" type="button" data-work-item-id={item.id} on:click={() => { scope = item.id; selectedId = item.id; }}>
                            <span>{item.title}</span><small>{item.status || "未设置"}</small>
                        </button>
                    {/each}
                </section>
                <section class="xz-sidebar-group xz-sidebar-group--transactions">
                    <h2><span>独立事务</span><small>{independentTransactions.length}</small></h2>
                    {#if independentTransactions.length === 0}<p class="xz-sidebar-empty">暂无内容</p>{/if}
                    {#each independentTransactions as item (item.id)}
                        <button class:active={scope === item.id} class="xz-scope-button" type="button" data-work-item-id={item.id} on:click={() => { scope = item.id; selectedId = item.id; }}>
                            <span>{item.title}</span><small>{item.status || "未设置"}</small>
                        </button>
                    {/each}
                </section>
                {#if uncategorizedRoots.length > 0}
                    <section class="xz-sidebar-group xz-sidebar-group--uncategorized">
                        <h2><span>待归类</span><small>{uncategorizedRoots.length}</small></h2>
                        {#each uncategorizedRoots as item (item.id)}
                            <button class:active={scope === item.id} class="xz-scope-button" type="button" data-work-item-id={item.id} on:click={() => { scope = item.id; selectedId = item.id; }}>
                                <span>{item.title}</span><small>{item.type || "未分类"}</small>
                            </button>
                        {/each}
                    </section>
                {/if}
                <footer>{data.attributeViewName}<br><span>{data.items.length} 个工作项</span></footer>
            </aside>

            <section class="xz-tree-panel">
                <div class="xz-panel-heading"><div><span>层级浏览</span><small>{filter === "active" ? "只展开活跃路径" : "当前筛选默认完整展开"}</small></div></div>
                <div class="xz-tree-scroll">
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
                                on:select={(event) => selectedId = event.detail.id}
                                on:toggle={(event) => toggle(event.detail.id)}
                            />
                        {/each}
                    {/if}
                </div>
            </section>

            <aside class="xz-detail">
                {#if selected}
                    <div class="xz-detail-header">
                        <div class="xz-detail-identity">
                            <div class="xz-detail-role-row">
                                {#if selectedProfile}<span class="xz-detail-role">{selectedProfile.label}</span>{/if}
                                {#if canAddChild(selected)}
                                    <button class="xz-add-child-button" type="button" on:click={() => void openQuickCapture(selected)}>
                                        ＋ {selected.type === "长期领域" ? "添加顶层项目" : "添加下级"}
                                    </button>
                                {/if}
                            </div>
                            <div class="xz-detail-title-row" data-work-item-id={selected.id}>
                                <input class="xz-inline-title" aria-label="名称" bind:value={detailDraft.title} disabled={Boolean(savingInline)} on:blur={() => void saveInline("title", detailDraft.title)} on:keydown={(event) => event.key === "Enter" && event.currentTarget.blur()} />
                                {#if selectedProfile?.showComplete && !isClosed(selected)}
                                    <button class="b3-button xz-complete-button" type="button" disabled={Boolean(savingInline)} on:click={() => void saveInline("status", "已完成")}>
                                        ✓ 完成
                                    </button>
                                {/if}
                            </div>
                        </div>
                    </div>

                    <div class="xz-meta-grid xz-meta-grid--editable">
                        <label><span>工作项类型</span><select class="b3-select xz-meta-type-select" aria-label="工作项类型" bind:value={detailDraft.type} disabled={Boolean(savingInline)} on:change={() => void saveInline("type", detailDraft.type)}><option value="">未分类</option>{#each data.fields.type?.options ?? [] as option}<option value={option.name}>{option.name}</option>{/each}</select></label>
                        <label><span>{selectedProfile?.statusLabel ?? "状态"}</span><select class="b3-select xz-meta-status-select" aria-label={selectedProfile?.statusLabel ?? "状态"} bind:value={detailDraft.status} disabled={Boolean(savingInline)} on:change={() => void saveInline("status", detailDraft.status)}><option value="">未设置</option>{#if detailDraft.status && !selectedProfile?.statuses.includes(detailDraft.status)}<option value={detailDraft.status}>{detailDraft.status}{legacyStatuses.has(detailDraft.status) ? "（旧状态）" : "（当前值）"}</option>{/if}{#each selectedProfile?.statuses ?? [] as status}<option value={status}>{status}</option>{/each}</select></label>
                        {#if selectedProfile?.showParent}
                            <label><span>{selectedProfile.parentLabel}</span><select class="b3-select" bind:value={detailDraft.parent} disabled={Boolean(savingInline)} on:change={() => void saveInline("parent", detailDraft.parent)}><option value="">—</option>{#each parentCandidates as item}<option value={item.id}>{item.title}</option>{/each}</select></label>
                        {/if}
                        {#if selectedProfile?.showTopProject}
                            <div class="xz-meta-readonly-field"><span>所属顶层项目</span><strong>{topProject?.title ?? "尚未形成顶层项目链"}</strong></div>
                        {/if}
                        {#if selectedProfile?.showPlanDate}
                            <label><span>计划日期 {#if isToday(selected.planDate) && !isClosed(selected)}<em class="xz-date-hint xz-date-hint--today">今日</em>{/if}</span><input class="b3-text-field" type="date" bind:value={detailDraft.planDate} disabled={Boolean(savingInline)} on:change={() => void saveInline("planDate", detailDraft.planDate)} /></label>
                        {/if}
                        {#if selectedProfile?.showDeadline}
                            <label class="xz-deadline-field"><span>截止日期 {#if isOverdue(selected)}<em class="xz-date-hint xz-date-hint--overdue">已逾期</em>{:else if detailDraft.deadlineMode === "pending"}<em class="xz-date-hint xz-date-hint--pending">待确认</em>{/if}</span><div class="xz-deadline-control"><select class="b3-select" aria-label="截止日期设置" bind:value={detailDraft.deadlineMode} disabled={Boolean(savingInline)} on:change={() => void saveDeadlineMode(detailDraft.deadlineMode)}><option value="pending">待确认</option><option value="none" disabled={!data.fields.noDeadline}>无</option><option value="date">具体日期</option></select>{#if detailDraft.deadlineMode === "date"}<input class="b3-text-field" aria-label="具体截止日期" type="date" bind:value={detailDraft.deadline} disabled={Boolean(savingInline)} on:change={() => void saveDeadlineDate(detailDraft.deadline)} />{/if}</div></label>
                        {/if}
                        {#if selectedProfile?.showExecutionCost}
                            <label><span>预计时长（分钟）</span><input class="b3-text-field" type="number" min="0" step="1" bind:value={detailDraft.duration} disabled={Boolean(savingInline)} on:change={() => void saveInline("duration", detailDraft.duration)} /></label>
                            <label><span>所需精力</span><select class="b3-select" bind:value={detailDraft.energy} disabled={Boolean(savingInline)} on:change={() => void saveInline("energy", detailDraft.energy)}><option value="">—</option>{#each data.fields.energy?.options ?? [] as option}<option value={option.name}>{option.name}</option>{/each}</select></label>
                        {/if}
                    </div>
                    {#if selectedProfile?.showDeadline && !data.fields.noDeadline}<p class="xz-missing-field"><strong>缺少“无截止日期”字段</strong><span>目前仍可设置具体日期；新增复选框字段后，才能把“无”和“待确认”区分开。</span></p>{/if}
                    {#if savingInline}<p class="xz-inline-feedback">正在保存并复核……</p>{/if}
                    {#if inlineError}<p class="xz-save-error" role="alert">{inlineError}</p>{/if}

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
                                <textarea use:focusOnMount class="b3-text-field xz-action-editor" rows="6" aria-label={fieldLabel(selected)} bind:value={detailDraft.currentAction} disabled={savingAction === "currentAction"} on:click|stopPropagation on:blur={() => void saveAction("currentAction")} on:keydown={(event) => handleActionKeydown(event, "currentAction")}></textarea>
                            {:else}
                                <p>{selected.currentAction || "尚未填写。"}</p>
                            {/if}
                            {#if actionErrors.currentAction}<p class="xz-action-error" role="alert">{actionErrors.currentAction}</p>{/if}
                        </section>
                    {:else}
                        <section class="xz-action-card xz-action-card--primary xz-action-card--missing">
                            <header><h3>{fieldLabel(selected)}</h3></header>
                            <p>当前数据库尚无此字段；插件不会擅自新增字段。</p>
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
                                <textarea use:focusOnMount class="b3-text-field xz-action-editor" rows="4" aria-label="下一步行动" bind:value={detailDraft.nextAction} disabled={savingAction === "nextAction"} on:click|stopPropagation on:blur={() => void saveAction("nextAction")} on:keydown={(event) => handleActionKeydown(event, "nextAction")}></textarea>
                            {:else}
                                <p>{selected.nextAction || "尚未填写明确的下一步行动。"}</p>
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
                        <p class="xz-detached-note">这是数据库独立条目，不需要建立或关联文档。</p>
                    {/if}
                    <p class="xz-detail-note">点击行动卡片可直接编辑；失焦自动保存，Esc 取消。修改会写入思源属性视图并重新读取复核。</p>
                {:else}
                    <div class="xz-empty"><p>选择一个工作项查看详情。</p></div>
                {/if}
            </aside>
        </main>
    {/if}

    {#if quickCaptureOpen}
        <div class="xz-dialog-backdrop" role="presentation" on:click|self={closeQuickCapture}>
            <section class="xz-quick-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="xz-quick-capture-title">
                <span class="xz-section-kicker">{quickCaptureParent ? "上下文新建" : "快速记录"}</span>
                <h2 id="xz-quick-capture-title">{quickCaptureParent ? `添加到“${quickCaptureParent.title}”` : "记到收件箱"}</h2>
                <p>{quickCaptureParent ? "上层工作项已经自动带入；新条目仍从收件箱状态开始，之后可以继续整理。" : "这里只需要一个名称；类型、层级和日期可以稍后再补。"}</p>
                <form on:submit|preventDefault={() => void submitQuickCapture()}>
                    <label for="xz-quick-capture-input">名称</label>
                    <input id="xz-quick-capture-input" class="b3-text-field" type="text" bind:value={quickCaptureTitle} autocomplete="off" disabled={capturing} placeholder="现在想到什么？" />
                    {#if quickCaptureParent}
                        <label for="xz-quick-capture-type">工作项类型</label>
                        <select id="xz-quick-capture-type" class="b3-select" bind:value={quickCaptureType} disabled={capturing}>
                            <option value="项目">项目</option>
                            <option value="任务">任务</option>
                            <option value="事务">事务</option>
                            <option value="想法">想法</option>
                        </select>
                        <div class="xz-quick-capture-parent"><span>上层工作项</span><strong>{quickCaptureParent.title}</strong></div>
                    {/if}
                    {#if quickCaptureError}<p class="xz-save-error" role="alert">{quickCaptureError}</p>{/if}
                    <div class="xz-delete-actions">
                        <button class="b3-button b3-button--outline" type="button" disabled={capturing} on:click={closeQuickCapture}>取消</button>
                        <button class="b3-button" type="submit" disabled={capturing || !quickCaptureTitle.trim()}>{capturing ? "正在保存并复核…" : quickCaptureParent ? "创建下级" : "加入收件箱"}</button>
                    </div>
                </form>
                <small>快捷键：⌘/Ctrl + Shift + I</small>
            </section>
        </div>
    {/if}

    {#if deleteTarget}
        <div class="xz-dialog-backdrop" role="presentation" on:click|self={() => { if (!deleting) { deleteTarget = null; deleteError = ""; } }}>
            <section class="xz-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="xz-delete-title">
                <span class="xz-section-kicker">不可撤销的数据库操作</span>
                <h2 id="xz-delete-title">删除“{deleteTarget.title}”？</h2>
                <p>这个工作项将从“行舟”绑定的思源属性视图中移除。</p>
                {#if deleteTarget.documentId}
                    <p class="xz-delete-note">关联的思源文档不会被删除，只会解除它与当前数据库的绑定。</p>
                {:else}
                    <p class="xz-delete-note">这是数据库独立条目；删除后，其名称和属性不会保留在当前数据库中。</p>
                {/if}
                {#if deleteDescendantCount > 0}
                    <p class="xz-delete-warning">检测到 {deleteDescendantCount} 个下级工作项。它们不会被级联删除，但会暂时保留指向已删除父项的关系，需要之后重新整理。</p>
                {/if}
                {#if deleteTopReferenceCount > 0}
                    <p class="xz-delete-warning">另有 {deleteTopReferenceCount} 个工作项把它设为所属顶层项目；这些引用不会自动改写。</p>
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
