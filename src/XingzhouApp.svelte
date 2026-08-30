<script lang="ts">
    import { onMount } from "svelte";
    import TreeNode from "./TreeNode.svelte";
    import { buildWorkItemTree, collectDescendantIds, hasActiveDescendant, isActive, isClosed, type WorkItemTree } from "./tree";
    import type { WorkItem, WorkItemChanges, WorkItemData } from "./work-items";

    export let load: () => Promise<WorkItemData>;
    export let captureInbox: (title: string) => Promise<WorkItemData>;
    export let saveItem: (data: WorkItemData, item: WorkItem, changes: WorkItemChanges) => Promise<WorkItemData>;
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
        { id: "future", label: "将来／也许" },
        { id: "closed", label: "已结束" },
    ];
    const statusOptions = [
        "收件箱", "待开始", "已计划", "进行中", "阻塞", "暂停", "将来", "已完成", "已失败", "已取消", "已放弃",
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
    let scope: "all" | "independent" | string = "all";
    let expandedIds = new Set<string>();
    let inboxDraft = "";
    let capturing = false;
    let captureError = "";
    let captureMessage = "";
    let weekStart = startOfWeek(Date.now());
    let weekSavingIds = new Set<string>();
    let weekError = "";
    let editingAction: ActionField | null = null;
    let savingAction: ActionField | null = null;
    let savingInline: string | null = null;
    let actionErrors: Record<ActionField, string> = { currentAction: "", nextAction: "" };
    let inlineError = "";
    let draftSourceId: string | null = null;
    let detailDraft = emptyDetailDraft();

    $: selected = selectedId ? tree.byId.get(selectedId) ?? null : null;
    $: domains = data?.items.filter((item) => item.type === "长期领域") ?? [];
    $: independentRoots = tree.roots.filter((item) => item.type !== "长期领域");
    $: {
        data; scope; filter; tree; independentRoots;
        visibleIds = getVisibleIds();
    }
    $: {
        scope; tree; independentRoots; visibleIds;
        visibleRoots = getVisibleRoots();
    }
    $: parent = selected?.parentIds[0] ? tree.byId.get(selected.parentIds[0]) ?? null : null;
    $: topProject = selected?.topProjectIds[0] ? tree.byId.get(selected.topProjectIds[0]) ?? null : null;
    $: parentCandidates = selected
        ? (data?.items ?? []).filter((item) => item.id !== selected.id && !collectDescendantIds(selected.id, tree).has(item.id))
        : [];
    $: topProjectCandidates = (data?.items ?? []).filter((item) => item.type === "项目");
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
        expandedIds = new Set(nextData.items.filter((item) => hasActiveDescendant(item.id, tree)).map((item) => item.id));
        loading = false;
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

    function emptyDetailDraft() {
        return { title: "", type: "", status: "", parent: "", topProject: "", planDate: "", deadline: "", duration: "", energy: "", currentAction: "", nextAction: "" };
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
            if (!item.planDate || item.planDate < start || item.planDate >= end.getTime()) continue;
            const key = formatInputDate(item.planDate);
            const existing = result.get(key) ?? [];
            existing.push(item);
            result.set(key, existing);
        }
        for (const dayItems of result.values()) {
            dayItems.sort((a, b) => Number(isClosed(a)) - Number(isClosed(b)) || a.title.localeCompare(b.title, "zh-CN"));
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
            .filter((item) => !isClosed(item) && !excludedStatuses.has(item.status) && (isOverdue(item) || Boolean(item.planDate && item.planDate < todayStart.getTime())))
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
        return `计划日期已过 · ${formatDate(item.planDate)}`;
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
        if (scope === "independent") {
            const ids = new Set<string>();
            for (const root of independentRoots) for (const id of collectDescendantIds(root.id, tree)) ids.add(id);
            candidates = data.items.filter((item) => ids.has(item.id));
        } else if (scope !== "all") {
            const ids = collectDescendantIds(scope, tree);
            candidates = data.items.filter((item) => ids.has(item.id));
        }

        const matched = candidates.filter((item) => {
            if (filter === "active") return item.type === "项目" && isActive(item);
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
        if (scope === "independent") return independentRoots.filter((item) => visibleIds.has(item.id));
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
        if (item.type === "长期领域") return "领域说明／当前关注方向";
        if (item.type === "项目") return "当前阶段目标";
        if (item.type === "想法") return "想法说明";
        return "本次行动细则";
    }
</script>

<div class="xz-app">
    <header class="xz-header">
        <div>
            <div class="xz-eyebrow">个人项目与事务中心</div>
            <h1>行舟</h1>
        </div>
        <div class="xz-header-actions">
            <span class="xz-data-source">本地数据库</span>
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
                            <article class="xz-inbox-item">
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
                                            <article class:xz-week-item--closed={isClosed(item)} class="xz-week-item">
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
                                            <article class="xz-week-backlog-item xz-week-backlog-item--window">
                                                <button type="button" on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{item.type} · 截止 {item.deadline ? formatInputDate(item.deadline) : "—"}</span></button>
                                            </article>
                                        {/each}
                                    </section>
                                {/if}
                                {#if unscheduledWeekItems.length > 0}
                                    <section class="xz-week-backlog-group">
                                        <h4><span>尚未选择日期</span><em>{unscheduledWeekItems.length} 项</em></h4>
                                        {#each unscheduledWeekItems as item (item.id)}
                                            <article class="xz-week-backlog-item">
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
                        {#if inboxItems.length > 0}<div class="xz-review-item-list">{#each inboxItems as item (item.id)}<button type="button" on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{item.type || "未分类"} · 收件箱</span></button>{/each}</div>{/if}
                    </section>

                    <section class:xz-review-step--warning={reviewActiveProjects.length > 3} class:xz-review-step--ready={reviewActiveProjects.length > 0 && reviewActiveProjects.length <= 3} class="xz-review-step">
                        <header><span class="xz-review-step-number">2</span><div><h3>确认当前投入方向</h3><p>活跃顶层项目原则上不超过 2–3 个；长期领域不计入数量。</p></div><em>{reviewActiveProjects.length > 3 ? "需要收敛" : reviewActiveProjects.length === 0 ? "尚未选择" : "数量合适"}</em></header>
                        {#if reviewActiveProjects.length > 0}<div class="xz-review-item-list">{#each reviewActiveProjects as item (item.id)}<button type="button" on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{displayStatus(item.status)}</span></button>{/each}</div>{/if}
                    </section>

                    <section class:xz-review-step--ready={reviewDateItems.length === 0} class="xz-review-step">
                        <header><span class="xz-review-step-number">3</span><div><h3>处理遗留日期</h3><p>先重新安排已经过去的计划日期，并确认逾期事项是否仍然有效。</p></div><em>{reviewDateItems.length === 0 ? "已就绪" : `${reviewDateItems.length} 项`}</em></header>
                        {#if reviewDateItems.length > 0}<div class="xz-review-item-list">{#each reviewDateItems as item (item.id)}<button type="button" on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span class:xz-review-item-overdue={isOverdue(item)}>{reviewDateReason(item)}</span></button>{/each}</div>{/if}
                    </section>

                    <section class:xz-review-step--ready={reviewMissingActionItems.length === 0} class="xz-review-step">
                        <header><span class="xz-review-step-number">4</span><div><h3>让执行项可以直接开始</h3><p>日期有效后，再检查事务与想法是否写明本次行动细则。</p></div><em>{reviewMissingActionItems.length === 0 ? "已就绪" : `${reviewMissingActionItems.length} 项`}</em></header>
                        {#if reviewMissingActionItems.length > 0}<div class="xz-review-item-list">{#each reviewMissingActionItems as item (item.id)}<button type="button" on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{item.type} · {displayStatus(item.status)}</span></button>{/each}</div>{/if}
                    </section>

                    <section class="xz-review-step xz-review-step--reflection">
                        <header><span class="xz-review-step-number">5</span><div><h3>看一眼本周留下了什么</h3><p>这里只用于获得反馈，不评价推进速度；缓慢推进也是正常推进。</p></div><em>{reviewCompletedThisWeek.length} 项</em></header>
                        {#if reviewCompletedThisWeek.length > 0}<div class="xz-review-item-list">{#each reviewCompletedThisWeek as item (item.id)}<button type="button" on:click={() => revealInboxItem(item)}><strong>{item.title}</strong><span>{displayStatus(item.status)} · {formatDate(item.updatedAt)}</span></button>{/each}</div>{:else}<p class="xz-review-empty-note">本周还没有已结束条目，这不代表没有发生有效推进。</p>{/if}
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
                    <button class:active={filter === entry.id} type="button" on:click={() => filter = entry.id}>{entry.label}</button>
                {/each}
            </div>
            <div class="xz-secondary-actions">
                <button class="xz-link-button" type="button" on:click={expandActivePaths}>仅展开活跃路径</button>
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
                <section>
                    <h2>长期领域</h2>
                    <button class:active={scope === "all"} class="xz-scope-button" type="button" on:click={() => scope = "all"}>全部领域与工作项</button>
                    {#each domains as domain (domain.id)}
                        <button class:active={scope === domain.id} class="xz-scope-button" type="button" on:click={() => { scope = domain.id; selectedId = domain.id; }}>
                            <span>{domain.title}</span><small>{domain.status || "未设置"}</small>
                        </button>
                    {/each}
                </section>
                <section>
                    <h2>独立工作项</h2>
                    <button class:active={scope === "independent"} class="xz-scope-button" type="button" on:click={() => scope = "independent"}>
                        <span>全部</span><small>{independentRoots.length}</small>
                    </button>
                    {#each independentRoots as item (item.id)}
                        <button class:active={scope === item.id} class="xz-scope-button xz-scope-button--item" type="button" on:click={() => { scope = item.id; selectedId = item.id; }}>
                            <span>{item.title}</span><small>{item.status || "未设置"}</small>
                        </button>
                    {/each}
                </section>
                <footer>{data.attributeViewName}<br><span>{data.items.length} 个工作项</span></footer>
            </aside>

            <section class="xz-tree-panel">
                <div class="xz-panel-heading"><div><span>层级浏览</span><small>默认只展开活跃路径</small></div></div>
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
                            <div class="xz-detail-title-row">
                                <input class="xz-inline-title" aria-label="名称" bind:value={detailDraft.title} disabled={Boolean(savingInline)} on:blur={() => void saveInline("title", detailDraft.title)} on:keydown={(event) => event.key === "Enter" && event.currentTarget.blur()} />
                                {#if selected.status !== "已完成"}
                                    <button class="b3-button xz-complete-button" type="button" disabled={Boolean(savingInline)} on:click={() => void saveInline("status", "已完成")}>
                                        ✓ 完成
                                    </button>
                                {/if}
                            </div>
                        </div>
                    </div>

                    <div class="xz-meta-grid xz-meta-grid--editable">
                        <label><span>工作项类型</span><select class="b3-select xz-meta-type-select" aria-label="工作项类型" bind:value={detailDraft.type} disabled={Boolean(savingInline)} on:change={() => void saveInline("type", detailDraft.type)}><option value="">未分类</option>{#each data.fields.type?.options ?? [] as option}<option value={option.name}>{option.name}</option>{/each}</select></label>
                        <label><span>状态</span><select class="b3-select xz-meta-status-select" aria-label="状态" bind:value={detailDraft.status} disabled={Boolean(savingInline)} on:change={() => void saveInline("status", detailDraft.status)}><option value="">未设置</option>{#if legacyStatuses.has(detailDraft.status)}<option value={detailDraft.status}>{detailDraft.status}（旧状态）</option>{/if}{#each statusOptions as status}<option value={status}>{status}</option>{/each}</select></label>
                        <label><span>上层工作项</span><select class="b3-select" bind:value={detailDraft.parent} disabled={Boolean(savingInline)} on:change={() => void saveInline("parent", detailDraft.parent)}><option value="">—</option>{#each parentCandidates as item}<option value={item.id}>{item.title}</option>{/each}</select></label>
                        <label><span>所属顶层项目</span><select class="b3-select" bind:value={detailDraft.topProject} disabled={Boolean(savingInline)} on:change={() => void saveInline("topProject", detailDraft.topProject)}><option value="">—</option>{#each topProjectCandidates as item}<option value={item.id}>{item.title}</option>{/each}</select></label>
                        <label><span>计划日期 {#if isToday(selected.planDate) && !isClosed(selected)}<em class="xz-date-hint xz-date-hint--today">今日</em>{/if}</span><input class="b3-text-field" type="date" bind:value={detailDraft.planDate} disabled={Boolean(savingInline)} on:change={() => void saveInline("planDate", detailDraft.planDate)} /></label>
                        <label><span>截止日期 {#if isOverdue(selected)}<em class="xz-date-hint xz-date-hint--overdue">已逾期</em>{/if}</span><input class="b3-text-field" type="date" bind:value={detailDraft.deadline} disabled={Boolean(savingInline)} on:change={() => void saveInline("deadline", detailDraft.deadline)} /></label>
                        <label><span>预计时长（分钟）</span><input class="b3-text-field" type="number" min="0" step="1" bind:value={detailDraft.duration} disabled={Boolean(savingInline)} on:change={() => void saveInline("duration", detailDraft.duration)} /></label>
                        <label><span>所需精力</span><select class="b3-select" bind:value={detailDraft.energy} disabled={Boolean(savingInline)} on:change={() => void saveInline("energy", detailDraft.energy)}><option value="">—</option>{#each data.fields.energy?.options ?? [] as option}<option value={option.name}>{option.name}</option>{/each}</select></label>
                    </div>
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
</div>
