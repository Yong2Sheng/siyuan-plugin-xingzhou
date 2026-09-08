<script lang="ts">
    import { tick } from "svelte";
    import { prerequisiteIds } from "./dependencies";
    import {
        buildRelationshipGraph,
        graphStatusKind,
        type RelationshipGraphEdge,
        type RelationshipGraphNode,
        type RelationshipGraphStatusFilter,
    } from "./relationship-graph";
    import type { WorkItem } from "./work-items";

    export let items: WorkItem[] = [];
    export let selectedId: string | null = null;
    export let openItem: (item: WorkItem) => void = () => undefined;

    let statusFilter: RelationshipGraphStatusFilter = "all";
    let showTransactions = true;
    let showHierarchy = true;
    let showHard = true;
    let showSoft = true;
    let searchQuery = "";
    let zoom = 1;
    let highlightedId: string | null = null;
    let canvas: HTMLElement | null = null;
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragScrollLeft = 0;
    let dragScrollTop = 0;
    let dragMoved = false;
    let fittedLayoutSize = "";

    $: layout = buildRelationshipGraph(items, { showTransactions, statusFilter });
    $: nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
    $: selectedNode = (selectedId ? nodeById.get(selectedId) : null) ?? layout.nodes[0] ?? null;
    $: activeSelectedId = selectedNode?.id ?? null;
    $: selectedRelatedIds = relatedIds(highlightedId, layout.edges);
    $: visibleEdges = layout.edges.filter((edge) => edgeVisible(edge, showHierarchy, showHard, showSoft));
    $: dependencyLaneById = buildDependencyLanes(visibleEdges, nodeById);
    $: normalizedSearch = searchQuery.trim().toLocaleLowerCase("zh-CN");
    $: layoutSize = `${layout.width}:${layout.height}`;
    $: if (highlightedId && !nodeById.has(highlightedId)) highlightedId = null;
    $: if (layoutSize !== fittedLayoutSize) {
        fittedLayoutSize = layoutSize;
        void tick().then(fitGraph);
    }

    function edgeVisible(edge: RelationshipGraphEdge, hierarchy: boolean, hard: boolean, soft: boolean): boolean {
        if (edge.kind === "hierarchy") return hierarchy;
        if (edge.kind === "hard") return hard;
        return soft;
    }

    function edgePath(edge: RelationshipGraphEdge): string {
        const from = nodeById.get(edge.fromId);
        const to = nodeById.get(edge.toId);
        if (!from || !to) return "";
        if (isAdjacentDependency(edge, nodeById)) {
            const downward = from.y <= to.y;
            const x = from.x + from.width / 2;
            const startY = downward ? from.y + from.height : from.y;
            const endY = downward ? to.y : to.y + to.height;
            return `M ${x} ${startY} L ${x} ${endY}`;
        }
        if (edge.kind !== "hierarchy" && Math.abs(from.x - to.x) < 1) {
            const startX = from.x + from.width;
            const downward = from.y <= to.y;
            const startY = from.y + from.height * (downward ? 0.7 : 0.3);
            const endY = to.y + to.height * (downward ? 0.3 : 0.7);
            const routeX = startX + 58 + (dependencyLaneById.get(edge.id) ?? 0) * 28;
            return `M ${startX} ${startY} C ${routeX} ${startY}, ${routeX} ${endY}, ${startX} ${endY}`;
        }
        const forward = from.x <= to.x;
        const startX = forward ? from.x + from.width : from.x;
        const endX = forward ? to.x : to.x + to.width;
        const startY = from.y + from.height / 2;
        const endY = to.y + to.height / 2;
        const bend = Math.max(46, Math.abs(endX - startX) * 0.48);
        const direction = forward ? 1 : -1;
        return `M ${startX} ${startY} C ${startX + bend * direction} ${startY}, ${endX - bend * direction} ${endY}, ${endX} ${endY}`;
    }

    function edgeLabelPosition(edge: RelationshipGraphEdge): { x: number; y: number } {
        const from = nodeById.get(edge.fromId);
        const to = nodeById.get(edge.toId);
        if (!from || !to) return { x: 0, y: 0 };
        if (isAdjacentDependency(edge, nodeById)) {
            const downward = from.y <= to.y;
            const startY = downward ? from.y + from.height : from.y;
            const endY = downward ? to.y : to.y + to.height;
            return { x: from.x + from.width / 2, y: (startY + endY) / 2 };
        }
        if (edge.kind !== "hierarchy" && Math.abs(from.x - to.x) < 1) {
            return {
                x: from.x + from.width + 58 + (dependencyLaneById.get(edge.id) ?? 0) * 28,
                y: (from.y + from.height / 2 + to.y + to.height / 2) / 2,
            };
        }
        return {
            x: (from.x + from.width / 2 + to.x + to.width / 2) / 2,
            y: (from.y + from.height / 2 + to.y + to.height / 2) / 2 - 7,
        };
    }

    function isAdjacentDependency(edge: RelationshipGraphEdge, nodes: Map<string, RelationshipGraphNode>): boolean {
        if (edge.kind === "hierarchy") return false;
        const from = nodes.get(edge.fromId);
        const to = nodes.get(edge.toId);
        if (!from || !to || Math.abs(from.x - to.x) >= 1) return false;
        const verticalGap = Math.abs(to.y - from.y) - Math.max(from.height, to.height);
        return verticalGap >= 0 && verticalGap <= 44;
    }

    function buildDependencyLanes(edges: RelationshipGraphEdge[], nodes: Map<string, RelationshipGraphNode>): Map<string, number> {
        const candidates = edges
            .filter((edge) => {
                if (edge.kind === "hierarchy" || isAdjacentDependency(edge, nodes)) return false;
                const from = nodes.get(edge.fromId);
                const to = nodes.get(edge.toId);
                return Boolean(from && to && Math.abs(from.x - to.x) < 1);
            })
            .map((edge) => {
                const from = nodes.get(edge.fromId)!;
                const to = nodes.get(edge.toId)!;
                return { edge, start: Math.min(from.y, to.y), end: Math.max(from.y + from.height, to.y + to.height) };
            })
            .sort((left, right) => left.start - right.start || left.end - right.end);
        const laneEnds: number[] = [];
        const result = new Map<string, number>();
        for (const candidate of candidates) {
            let lane = laneEnds.findIndex((end) => end < candidate.start - 8);
            if (lane < 0) lane = laneEnds.length;
            laneEnds[lane] = candidate.end;
            result.set(candidate.edge.id, lane);
        }
        return result;
    }

    function abbreviatedTitle(title: string): string {
        const normalized = title.trim();
        return normalized.length > 5 ? `${normalized.slice(0, 5)}…` : normalized;
    }

    function edgeDescription(edge: RelationshipGraphEdge): string {
        const from = nodeById.get(edge.fromId)?.item.title ?? "前置项";
        const to = nodeById.get(edge.toId)?.item.title ?? "后续项";
        if (edge.kind === "hard") return `“${abbreviatedTitle(from)}”完成 → “${abbreviatedTitle(to)}”开始`;
        return `“${abbreviatedTitle(from)}”先行 → “${abbreviatedTitle(to)}”`;
    }

    function edgeLabelWidth(edge: RelationshipGraphEdge): number {
        return Math.min(196, edgeDescription(edge).length * 8.5 + 16);
    }

    function relatedIds(id: string | null, edges: RelationshipGraphEdge[]): Set<string> {
        if (!id) return new Set();
        const result = new Set([id]);
        for (const edge of edges) {
            if (edge.fromId === id) result.add(edge.toId);
            if (edge.toId === id) result.add(edge.fromId);
        }
        return result;
    }

    function isNodeDimmed(node: RelationshipGraphNode, currentId: string | null, related: Set<string>, query: string): boolean {
        if (query) return !node.item.title.toLocaleLowerCase("zh-CN").includes(query);
        return Boolean(currentId && !related.has(node.id));
    }

    function isEdgeDimmed(edge: RelationshipGraphEdge, currentId: string | null): boolean {
        return Boolean(currentId && edge.fromId !== currentId && edge.toId !== currentId);
    }

    function statusLabel(status: string): string {
        const kind = graphStatusKind(status);
        if (kind === "ongoing") return "进行中";
        if (kind === "pending") return "待开始";
        return status || "未设置";
    }

    function statusPillWidth(status: string): number {
        return Math.max(38, Math.min(58, statusLabel(status).length * 8 + 14));
    }

    function titleLines(title: string): string[] {
        const normalized = title.trim();
        if (normalized.length <= 14) return [normalized];
        const first = normalized.slice(0, 14);
        const second = normalized.slice(14, 27);
        return [first, second ? `${second}${normalized.length > 27 ? "…" : ""}` : ""];
    }

    function breadcrumb(item: WorkItem): string {
        const titles = [item.title];
        const seen = new Set([item.id]);
        let parentId = item.parentIds[0];
        while (parentId && !seen.has(parentId)) {
            seen.add(parentId);
            const parent = items.find((candidate) => candidate.id === parentId);
            if (!parent) break;
            titles.unshift(parent.title);
            parentId = parent.parentIds[0];
            if (parent.type === "长期领域") break;
        }
        return titles.join(" › ");
    }

    function resolveTitles(ids: string[]): string {
        const titles = ids.map((id) => items.find((item) => item.id === id)?.title).filter((title): title is string => Boolean(title));
        return titles.length ? titles.join("、") : "暂无";
    }

    function childTitles(itemId: string): string {
        return resolveTitles(items.filter((item) => item.parentIds[0] === itemId && !isClosedStatus(item.status)).map((item) => item.id));
    }

    function hardDependentTitles(itemId: string): string {
        return resolveTitles(items
            .filter((item) => prerequisiteIds(item, "hardPrerequisites").includes(itemId) && !isClosedStatus(item.status))
            .map((item) => item.id));
    }

    function softDependentTitles(itemId: string): string {
        return resolveTitles(items
            .filter((item) => prerequisiteIds(item, "softPrerequisites").includes(itemId) && !isClosedStatus(item.status))
            .map((item) => item.id));
    }

    function isClosedStatus(status: string): boolean {
        return ["已完成", "已失败", "已取消", "已放弃", "已归档"].includes(status);
    }

    function setZoom(next: number) {
        zoom = Math.max(0.5, Math.min(1.5, next));
    }

    function fitGraph() {
        if (!canvas || layout.width <= 0 || layout.height <= 0) return;
        const availableWidth = Math.max(280, canvas.clientWidth - 24);
        setZoom(Math.min(1.15, availableWidth / layout.width));
        void tick().then(() => {
            if (!canvas) return;
            canvas.scrollLeft = 0;
            canvas.scrollTop = 0;
        });
    }

    function startPan(event: PointerEvent) {
        if (!canvas || (event.target as Element).closest(".xz-relationship-node")) return;
        dragging = true;
        dragMoved = false;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        dragScrollLeft = canvas.scrollLeft;
        dragScrollTop = canvas.scrollTop;
        canvas.setPointerCapture(event.pointerId);
    }

    function movePan(event: PointerEvent) {
        if (!dragging || !canvas) return;
        if (Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY) > 4) dragMoved = true;
        canvas.scrollLeft = dragScrollLeft - (event.clientX - dragStartX);
        canvas.scrollTop = dragScrollTop - (event.clientY - dragStartY);
    }

    function stopPan(event: PointerEvent) {
        if (!dragging || !canvas) return;
        dragging = false;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }

    function clearHighlightFromCanvas(event: MouseEvent) {
        if (dragMoved) {
            dragMoved = false;
            return;
        }
        if ((event.target as Element).closest(".xz-relationship-node")) return;
        highlightedId = null;
    }

    function clearHighlightFromKeyboard(event: KeyboardEvent) {
        if (event.key !== "Enter" && event.key !== " " && event.key !== "Escape") return;
        event.preventDefault();
        highlightedId = null;
    }

    function selectNode(node: RelationshipGraphNode) {
        selectedId = node.id;
        highlightedId = node.id;
    }

    function handleNodeKeydown(event: KeyboardEvent, node: RelationshipGraphNode) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectNode(node);
    }
</script>

<main class="xz-relationship-page">
    <header class="xz-relationship-header">
        <div><span class="xz-section-kicker">根据当前数据自动生成</span><h2>未完成工作关系图</h2><p>显示所有未完成项目，默认带出未完成事务，并补齐到长期领域的完整层级。</p></div>
        <span>{layout.domainCount} 个领域 · {layout.projectCount} 个项目 · {layout.transactionCount} 个事务</span>
    </header>

    <div class="xz-relationship-toolbar">
        <input aria-label="搜索关系图" bind:value={searchQuery} placeholder="搜索项目或事务…" />
        <div class="xz-relationship-segmented" aria-label="状态筛选">
            <button class:active={statusFilter === "all"} type="button" on:click={() => statusFilter = "all"}>全部未完成</button>
            <button class:active={statusFilter === "ongoing"} type="button" on:click={() => statusFilter = "ongoing"}>仅进行中</button>
            <button class:active={statusFilter === "pending"} type="button" on:click={() => statusFilter = "pending"}>仅待开始</button>
        </div>
        <button class:active={showTransactions} class="xz-relationship-toggle" type="button" aria-pressed={showTransactions} on:click={() => showTransactions = !showTransactions}>{showTransactions ? "✓ " : ""}事务</button>
        <span class="xz-relationship-divider"></span>
        <button class:active={showHierarchy} class="xz-relationship-toggle hierarchy" type="button" aria-pressed={showHierarchy} on:click={() => showHierarchy = !showHierarchy}>— 上下层</button>
        <button class:active={showHard} class="xz-relationship-toggle hard" type="button" aria-pressed={showHard} on:click={() => showHard = !showHard}>→ 完成后开始</button>
        <button class:active={showSoft} class="xz-relationship-toggle soft" type="button" aria-pressed={showSoft} on:click={() => showSoft = !showSoft}>⇢ 需先行</button>
        <div class="xz-relationship-zoom">
            <button type="button" aria-label="缩小关系图" on:click={() => setZoom(zoom - 0.1)}>−</button>
            <button type="button" aria-label="适应画布宽度" title="适应画布宽度" on:click={fitGraph}>⌖</button>
            <button type="button" aria-label="放大关系图" on:click={() => setZoom(zoom + 0.1)}>＋</button>
        </div>
    </div>

    {#if layout.nodes.length === 0}
        <section class="xz-relationship-empty"><div class="xz-empty-icon">⌁</div><h3>当前筛选下没有未完成工作项</h3><p>可以切换状态筛选或重新显示事务。</p></section>
    {:else}
        <div class="xz-relationship-workspace">
            <div class:dragging class="xz-relationship-canvas" bind:this={canvas} role="button" tabindex="0" aria-label="工作关系图画布；点击空白处或按 Escape 取消关系高亮" on:pointerdown={startPan} on:pointermove={movePan} on:pointerup={stopPan} on:pointercancel={stopPan} on:click={clearHighlightFromCanvas} on:keydown={clearHighlightFromKeyboard}>
                <svg
                    width={layout.width * zoom}
                    height={layout.height * zoom}
                    style={`width: ${layout.width * zoom}px; height: ${layout.height * zoom}px;`}
                    viewBox={`0 0 ${layout.width} ${layout.height}`}
                    role="img"
                    aria-label="未完成项目、事务、层级及依赖关系"
                >
                    <defs>
                        <marker id="xz-relationship-hard-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
                        <marker id="xz-relationship-soft-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
                    </defs>
                    <g class="xz-relationship-edges">
                        {#each visibleEdges as edge (edge.id)}
                            {@const labelPosition = edgeLabelPosition(edge)}
                            <path class:dimmed={isEdgeDimmed(edge, highlightedId)} class:hierarchy={edge.kind === "hierarchy"} class:hard={edge.kind === "hard"} class:soft={edge.kind === "soft"} class:direct={isAdjacentDependency(edge, nodeById)} class:routed={edge.kind !== "hierarchy" && !isAdjacentDependency(edge, nodeById)} class="xz-relationship-edge" data-from-id={edge.fromId} data-to-id={edge.toId} d={edgePath(edge)}></path>
                            {#if edge.kind !== "hierarchy" && !isEdgeDimmed(edge, highlightedId)}
                                {@const labelWidth = edgeLabelWidth(edge)}
                                <g class:hard={edge.kind === "hard"} class:soft={edge.kind === "soft"} class="xz-relationship-edge-label">
                                    <rect x={labelPosition.x - labelWidth / 2} y={labelPosition.y - 10} width={labelWidth} height="20" rx="10"></rect>
                                    <text x={labelPosition.x} y={labelPosition.y + 3}>{edgeDescription(edge)}</text>
                                </g>
                            {/if}
                        {/each}
                    </g>
                    <g class="xz-relationship-nodes">
                        {#each layout.nodes as node (node.id)}
                            {@const lines = titleLines(node.item.title)}
                            {@const statusKind = graphStatusKind(node.item.status)}
                            {@const pillWidth = statusPillWidth(node.item.status)}
                            <g class:selected={activeSelectedId === node.id} class:dimmed={isNodeDimmed(node, highlightedId, selectedRelatedIds, normalizedSearch)} class:context={node.contextOnly} class:domain={node.item.type === "长期领域"} class:project={node.item.type === "项目"} class:transaction={node.item.type === "事务"} class="xz-relationship-node" data-work-item-id={node.id} transform={`translate(${node.x} ${node.y})`} role="button" tabindex="0" aria-label={`${node.item.type || "工作项"}：${node.item.title}，${statusLabel(node.item.status)}`} on:click={() => selectNode(node)} on:keydown={(event) => handleNodeKeydown(event, node)}>
                                <rect class="xz-relationship-node-frame" width={node.width} height={node.height} rx="12"></rect>
                                <text class="xz-relationship-node-type" x="12" y="17">{node.item.type || "未分类"}{node.contextOnly ? " · 上层上下文" : ""}</text>
                                <rect class={`xz-relationship-status-pill ${statusKind}`} x={node.width - pillWidth - 10} y="7" width={pillWidth} height="18" rx="9"></rect>
                                <text class="xz-relationship-status-label" x={node.width - pillWidth / 2 - 10} y="19.5">{statusLabel(node.item.status)}</text>
                                {#each lines as line, index}<text class="xz-relationship-node-title" x="12" y={lines.length === 1 ? 42 : 37 + index * 14}>{line}</text>{/each}
                            </g>
                        {/each}
                    </g>
                </svg>
                <span class="xz-relationship-canvas-hint">拖动画布 · 点击节点突出关系 · 点击空白恢复全部</span>
            </div>

            <aside class="xz-relationship-inspector">
                {#if selectedNode}
                    <span class="xz-section-kicker">当前选择 · {selectedNode.item.type || "工作项"}</span>
                    <h3>{selectedNode.item.title}</h3>
                    <p class="xz-relationship-breadcrumb">{breadcrumb(selectedNode.item)}</p>
                    <div class="xz-relationship-meta"><span>{statusLabel(selectedNode.item.status)}</span>{#if selectedNode.item.energy}<span>{selectedNode.item.energy}精力</span>{/if}{#if selectedNode.contextOnly}<span>上层上下文</span>{/if}</div>
                    <section class="hard"><strong>开始本项前必须完成</strong><p>{resolveTitles(selectedNode.item.hardPrerequisiteIds ?? [])}</p></section>
                    <section class="hard"><strong>本项完成后才开始</strong><p>{hardDependentTitles(selectedNode.id)}</p></section>
                    <section class="soft"><strong>开始本项前建议先行</strong><p>{resolveTitles(selectedNode.item.softPrerequisiteIds ?? [])}</p></section>
                    <section class="soft"><strong>将本项设为先行条件</strong><p>{softDependentTitles(selectedNode.id)}</p></section>
                    <section><strong>未完成下层</strong><p>{childTitles(selectedNode.id)}</p></section>
                    <button class="b3-button xz-relationship-open" type="button" on:click={() => openItem(selectedNode.item)}>打开工作项详情</button>
                {:else}
                    <div class="xz-relationship-inspector-empty"><p>选择一个节点查看它的层级与依赖关系。</p></div>
                {/if}
            </aside>
        </div>
    {/if}
</main>
