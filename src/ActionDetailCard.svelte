<script lang="ts">
    /**
     * 「本次行动细则」：断点区 + 四个稳定背景字段。
     *
     * 三个旧板块的归宿（它们不再是可填字段）：
     *   当前状态   = 最新一条断点（派生，只读）
     *   阶段性成果 = 打了星标的断点（筛选视图）
     *   下一步行动 = 最新断点的 next，和入口、交接内容一起构成「下次怎么开始」
     *
     * 断点区**不折叠**：一眼要看到现在什么状态、下一步做什么；能折叠的只有历史。
     */
    import { createEventDispatcher } from "svelte";
    import { renderActionMarkdown } from "./markdown-renderer";
    import {
        ACTION_DETAIL_FIELDS,
        checkpointsForDisplay,
        latestCheckpoint,
        type ActionCheckpoint,
        type ActionDetail,
        type ActionDetailField,
        type CheckpointPatch,
        type NewCheckpointInput,
    } from "./action-detail";
    import type { EntryUsage } from "./entry-points";
    import CheckpointForm from "./CheckpointForm.svelte";
    import EntryIcon from "./EntryIcon.svelte";

    export let detail: ActionDetail;
    export let itemId = "";
    export let title = "本次行动细则";
    /** 自动行的事实：待办 2/5 · 切片 3/5 · 最近更新 3 天前 · 09-30 截止（剩 9 天）。 */
    export let autoFacts: string[] = [];
    /** 用过的入口（父组件跨全部工作项收好，本工作项的排前面） */
    export let entryUsages: EntryUsage[] = [];
    export let disabled = false;
    export let notice = "";
    export let templateNames: string[] = [];
    export let fieldNotice = "";
    export let cleanupBadge = "";
    export let onCleanupBadge: () => void = () => undefined;
    export let onImageClick: (event: MouseEvent, field: ActionDetailField) => void = () => undefined;
    export let onImageContextMenu: (event: MouseEvent) => void = () => undefined;

    const dispatch = createEventDispatcher<{
        edit: { field: ActionDetailField };
        addCheckpoint: { input: NewCheckpointInput };
        saveCheckpoint: { id: string; patch: CheckpointPatch };
        removeCheckpoint: { id: string };
        starCheckpoint: { id: string };
        copyPrompt: Record<string, never>;
        applyTemplate: { name: string };
        saveTemplate: { name: string };
    }>();

    let formOpen = false;
    let editingId: string | null = null;
    let pickerOpen = false;
    let historyOpen = false;
    let filter: "all" | "star" = "all";
    let payloadOpen = false;
    /** 展开中的稳定字段 */
    let expandedFields = new Set<ActionDetailField>();
    /** 展开详情的断点 id */
    let expandedCheckpoints = new Set<string>();
    let templateOpen = false;
    let templateNameDraft = "";
    let savingTemplate = false;
    /** 已同步的条目标识：换条目时复位只属于上一条的临时状态 */
    let sourceId = itemId;

    /** 一行一个卡点：数据层本来就是多行字符串，展示层按行拆开，旧数据不用迁移。 */
    function splitStuck(value: string): string[] {
        return value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
    }

    $: stuckLines = splitStuck(latest?.stuck ?? "");
    $: checkpoints = checkpointsForDisplay(detail);
    $: latest = latestCheckpoint(detail);
    $: older = checkpoints.filter((item) => item.id !== latest?.id);
    $: starredCount = checkpoints.filter((item) => item.starred).length;
    /** 正在编辑的那条永远留在列表里：切到「只看成果」时表单不能跟着被筛掉 */
    $: visibleOlder = filter === "star" ? older.filter((item) => item.starred || item.id === editingId) : older;
    $: editing = editingId ? checkpoints.find((item) => item.id === editingId) ?? null : null;

    $: if (itemId !== sourceId) {
        sourceId = itemId;
        formOpen = false;
        editingId = null;
        pickerOpen = false;
        payloadOpen = false;
        templateNameDraft = "";
        templateOpen = false;
    }

    function pad(value: number): string {
        return String(value).padStart(2, "0");
    }

    function formatWhen(at: number): string {
        const date = new Date(at);
        return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /** 相对「今天/昨天/N 天前」：按本地区间算天。 */
    function relativeDays(at: number): string {
        const start = (value: number) => new Date(value).setHours(0, 0, 0, 0);
        const days = Math.round((start(Date.now()) - start(at)) / 86400000);
        if (days <= 0) return "今天";
        if (days === 1) return "昨天";
        return `${days} 天前`;
    }

    function preview(value: string | undefined): string {
        const text = (value ?? "")
            .replace(/!\[[^\]]*\]\([^)]*\)/g, "［图片］")
            .replace(/[#>*`]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        return text.length > 92 ? `${text.slice(0, 92)}…` : text;
    }

    function payloadSummary(value: string): string {
        const text = value.trim();
        if (!text) return "";
        return `${text.split("\n").length} 行 · ${text.length} 字`;
    }

    function isHttp(target: string): boolean {
        return /^https?:\/\//i.test(target);
    }

    function toggle(field: ActionDetailField) {
        const next = new Set(expandedFields);
        next.has(field) ? next.delete(field) : next.add(field);
        expandedFields = next;
    }

    function startNew() {
        editingId = null;
        formOpen = true;
        pickerOpen = false;
    }

    function startEdit(id: string) {
        formOpen = false;
        editingId = id;
    }

    function cancelForm() {
        formOpen = false;
        editingId = null;
        pickerOpen = false;
    }

    /** 表单交回来的是完整对象：新建走 add，编辑走 patch。 */
    function handleSave(value: ActionCheckpoint) {
        const exists = checkpoints.some((item) => item.id === value.id);
        if (!exists) {
            dispatch("addCheckpoint", {
                input: {
                    did: value.did,
                    stuck: value.stuck,
                    next: value.next,
                    entry: value.entry,
                    payload: value.payload,
                    starred: value.starred,
                },
            });
            cancelForm();
            return;
        }
        dispatch("saveCheckpoint", {
            id: value.id,
            patch: {
                did: value.did,
                stuck: value.stuck,
                next: value.next,
                entry: value.entry,
                payload: value.payload,
                starred: value.starred,
            },
        });
        cancelForm();
    }

    function copyPayload() {
        const payload = latest?.payload ?? "";
        if (!payload.trim()) return;
        if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(payload);
    }

    /** 新建断点的空壳：表单要一个 initial，真正的 id 由领域层生成。 */
    function emptyCheckpoint(): ActionCheckpoint {
        return {
            id: "",
            createdAt: Date.now(),
            did: "",
            stuck: "",
            next: "",
            entry: null,
            payload: "",
            starred: false,
        };
    }

    function toggleExpandCheckpoint(id: string) {
        const next = new Set(expandedCheckpoints);
        next.has(id) ? next.delete(id) : next.add(id);
        expandedCheckpoints = next;
    }

    /** 收起历史会连带卸掉正在编辑的那条表单：先把编辑态收干净，不留看不见的 editingId。 */
    function toggleHistory() {
        historyOpen = !historyOpen;
        if (!historyOpen) editingId = null;
    }

    function submitTemplate() {
        const name = templateNameDraft.trim();
        if (!name) return;
        dispatch("saveTemplate", { name });
        templateNameDraft = "";
        templateOpen = false;
    }
</script>

<section class="xz-plan-card" aria-label={title} data-cp-card>
    <header class="xz-plan-card__head">
        <h3>{title}</h3>
        <span class="xz-plan-card__count">断点 {checkpoints.length} 条</span>
        <span class="xz-plan-card__head-actions">
            {#if cleanupBadge}
                <button class="xz-cleanup-badge" type="button" title="条目已结束，这些图片在宽限期后可以清理" on:click={onCleanupBadge}>{cleanupBadge}</button>
            {/if}
            <button class="xz-plan-card__link" type="button" disabled={disabled} on:click={() => (templateOpen = !templateOpen)} aria-expanded={templateOpen}>模板 {templateOpen ? "⌃" : "⌄"}</button>
        </span>
    </header>

    {#if templateOpen}
        <div class="xz-plan-templates">
            <p class="xz-plan-card__hint">套用只填<b>空字段</b>，已写的内容不会被覆盖；模板只含背景类字段，不复制断点。</p>
            {#if templateNames.length === 0}
                <p class="xz-plan-card__hint">还没有保存过模板。</p>
            {:else}
                <div class="xz-plan-templates__list">
                    {#each templateNames as name (name)}
                        <button class="b3-button b3-button--outline xz-todo-card__mini" type="button" disabled={disabled} on:click={() => { dispatch("applyTemplate", { name }); templateOpen = false; }}>套用「{name}」</button>
                    {/each}
                </div>
            {/if}
            <div class="xz-plan-templates__save">
                <input
                    class="b3-text-field xz-plan-templates__name"
                    type="text"
                    placeholder="模板名字，例如：技术事务"
                    maxlength="40"
                    disabled={disabled || savingTemplate}
                    bind:value={templateNameDraft}
                    on:keydown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitTemplate(); } }}
                />
                <button
                    class="b3-button b3-button--outline xz-todo-card__mini"
                    type="button"
                    disabled={disabled || savingTemplate || !templateNameDraft.trim()}
                    on:click={submitTemplate}
                >存为模板</button>
            </div>
        </div>
    {/if}

    {#if fieldNotice}<p class="xz-missing-field"><strong>内部字段暂不可用</strong><span>{fieldNotice}</span></p>{/if}
    {#if notice}<p class="xz-action-hint">{notice}</p>{/if}

    <div class="xz-plan-card__body">
        <!-- ── 断点：当前状态 / 阶段性成果 / 下一步行动 都归到这一条时间轴上 ─── -->
        <article class="xz-cp-block" class:xz-cp-block--empty={!latest} data-cp-block>
            <div class="xz-cp-block__head">
                <h4>断点</h4>
                <span class="xz-cp-block__note">{latest ? "每次停手记一条，最新的在最上面" : "停手时记一条，回来就知道从哪接"}</span>
                <button class="xz-cp-block__add" type="button" disabled={disabled} on:click={startNew} data-cp-add>＋ 记一次断点</button>
            </div>

            {#if autoFacts.length > 0}
                <p class="xz-plan-auto"><span class="xz-plan-auto__tag">自动</span>{autoFacts.join(" · ")}</p>
            {/if}

            {#if latest}
                {#if editing && editing.id === latest.id}
                    <CheckpointForm
                        initial={latest}
                        usages={entryUsages}
                        currentItemId={itemId}
                        modeLabel="编辑这条断点"
                        nowLabel={formatWhen(latest.createdAt)}
                        {disabled}
                        on:save={(event) => handleSave(event.detail.value)}
                        on:cancel={cancelForm}
                    />
                {:else}
                <section class="xz-cp-latest" data-cp-latest>
                    <header class="xz-cp-latest__head">
                        <span class="xz-cp-latest__title">上次做到</span>
                        <span class="xz-cp-latest__when">{formatWhen(latest.createdAt)} · {relativeDays(latest.createdAt)}</span>
                        <button
                            class="xz-cp-star"
                            class:is-on={latest.starred}
                            type="button"
                            disabled={disabled}
                            title={latest.starred ? "取消阶段性成果" : "标为阶段性成果"}
                            on:click={() => dispatch("starCheckpoint", { id: latest.id })}
                        >{latest.starred ? "★ 阶段性成果" : "☆ 标为成果"}</button>
                        <button class="xz-plan-field__edit" type="button" disabled={disabled} on:click={() => startEdit(latest.id)}>编辑</button>
                    </header>

                    {#if latest.did}
                        <div class="xz-cp-latest__did">{@html renderActionMarkdown(latest.did)}</div>
                    {/if}
                    {#if stuckLines.length > 0}
                        <section class="xz-cp-stuck" data-cp-stuck>
                            <div class="xz-cp-stuck__head">
                                <span class="xz-cp-stuck__title">卡在</span>
                                {#if stuckLines.length > 1}<span class="xz-cp-stuck__count">{stuckLines.length} 处</span>{/if}
                            </div>
                            <ul class="xz-cp-stuck__list">
                                {#each stuckLines as line, index (index)}
                                    <li>{line}</li>
                                {/each}
                            </ul>
                        </section>
                    {/if}

                    <div class="xz-cp-resume" data-cp-resume>
                        <span class="xz-cp-resume__label">下次怎么开始</span>
                        <div class="xz-cp-resume__rows">
                            <div class="xz-cp-row">
                                <span class="xz-cp-row__key">下一步</span>
                                {#if latest.next}
                                    <span class="xz-cp-row__value xz-cp-row__value--strong">{latest.next}</span>
                                {:else}
                                    <span class="xz-cp-row__value xz-cp-row__value--pending">待定</span>
                                {/if}
                            </div>
                            <div class="xz-cp-row">
                                <span class="xz-cp-row__key">入口</span>
                                {#if latest.entry}
                                    <span class="xz-cp-row__value">
                                        <span class="xz-cp-entry" title={latest.entry.target || latest.entry.label}>
                                            <EntryIcon type={latest.entry.type} size={16} />
                                            <span class="xz-cp-entry__label">{latest.entry.label}</span>
                                            {#if latest.entry.target}
                                                <span class="xz-cp-entry__target" title={latest.entry.target}>{latest.entry.target}</span>
                                            {/if}
                                        </span>
                                    </span>
                                    {#if isHttp(latest.entry.target)}
                                        <a class="xz-cp-act" href={latest.entry.target} target="_blank" rel="noreferrer">打开</a>
                                    {/if}
                                {:else}
                                    <span class="xz-cp-row__value xz-cp-row__value--pending">没记从哪里进</span>
                                {/if}
                            </div>
                            <div class="xz-cp-row">
                                <span class="xz-cp-row__key">交接内容</span>
                                {#if latest.payload.trim()}
                                    <span class="xz-cp-row__value xz-cp-row__value--muted">{payloadSummary(latest.payload)}</span>
                                    <button class="xz-cp-act" type="button" on:click={() => (payloadOpen = !payloadOpen)}>{payloadOpen ? "收起" : "展开"}</button>
                                    <button class="xz-cp-copy" type="button" on:click={copyPayload}>复制交接内容</button>
                                {:else}
                                    <span class="xz-cp-row__value xz-cp-row__value--pending">没留</span>
                                {/if}
                            </div>
                        </div>
                        {#if payloadOpen && latest.payload.trim()}
                            <pre class="xz-cp-payload">{latest.payload}</pre>
                        {/if}
                    </div>
                </section>
                {/if}
            {:else if !formOpen}
                <button class="xz-plan-empty xz-cp-empty" type="button" disabled={disabled} on:click={startNew}>
                    还没有断点。第一次停手时记一条：做到哪、下次从哪进。
                </button>
            {/if}

            {#if formOpen}
                <CheckpointForm
                    initial={emptyCheckpoint()}
                    usages={entryUsages}
                    currentItemId={itemId}
                    prevNext={latest?.next ?? ""}
                    modeLabel="记一次断点"
                    nowLabel={`${formatWhen(Date.now())} · 现在`}
                    pickerOpen={pickerOpen}
                    {disabled}
                    on:save={(event) => handleSave(event.detail.value)}
                    on:cancel={cancelForm}
                />
            {/if}

            {#if older.length > 0}
                <div class="xz-cp-history" data-cp-history>
                    <div class="xz-cp-history__head">
                        <button class="xz-cp-history__toggle" type="button" on:click={toggleHistory} data-cp-history-toggle>
                            {historyOpen ? "▾" : "▸"} 更早的断点 {older.length} 条
                        </button>
                        <div class="xz-cp-filter">
                            <button class="xz-cp-filter__chip" class:is-on={filter === "all"} type="button" on:click={() => (filter = "all")}>全部 {older.length}</button>
                            <button class="xz-cp-filter__chip" class:is-on={filter === "star"} type="button" on:click={() => { filter = "star"; historyOpen = true; }}>
                                阶段性成果 {starredCount}
                            </button>
                        </div>
                    </div>

                    {#if historyOpen}
                        {#if visibleOlder.length === 0}
                            <p class="xz-cp-history__empty">还没有标过阶段性成果。</p>
                        {/if}
                        <ol class="xz-cp-list">
                            {#each visibleOlder as item (item.id)}
                                <li class="xz-cp-item" class:is-star={item.starred}>
                                    {#if editingId === item.id}
                                        <CheckpointForm
                                            initial={item}
                                            usages={entryUsages}
                                            currentItemId={itemId}
                                            modeLabel="编辑这条断点"
                                            nowLabel={formatWhen(item.createdAt)}
                                            {disabled}
                                            on:save={(event) => handleSave(event.detail.value)}
                                            on:cancel={cancelForm}
                                        />
                                    {:else}
                                        <span class="xz-cp-item__dot" aria-hidden="true"></span>
                                        <div class="xz-cp-item__main">
                                            <div class="xz-cp-item__head">
                                                <span class="xz-cp-item__when">{formatWhen(item.createdAt)}</span>
                                                <span class="xz-cp-item__rel">{relativeDays(item.createdAt)}</span>
                                                {#if item.starred}<span class="xz-cp-item__star">★ 成果</span>{/if}
                                                <button class="xz-cp-star xz-cp-star--sm" type="button" disabled={disabled} title={item.starred ? "取消阶段性成果" : "标为阶段性成果"} on:click={() => dispatch("starCheckpoint", { id: item.id })}>
                                                    {item.starred ? "★" : "☆"}
                                                </button>
                                                <button class="xz-cp-item__edit" type="button" disabled={disabled} on:click={() => startEdit(item.id)}>编辑</button>
                                            </div>
                                            <p class="xz-cp-item__did">{preview(item.did)}</p>
                                            {#if expandedCheckpoints.has(item.id)}
                                                <div class="xz-cp-item__more">
                                                    {#if item.stuck}
                                                        <div class="xz-cp-stuck xz-cp-stuck--compact">
                                                            <div class="xz-cp-stuck__head"><span class="xz-cp-stuck__title">卡在</span></div>
                                                            <ul class="xz-cp-stuck__list">
                                                                {#each splitStuck(item.stuck) as line, index (index)}
                                                                    <li>{line}</li>
                                                                {/each}
                                                            </ul>
                                                        </div>
                                                    {/if}
                                                    {#if item.entry}
                                                        <p class="xz-cp-item__entry"><span>入口</span><EntryIcon type={item.entry.type} size={12} />{item.entry.label} · {item.entry.target}</p>
                                                    {/if}
                                                    {#if item.payload.trim()}<p><span>交接内容</span>{item.payload}</p>{/if}
                                                </div>
                                            {/if}
                                            {#if item.stuck || item.entry || item.payload.trim()}
                                                <button class="xz-cp-item__expand" type="button" on:click={() => toggleExpandCheckpoint(item.id)}>
                                                    {expandedCheckpoints.has(item.id) ? "收起详情" : "看详情"}
                                                </button>
                                            {/if}
                                            {#if item.next}
                                                <p class="xz-cp-item__next">下一步：{item.next}</p>
                                            {/if}
                                        </div>
                                    {/if}
                                </li>
                            {/each}
                        </ol>
                    {/if}
                </div>
            {/if}
        </article>

        <!-- ── 四个稳定背景字段：只写一次，不参与每次停手 ─────────────────── -->
        {#each ACTION_DETAIL_FIELDS as field (field.key)}
            <article class="xz-plan-field" class:xz-plan-field--open={expandedFields.has(field.key)}>
                <div class="xz-plan-field__head">
                    <button class="xz-plan-field__toggle" type="button" aria-expanded={expandedFields.has(field.key)} on:click={() => toggle(field.key)} title={field.hint}>
                        <h4>{field.label}</h4>
                    </button>
                    {#if field.key === "prompt" && detail.prompt.trim()}
                        <button class="xz-plan-card__link" type="button" on:click={() => dispatch("copyPrompt", {})}>复制</button>
                    {/if}
                    <button class="xz-plan-field__edit" type="button" disabled={disabled} on:click={() => dispatch("edit", { field: field.key })}>
                        {detail[field.key].trim() ? "编辑" : "填写"}
                    </button>
                    <button class="xz-plan-field__caret" type="button" aria-label={`${expandedFields.has(field.key) ? "收起" : "展开"}${field.label}`} on:click={() => toggle(field.key)}>
                        {expandedFields.has(field.key) ? "⌃" : "⌄"}
                    </button>
                </div>
                {#if expandedFields.has(field.key)}
                    <div class="xz-plan-field__body">
                        {#if detail[field.key].trim()}
                            <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                            <div class="xz-markdown-preview xz-plan-field__text" on:click={(event) => onImageClick(event, field.key)} on:contextmenu={onImageContextMenu}>{@html renderActionMarkdown(detail[field.key])}</div>
                        {:else}
                            <button class="xz-plan-empty xz-plan-empty--inline" type="button" disabled={disabled} on:click={() => dispatch("edit", { field: field.key })}>还没写，点这里开始。</button>
                        {/if}
                    </div>
                {:else if detail[field.key].trim()}
                    <button class="xz-plan-field__preview" type="button" on:click={() => toggle(field.key)}>{preview(detail[field.key])}</button>
                {/if}
            </article>
        {/each}
    </div>
</section>
