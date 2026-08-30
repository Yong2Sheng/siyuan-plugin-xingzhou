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
    let editing = false;
    let saving = false;
    let saveError = "";
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
    $: selectedIssues = selected ? tree.issues.filter((issue) => issue.itemId === selected.id) : [];
    $: inboxItems = [...(data?.items.filter((item) => item.status === "收件箱") ?? [])]
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    $: if (selected && selected.id !== draftSourceId && !saving) resetDetailDraft(selected);

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
        return { title: "", type: "", status: "", planDate: "", deadline: "", duration: "", energy: "", currentAction: "", nextAction: "" };
    }

    function resetDetailDraft(item: WorkItem) {
        detailDraft = {
            title: item.title,
            type: item.type,
            status: item.status,
            planDate: formatInputDate(item.planDate),
            deadline: formatInputDate(item.deadline),
            duration: item.durationMinutes === null ? "" : String(item.durationMinutes),
            energy: item.energy,
            currentAction: item.currentAction,
            nextAction: item.nextAction,
        };
        draftSourceId = item.id;
        editing = false;
        saveError = "";
    }

    function startEditing() {
        if (!selected) return;
        resetDetailDraft(selected);
        editing = true;
    }

    async function submitDetail() {
        if (!data || !selected || saving) return;
        if (!detailDraft.title.trim()) {
            saveError = "名称不能为空。";
            return;
        }
        const changes: WorkItemChanges = {};
        if (detailDraft.title.trim() !== selected.title) changes.title = detailDraft.title.trim();
        if (detailDraft.type !== selected.type) changes.type = detailDraft.type;
        if (detailDraft.status !== selected.status) changes.status = detailDraft.status;
        if (detailDraft.planDate !== formatInputDate(selected.planDate)) changes.planDate = detailDraft.planDate || null;
        if (detailDraft.deadline !== formatInputDate(selected.deadline)) changes.deadline = detailDraft.deadline || null;
        if (detailDraft.duration !== (selected.durationMinutes === null ? "" : String(selected.durationMinutes))) {
            changes.duration = detailDraft.duration === "" ? null : Number(detailDraft.duration);
        }
        if (detailDraft.energy !== selected.energy) changes.energy = detailDraft.energy;
        if (data.fields.currentAction && detailDraft.currentAction !== selected.currentAction) changes.currentAction = detailDraft.currentAction;
        if (detailDraft.nextAction !== selected.nextAction) changes.nextAction = detailDraft.nextAction;

        // 计划日期只决定“已计划”，不会根据时间流逝把条目伪装成已经开始。
        const statusWasEdited = detailDraft.status !== selected.status;
        const planDateWasEdited = detailDraft.planDate !== formatInputDate(selected.planDate);
        if (!statusWasEdited && planDateWasEdited) {
            if (detailDraft.planDate && (selected.status === "收件箱" || selected.status === "待开始")) changes.status = "已计划";
            if (!detailDraft.planDate && selected.status === "已计划") changes.status = "待开始";
        }
        if (Object.keys(changes).length === 0) {
            editing = false;
            return;
        }

        saving = true;
        saveError = "";
        try {
            const selectedRowId = selected.rowId;
            applyData(await saveItem(data, selected, changes));
            const updated = data?.items.find((item) => item.rowId === selectedRowId);
            if (updated) {
                selectedId = updated.id;
                resetDetailDraft(updated);
            }
            editing = false;
        } catch (caught) {
            saveError = caught instanceof Error ? caught.message : String(caught);
        } finally {
            saving = false;
        }
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
    {:else if page !== "all"}
        <main class="xz-coming-soon">
            <div class="xz-empty-icon">舟</div>
            <h2>{page === "week" ? "本周安排" : "周度整理"}</h2>
            <p>这个页面仍在规划中。</p>
            <button class="b3-button" type="button" on:click={() => page = "all"}>返回全部</button>
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
                        <div><span class="xz-tag xz-tag--type">{selected.type || "未分类"}</span><h2>{selected.title}</h2></div>
                        <div class="xz-detail-header-actions">
                            <span class="xz-tag" data-status={displayStatus(selected.status)} title={legacyStatuses.has(selected.status) ? `数据库旧状态：${selected.status}` : undefined}>{displayStatus(selected.status) || "未设置状态"}</span>
                            {#if isOverdue(selected)}<span class="xz-tag xz-tag--overdue">已逾期</span>{:else if isToday(selected.planDate) && !isClosed(selected)}<span class="xz-tag xz-tag--today">今日计划</span>{/if}
                            {#if !editing}<button class="b3-button b3-button--outline" type="button" on:click={startEditing}>编辑</button>{/if}
                        </div>
                    </div>
                    {#if editing}
                        <form class="xz-detail-form" on:submit|preventDefault={() => void submitDetail()}>
                            <label class="xz-field xz-field--wide"><span>名称</span><input class="b3-text-field" bind:value={detailDraft.title} disabled={saving} /></label>
                            <div class="xz-form-grid">
                                <label class="xz-field"><span>工作项类型</span><select class="b3-select" bind:value={detailDraft.type} disabled={saving}><option value="">未分类</option>{#each data.fields.type?.options ?? [] as option}<option value={option.name}>{option.name}</option>{/each}</select></label>
                                <label class="xz-field"><span>状态</span><select class="b3-select" bind:value={detailDraft.status} disabled={saving}>
                                    <option value="">未设置</option>
                                    {#if legacyStatuses.has(detailDraft.status)}<option value={detailDraft.status}>{detailDraft.status}（旧状态）</option>{/if}
                                    {#each statusOptions as status}<option value={status}>{status}</option>{/each}
                                </select></label>
                                <label class="xz-field"><span>计划日期</span><input class="b3-text-field" type="date" bind:value={detailDraft.planDate} disabled={saving} /></label>
                                <label class="xz-field"><span>截止日期</span><input class="b3-text-field" type="date" bind:value={detailDraft.deadline} disabled={saving} /></label>
                                <label class="xz-field"><span>预计时长（分钟）</span><input class="b3-text-field" type="number" min="0" step="1" bind:value={detailDraft.duration} disabled={saving} /></label>
                                <label class="xz-field"><span>所需精力</span><select class="b3-select" bind:value={detailDraft.energy} disabled={saving}><option value="">未设置</option>{#each data.fields.energy?.options ?? [] as option}<option value={option.name}>{option.name}</option>{/each}</select></label>
                            </div>
                            {#if data.fields.currentAction}
                                <label class="xz-field xz-field--wide"><span>{fieldLabel(selected)}</span><textarea class="b3-text-field" rows="6" bind:value={detailDraft.currentAction} disabled={saving}></textarea></label>
                            {:else}
                                <div class="xz-missing-field"><strong>{fieldLabel(selected)}</strong><span>当前数据库尚无“本次行动细则”字段；代码已经支持，待数据库迁移后即可直接编辑。</span></div>
                            {/if}
                            <label class="xz-field xz-field--wide"><span>下一步行动</span><textarea class="b3-text-field" rows="4" bind:value={detailDraft.nextAction} disabled={saving}></textarea></label>
                            <div class="xz-readonly-relations">
                                <span>上层工作项：{parent?.title || "—"}</span><span>所属顶层项目：{topProject?.title || "—"}</span>
                            </div>
                            {#if saveError}<p class="xz-save-error" role="alert">{saveError}</p>{/if}
                            <div class="xz-form-actions">
                                <button class="b3-button b3-button--cancel" type="button" disabled={saving} on:click={() => resetDetailDraft(selected)}>取消</button>
                                <button class="b3-button" type="submit" disabled={saving}>{saving ? "正在保存并复核…" : "保存到数据库"}</button>
                            </div>
                        </form>
                    {:else}
                        <dl class="xz-meta-grid">
                            <div><dt>上层工作项</dt><dd>{parent?.title || "—"}</dd></div>
                            <div><dt>所属顶层项目</dt><dd>{topProject?.title || "—"}</dd></div>
                            <div><dt>计划日期</dt><dd>{formatDate(selected.planDate)}</dd></div>
                            <div><dt>截止日期</dt><dd>{formatDate(selected.deadline)}</dd></div>
                            <div><dt>预计时长</dt><dd>{selected.durationMinutes === null ? "—" : `${selected.durationMinutes} 分钟`}</dd></div>
                            <div><dt>所需精力</dt><dd>{selected.energy || "—"}</dd></div>
                        </dl>

                        <section class="xz-action-card xz-action-card--primary">
                            <h3>{fieldLabel(selected)}</h3>
                            <p>{selected.currentAction || (data.fields.currentAction ? "尚未填写。" : "当前数据库尚无此字段；插件不会擅自新增字段。")}</p>
                        </section>
                        <section class="xz-action-card">
                            <h3>下一步行动</h3>
                            <p>{selected.nextAction || "尚未填写明确的下一步行动。"}</p>
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
                    <p class="xz-detail-note">修改会直接写入思源属性视图，并在保存后重新读取复核。</p>
                {:else}
                    <div class="xz-empty"><p>选择一个工作项查看详情。</p></div>
                {/if}
            </aside>
        </main>
    {/if}
</div>
