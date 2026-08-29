<script lang="ts">
    import { onMount } from "svelte";
    import TreeNode from "./TreeNode.svelte";
    import { buildWorkItemTree, collectDescendantIds, hasActiveDescendant, isActive, isClosed, type WorkItemTree } from "./tree";
    import type { WorkItem, WorkItemData } from "./work-items";

    export let load: () => Promise<WorkItemData>;
    export let openDocument: (blockId: string) => Promise<void>;
    export let openDatabase: () => Promise<void>;

    type MainPage = "week" | "all" | "inbox" | "review";
    type ItemFilter = "all" | "active" | "future" | "closed";

    const mainPages: Array<{ id: MainPage; label: string }> = [
        { id: "week", label: "本周" },
        { id: "all", label: "全部工作项" },
        { id: "inbox", label: "收件箱" },
        { id: "review", label: "整理" },
    ];
    const itemFilters: Array<{ id: ItemFilter; label: string }> = [
        { id: "all", label: "全部" },
        { id: "active", label: "活跃项目" },
        { id: "future", label: "将来／也许" },
        { id: "closed", label: "已结束" },
    ];

    let page: MainPage = "all";
    let filter: ItemFilter = "all";
    let data: WorkItemData | null = null;
    let tree: WorkItemTree = buildWorkItemTree([]);
    let loading = true;
    let error = "";
    let selectedId: string | null = null;
    let scope: "all" | "independent" | string = "all";
    let expandedIds = new Set<string>();

    $: selected = selectedId ? tree.byId.get(selectedId) ?? null : null;
    $: domains = data?.items.filter((item) => item.type === "长期领域") ?? [];
    $: independentRoots = tree.roots.filter((item) => item.type !== "长期领域");
    $: visibleIds = getVisibleIds();
    $: visibleRoots = getVisibleRoots();
    $: parent = selected?.parentIds[0] ? tree.byId.get(selected.parentIds[0]) ?? null : null;
    $: topProject = selected?.topProjectIds[0] ? tree.byId.get(selected.topProjectIds[0]) ?? null : null;
    $: selectedIssues = selected ? tree.issues.filter((issue) => issue.itemId === selected.id) : [];

    onMount(() => { void refresh(); });

    async function refresh() {
        loading = true;
        error = "";
        try {
            data = await load();
            tree = buildWorkItemTree(data.items);
            selectedId = selectedId && tree.byId.has(selectedId) ? selectedId : data.items[0]?.id ?? null;
            expandedIds = new Set(data.items.filter((item) => hasActiveDescendant(item.id, tree)).map((item) => item.id));
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        } finally {
            loading = false;
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
            if (filter === "future") return item.status === "将来／也许" || item.status === "暂停";
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
            <span class="xz-readonly">只读预览</span>
            <button class="b3-button b3-button--outline" type="button" on:click={() => void refresh()} disabled={loading}>
                <svg><use href="#iconRefresh"></use></svg>{loading ? "读取中" : "刷新"}
            </button>
        </div>
    </header>

    <nav class="xz-main-nav" aria-label="主页面">
        {#each mainPages as entry}
            <button class:active={page === entry.id} type="button" on:click={() => page = entry.id}>
                {entry.label}{#if entry.id !== "all"}<span class="xz-soon">后续</span>{/if}
            </button>
        {/each}
    </nav>

    {#if page !== "all"}
        <main class="xz-coming-soon">
            <div class="xz-empty-icon">舟</div>
            <h2>{page === "week" ? "本周安排" : page === "inbox" ? "快速收件箱" : "周度整理"}</h2>
            <p>这个页面会在后续版本中接入。v0.1 先把“全部工作项”的读取、层级与详情体验做稳。</p>
            <button class="b3-button" type="button" on:click={() => page = "all"}>返回全部工作项</button>
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
                        <span>无上层领域／项目</span><small>{independentRoots.length}</small>
                    </button>
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
                        <span class="xz-tag" data-status={selected.status}>{selected.status || "未设置状态"}</span>
                    </div>
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
                        <p>{selected.currentAction || "尚未填写。这个字段会在后续数据库迭代中接入；v0.1 不会擅自创建或修改字段。"}</p>
                    </section>
                    <section class="xz-action-card">
                        <h3>下一步行动</h3>
                        <p>{selected.nextAction || "尚未填写明确的下一步行动。"}</p>
                    </section>

                    {#if selectedIssues.length > 0}
                        <section class="xz-issues"><h3>关系提示</h3>{#each selectedIssues as issue}<p>{issue.message}</p>{/each}</section>
                    {/if}

                    <button class="b3-button xz-open-document" type="button" disabled={!selected.documentId} on:click={() => selected?.documentId && void openDocument(selected.documentId)}>
                        <svg><use href="#iconOpen"></use></svg>{selected.documentId ? "打开关联文档" : "未关联文档"}
                    </button>
                    <p class="xz-detail-note">数据仍保存在思源属性视图中；当前版本只负责读取与浏览。</p>
                {:else}
                    <div class="xz-empty"><p>选择一个工作项查看详情。</p></div>
                {/if}
            </aside>
        </main>
    {/if}
</div>
