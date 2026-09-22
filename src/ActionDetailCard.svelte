<script lang="ts">
    /**
     * 本次行动细则：结构化字段卡。
     *
     * 排版原则（上一版的问题：所有字段挤成一坨、空字段和已填字段长得一样、文案重复）：
     * ① 每个字段是**独立的小卡片**：白底、留白、有边框，一眼看出边界；
     * ② 已填字段只显示一行预览，点开才展开全文；未填字段是一行虚线提示，不占地方；
     * ③ 当前状态是唯一重点：左侧主色条 + 淡底，自动行（系统事实）和手写行分开显示；
     * ④ 标题行只留字段名，其余说明收进 title 提示，不再重复「必填／复访先看这里／大窗口编辑」。
     */
    import { createEventDispatcher } from "svelte";
    import { renderActionMarkdown } from "./markdown-renderer";
    import {
        ACTION_DETAIL_FIELDS,
        outcomesForDisplay,
        type ActionDetail,
        type ActionDetailField,
        type ActionOutcome,
    } from "./action-detail";

    export let detail: ActionDetail;
    /** 标题按工作项角色变化：事务是「本次行动细则」，项目是「项目目标／当前阶段」等。 */
    export let title = "本次行动细则";
    /** 下一步行动；仍是独立字段，只在这里渲染。 */
    export let nextAction = "";
    /** 自动行的事实：待办 2/5 · 切片 3/5 · 最近更新 3 天前 · 09-30 截止（剩 9 天）。 */
    export let autoFacts: string[] = [];
    export let disabled = false;
    export let notice = "";
    export let templateNames: string[] = [];
    /** 内部字段缺失时的提示（正常情况下为空）。 */
    export let fieldNotice = "";
    /** 条目结束后的图片待清理角标（由父组件按清理规则算出，卡片只负责显示）。 */
    export let cleanupBadge = "";
    export let onCleanupBadge: () => void = () => undefined;
    /** 阅读态图片：点击看原图、右键弹复制菜单（沿用旧的图片链路）。 */
    export let onImageClick: (event: MouseEvent, field: ActionDetailField | "nextAction") => void = () => undefined;
    export let onImageContextMenu: (event: MouseEvent) => void = () => undefined;

    const dispatch = createEventDispatcher<{
        edit: { field: ActionDetailField };
        nextAction: { value: string };
        addOutcome: { text: string };
        outcomeText: { id: string; text: string };
        removeOutcome: { id: string };
        copyPrompt: Record<string, never>;
        applyTemplate: { name: string };
        saveTemplate: { name: string };
    }>();

    /** 展开中的字段（点标题或预览展开）。 */
    let expanded = new Set<ActionDetailField>();
    let outcomeDraft = "";
    let templateOpen = false;
    /** 模板面板：保存模板时在这里输入名字（不用 window.prompt——Electron 渲染进程不支持它）。 */
    let templateNameDraft = "";
    let savingTemplate = false;

    $: outcomes = outcomesForDisplay(detail);
    $: fields = ACTION_DETAIL_FIELDS.filter((field) => field.key !== "currentState");
    $: filledCount = ACTION_DETAIL_FIELDS.filter((field) => (detail[field.key] ?? "").trim()).length;

    function toggle(field: ActionDetailField) {
        const next = new Set(expanded);
        next.has(field) ? next.delete(field) : next.add(field);
        expanded = next;
    }

    function openField(field: ActionDetailField) {
        dispatch("edit", { field });
    }

    /** 保存模板：名字来自面板里的输入框；交给父组件落盘，成功后才清空输入。 */
    function submitTemplate() {
        const name = templateNameDraft.trim();
        if (!name) return;
        dispatch("saveTemplate", { name });
        templateNameDraft = "";
        templateOpen = false;
    }

    function submitOutcome() {
        const text = outcomeDraft.trim();
        if (!text) return;
        dispatch("addOutcome", { text });
        outcomeDraft = "";
    }

    function fieldValue(field: ActionDetailField): string {
        return detail[field] ?? "";
    }

    /** 预览：压成单行、去掉 Markdown 记号，只用来判断"写了什么"。 */
    function preview(field: ActionDetailField): string {
        const text = fieldValue(field)
            .replace(/!\[[^\]]*\]\([^)]*\)/g, "［图片］")
            .replace(/[#>*`]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        return text.length > 96 ? `${text.slice(0, 96)}…` : text;
    }

    function isFilled(field: ActionDetailField): boolean {
        return Boolean(fieldValue(field).trim());
    }
</script>

<section class="xz-plan-card" aria-label={title}>
    <header class="xz-plan-card__head">
        <h3>{title}</h3>
        <span class="xz-plan-card__count" title="已填写的字段数">已填 {filledCount}/{ACTION_DETAIL_FIELDS.length}</span>
        <span class="xz-plan-card__head-actions">
            {#if cleanupBadge}
                <button class="xz-cleanup-badge" type="button" title="条目已结束，这些图片在宽限期后可以清理" on:click={onCleanupBadge}>{cleanupBadge}</button>
            {/if}
            <button class="xz-plan-card__link" type="button" disabled={disabled} on:click={() => (templateOpen = !templateOpen)} aria-expanded={templateOpen}>模板 {templateOpen ? "⌃" : "⌄"}</button>
        </span>
    </header>

    {#if templateOpen}
        <div class="xz-plan-templates">
            <p class="xz-plan-card__hint">套用只填<b>空字段</b>，已写的内容不会被覆盖；模板对所有事务与想法通用。</p>
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
        <!-- 当前状态：整张卡的重点，左条 + 淡底；自动行与手写行分开 -->
        <article class="xz-plan-field xz-plan-field--state">
            <div class="xz-plan-field__head">
                <h4>当前状态</h4>
                <button class="xz-plan-field__edit" type="button" disabled={disabled} on:click={() => openField("currentState")}>
                    {isFilled("currentState") ? "编辑" : "填写"}
                </button>
            </div>
            {#if autoFacts.length > 0}
                <p class="xz-plan-auto"><span class="xz-plan-auto__tag">自动</span>{autoFacts.join(" · ")}</p>
            {/if}
            {#if detail.currentState.trim()}
                <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                <div class="xz-markdown-preview xz-plan-field__text" on:click={(event) => onImageClick(event, "currentState")} on:contextmenu={onImageContextMenu}>{@html renderActionMarkdown(detail.currentState)}</div>
            {:else}
                <button class="xz-plan-empty" type="button" disabled={disabled} on:click={() => openField("currentState")}>
                    写一句「上次做到 / 卡在哪」。
                </button>
            {/if}
            {#if nextAction.trim()}
                <p class="xz-plan-nextline">下一步：<b>{nextAction.trim()}</b></p>
            {/if}
        </article>

        {#each fields as field (field.key)}
            <article class="xz-plan-field" class:xz-plan-field--open={expanded.has(field.key)}>
                <div class="xz-plan-field__head">
                    <button class="xz-plan-field__toggle" type="button" aria-expanded={expanded.has(field.key)} on:click={() => toggle(field.key)} title={field.hint}>
                        <h4>{field.label}</h4>
                    </button>
                    {#if field.key === "prompt" && isFilled("prompt")}
                        <button class="xz-plan-card__link" type="button" on:click={() => dispatch("copyPrompt", {})}>复制</button>
                    {/if}
                    <button class="xz-plan-field__edit" type="button" disabled={disabled} on:click={() => openField(field.key)}>
                        {isFilled(field.key) ? "编辑" : "填写"}
                    </button>
                    <button class="xz-plan-field__caret" type="button" aria-label={`${expanded.has(field.key) ? "收起" : "展开"}${field.label}`} title={expanded.has(field.key) ? "收起" : "展开全文"} on:click={() => toggle(field.key)}>{expanded.has(field.key) ? "⌃" : "⌄"}</button>
                </div>
                {#if expanded.has(field.key)}
                    <div class="xz-plan-field__body">
                        {#if isFilled(field.key)}
                            <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                            <div class="xz-markdown-preview xz-plan-field__text" on:click={(event) => onImageClick(event, field.key)} on:contextmenu={onImageContextMenu}>{@html renderActionMarkdown(fieldValue(field.key))}</div>
                        {:else}
                            <button class="xz-plan-empty xz-plan-empty--inline" type="button" disabled={disabled} on:click={() => openField(field.key)}>还没写，点这里开始。</button>
                        {/if}
                    </div>
                {:else if isFilled(field.key)}
                    <button class="xz-plan-field__preview" type="button" on:click={() => toggle(field.key)}>{preview(field.key)}</button>
                {/if}
            </article>
        {/each}

        <article class="xz-plan-field">
            <div class="xz-plan-field__head">
                <h4>阶段性成果</h4>
                <span class="xz-plan-field__note">{outcomes.length > 0 ? `${outcomes.length} 条` : "一条一条记下已经拿到的结果"}</span>
            </div>
            <div class="xz-plan-field__body xz-plan-field__body--list">
                {#each outcomes as outcome, index (outcome.id)}
                    <div class="xz-plan-outcome">
                        <span class="xz-plan-outcome__idx">{outcomes.length - index}</span>
                        <div class="xz-plan-outcome__main">
                            <input
                                class="b3-text-field xz-plan-outcome__input"
                                aria-label={`成果 ${index + 1}`}
                                value={outcome.text}
                                disabled={disabled}
                                on:change={(event) => dispatch("outcomeText", { id: outcome.id, text: event.currentTarget.value })}
                            />
                            <div class="xz-plan-outcome__meta">
                                {outcome.date ?? ""}
                                {#if outcome.fromTodoId}· 来自待办{/if}
                            </div>
                        </div>
                        <button class="xz-todo__icon" type="button" disabled={disabled} aria-label={`删除成果 ${index + 1}`} title="删除这一条" on:click={() => dispatch("removeOutcome", { id: outcome.id })}>🗑</button>
                    </div>
                {/each}
                <div class="xz-plan-outcome__add">
                    <input
                        class="b3-text-field xz-plan-outcome__input"
                        type="text"
                        placeholder="＋ 添加一条成果，回车确认"
                        disabled={disabled}
                        bind:value={outcomeDraft}
                        on:keydown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitOutcome(); } }}
                    />
                    <button class="b3-button b3-button--outline xz-todo-card__mini" type="button" disabled={disabled || !outcomeDraft.trim()} on:click={submitOutcome}>添加</button>
                </div>
            </div>
        </article>

        <article class="xz-plan-field xz-plan-field--next">
            <div class="xz-plan-field__head">
                <h4>下一步行动</h4>
                <button class="xz-plan-field__edit" type="button" disabled={disabled} on:click={() => dispatch("nextAction", { value: nextAction })}>
                    {nextAction.trim() ? "编辑" : "填写"}
                </button>
            </div>
            {#if nextAction.trim()}
                <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                <div class="xz-markdown-preview xz-plan-field__text" on:click={(event) => onImageClick(event, "nextAction")} on:contextmenu={onImageContextMenu}>{@html renderActionMarkdown(nextAction)}</div>
            {:else}
                <button class="xz-plan-empty" type="button" disabled={disabled} on:click={() => dispatch("nextAction", { value: "" })}>还没有明确的下一步行动，点这里写一条。</button>
            {/if}
        </article>
    </div>
</section>
