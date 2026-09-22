<script lang="ts">
    /**
     * 事务的待办清单。
     *
     * 设计取舍：
     * - 复选框 = 完成，× = 放弃（保留痕迹、可恢复），删除在展开的详情里——三者不能混成一个动作；
     * - 展开详情走**行内抽屉**，不用弹窗：编辑时仍能看到上面的切片日历和下面的细则；
     * - 勾选与打叉立刻上报保存（高频动作不该先按保存），文字与备注由父组件按需保存。
     */
    import { createEventDispatcher } from "svelte";
    import {
        completedTodoCount,
        droppedTodoCount,
        findTodo,
        openTodos,
        sortTodosForDisplay,
        todoProgress,
        type Todo,
    } from "./todos";

    export let todos: Todo[] = [];
    export let disabled = false;
    /** 窄屏时隐藏元信息列（未动天数、图片数），避免挤压标题。 */
    export let compact = false;
    /** 父组件提供的相对日期文案（例如「3 天前」）。 */
    export let relativeDay: (timestamp: number | null) => string = () => "";

    const dispatch = createEventDispatcher<{
        add: { text: string };
        text: { id: string; text: string };
        /** 详情抽屉里一次提交备注与链接。 */
        detail: { id: string; note: string; links: string[] };
        done: { id: string };
        dropped: { id: string };
        restore: { id: string };
        remove: { id: string };
        /** 把选中的待办交给今天的执行切片。 */
        today: { ids: string[] };
    }>();

    let expandedId: string | null = null;
    let multiSelect = false;
    let selectedIds = new Set<string>();
    let draft = "";
    let showDropped = false;
    let noteDrafts: Record<string, string> = {};
    let linkDrafts: Record<string, string> = {};

    $: ordered = sortTodosForDisplay(todos);
    $: visible = showDropped ? ordered : ordered.filter((todo) => todo.status !== "dropped");
    $: progress = todoProgress(todos);
    $: selectedCount = selectedIds.size;

    function toggleExpanded(id: string) {
        expandedId = expandedId === id ? null : id;
        if (expandedId && noteDrafts[id] === undefined) {
            noteDrafts = { ...noteDrafts, [id]: findTodo(todos, id)?.note ?? "" };
            linkDrafts = { ...linkDrafts, [id]: (findTodo(todos, id)?.links ?? []).join("\n") };
        }
    }

    function submitDraft() {
        const text = draft.trim();
        if (!text || disabled) return;
        // 粘贴多行文本时一次生成多条，省去逐条回车。
        const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
        for (const line of lines) dispatch("add", { text: line });
        draft = "";
    }

    function handleDraftKeydown(event: KeyboardEvent) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submitDraft();
        }
        if (event.key === "Escape") draft = "";
    }

    /** 备注与链接的失焦保存统一走这里：两个输入框共用一个事件，避免父组件多存一次。 */
    function saveDetail(id: string) {
        const todo = findTodo(todos, id);
        if (!todo) return;
        const note = noteDrafts[id] ?? todo.note;
        const links = (linkDrafts[id] ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
        if (note === todo.note && links.join("\n") === todo.links.join("\n")) return;
        dispatch("detail", { id, note, links });
    }

    function toggleSelected(id: string) {
        const next = new Set(selectedIds);
        next.has(id) ? next.delete(id) : next.add(id);
        selectedIds = next;
    }

    function exitMultiSelect() {
        multiSelect = false;
        selectedIds = new Set();
    }

    function sendSelectedToToday() {
        if (selectedIds.size === 0) return;
        dispatch("today", { ids: [...selectedIds] });
        exitMultiSelect();
    }

    function completedLabel(todo: Todo): string {
        return todo.completedOn ? `完成于 ${todo.completedOn}` : "已完成";
    }
</script>

<section class="xz-todo-card" aria-label="待办清单">
    <header class="xz-todo-card__head">
        <h3>待办清单</h3>
        {#if todos.length > 0}
            <span class="xz-todo-card__count">
                {todos.length} 条 · 未完成 {openTodos(todos).length} · 已完成 {completedTodoCount(todos)}
                {#if droppedTodoCount(todos) > 0}· 已放弃 {droppedTodoCount(todos)}{/if}
            </span>
        {/if}
        <span class="xz-todo-card__actions">
            {#if multiSelect}
                <button class="b3-button b3-button--outline xz-todo-card__mini" type="button" disabled={disabled || selectedCount === 0} on:click={sendSelectedToToday}>
                    放进今天{selectedCount > 0 ? `（${selectedCount}）` : ""}
                </button>
                <button class="b3-button b3-button--outline xz-todo-card__mini" type="button" disabled={disabled || selectedCount === 0} on:click={() => { for (const id of selectedIds) dispatch("dropped", { id }); exitMultiSelect(); }}>全部打叉</button>
                <button class="b3-button b3-button--outline xz-todo-card__mini" type="button" on:click={exitMultiSelect}>退出多选</button>
            {:else}
                {#if todos.length > 1}
                    <button class="xz-todo-card__link" type="button" on:click={() => (multiSelect = true)}>多选</button>
                {/if}
                <button class="b3-button b3-button--outline xz-todo-card__mini" type="button" disabled={disabled} on:click={() => { draft = ""; queueMicrotask(() => document.getElementById("xz-todo-draft")?.focus()); }}>＋ 添加待办</button>
            {/if}
        </span>
    </header>

    {#if progress.total > 0}
        <div class="xz-todo-progress">
            <span>
                已完成 {progress.done}/{progress.denominator}
                {#if progress.dropped > 0}（放弃项不计入分母）{/if}
            </span>
            <span class="xz-todo-progress__bar" role="img" aria-label={`已完成 ${progress.percent}%`}>
                <i class="xz-todo-progress__done" style={`width:${progress.percent}%`}></i>
                <i class="xz-todo-progress__drop" style={`width:${progress.denominator ? Math.round(progress.dropped / progress.total * 100) : 0}%;left:${progress.percent}%`}></i>
            </span>
            <span>{progress.percent}%</span>
        </div>
    {/if}

    <div class="xz-todo-card__body">
        {#if todos.length === 0}
            <p class="xz-todo-empty">还没有待办。可以把细则里的步骤拆进来，或先写第一条。</p>
        {/if}

        {#each visible as todo (todo.id)}
            <article class="xz-todo" class:xz-todo--open={todo.status === "open"} class:xz-todo--done={todo.status === "done"} class:xz-todo--dropped={todo.status === "dropped"} class:xz-todo--picked={selectedIds.has(todo.id)}>
                <div class="xz-todo__row">
                    {#if multiSelect}
                        <input class="xz-todo__pick" type="checkbox" aria-label={`选择待办 ${todo.text}`} checked={selectedIds.has(todo.id)} on:change={() => toggleSelected(todo.id)} />
                    {/if}
                    <button
                        class="xz-todo__box"
                        class:xz-todo__box--done={todo.status === "done"}
                        class:xz-todo__box--dropped={todo.status === "dropped"}
                        type="button"
                        disabled={disabled}
                        aria-label={`${todo.status === "done" ? "撤销完成" : "标记完成"}：${todo.text}`}
                        title={todo.status === "done" ? "已完成，点击可撤销" : "勾选＝完成"}
                        on:click={() => dispatch("done", { id: todo.id })}
                    >{todo.status === "done" ? "✓" : todo.status === "dropped" ? "✕" : ""}</button>

                    <span class="xz-todo__text" title={todo.text}>{todo.text}</span>

                    {#if !compact && todo.status === "open" && todo.createdAt}
                        <span class="xz-todo__meta">{relativeDay(todo.updatedAt ?? todo.createdAt)}</span>
                    {:else if !compact && todo.status === "done"}
                        <span class="xz-todo__meta">{completedLabel(todo)}</span>
                    {:else if !compact && todo.status === "dropped"}
                        <span class="xz-todo__meta">已放弃{todo.droppedReason ? ` · ${todo.droppedReason}` : ""}</span>
                    {/if}

                    <span class="xz-todo__actions">
                        {#if todo.status === "open"}
                            <button class="xz-todo__link" type="button" disabled={disabled} title="把这一条放进今天这一片" on:click={() => dispatch("today", { ids: [todo.id] })}>放进今天</button>
                        {/if}
                        {#if todo.status === "dropped"}
                            <button class="xz-todo__link" type="button" disabled={disabled} on:click={() => dispatch("restore", { id: todo.id })}>恢复</button>
                        {/if}
                        <button
                            class="xz-todo__icon"
                            class:xz-todo__icon--on={expandedId === todo.id}
                            type="button"
                            aria-expanded={expandedId === todo.id}
                            aria-label={`${expandedId === todo.id ? "收起" : "展开"}待办 ${todo.text}`}
                            title={expandedId === todo.id ? "收起详情" : "展开详情"}
                            on:click={() => toggleExpanded(todo.id)}
                        >{expandedId === todo.id ? "⌃" : "⌄"}</button>
                        {#if todo.status !== "dropped"}
                            <button class="xz-todo__icon" type="button" disabled={disabled} aria-label={`放弃：${todo.text}`} title="放弃（打叉，可撤销）" on:click={() => dispatch("dropped", { id: todo.id })}>✕</button>
                        {/if}
                    </span>
                </div>

                {#if expandedId === todo.id}
                    <div class="xz-todo__drawer">
                        <label class="xz-todo__field">
                            <span>备注 · 结果</span>
                            <textarea
                                class="b3-text-field xz-todo__input"
                                rows="2"
                                placeholder="做到哪一步、遇到什么、结论是什么"
                                disabled={disabled}
                                bind:value={noteDrafts[todo.id]}
                                on:blur={() => saveDetail(todo.id)}
                            ></textarea>
                        </label>
                        <label class="xz-todo__field">
                            <span>参考链接（每行一条）</span>
                            <textarea
                                class="b3-text-field xz-todo__input"
                                rows="2"
                                placeholder="https://…"
                                disabled={disabled}
                                bind:value={linkDrafts[todo.id]}
                                on:blur={() => saveDetail(todo.id)}
                            ></textarea>
                        </label>
                        <div class="xz-todo__drawer-foot">
                            <span class="xz-todo__meta">创建于 {relativeDay(todo.createdAt)}</span>
                            <span class="xz-todo__drawer-actions">
                                <button class="b3-button b3-button--outline xz-todo-card__mini" type="button" disabled={disabled} on:click={() => dispatch("remove", { id: todo.id })}>删除这一条</button>
                                <button class="b3-button b3-button--outline xz-todo-card__mini" type="button" on:click={() => (expandedId = null)}>收起</button>
                            </span>
                        </div>
                    </div>
                {/if}
            </article>
        {/each}

        <div class="xz-todo-card__foot">
            <!-- 用 textarea 而不是 input：粘贴多行文本时 input 会把换行吃掉，无法一次生成多条 -->
            <textarea
                id="xz-todo-draft"
                class="b3-text-field xz-todo__draft"
                rows="1"
                placeholder="添加待办，回车继续；粘贴多行文本可一次生成多条"
                disabled={disabled}
                bind:value={draft}
                on:keydown={handleDraftKeydown}
                on:blur={submitDraft}
            ></textarea>
            <button class="b3-button b3-button--outline xz-todo-card__mini" type="button" disabled={disabled || !draft.trim()} on:click={submitDraft}>添加</button>
            {#if droppedTodoCount(todos) > 0}
                <button class="xz-todo-card__link" type="button" on:click={() => (showDropped = !showDropped)}>
                    {showDropped ? "隐藏已放弃" : `显示已放弃 ${droppedTodoCount(todos)} 条`}
                </button>
            {/if}
        </div>
    </div>
</section>
