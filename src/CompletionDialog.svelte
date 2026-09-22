<script lang="ts">
    /**
     * 完成事务前的强制处置层。
     *
     * 为什么不是硬拦截：切片一旦记为错过／放弃就永远不会再变成完成，
     * 硬拦截会让「放弃过切片的事务」永远无法完成、也无法放弃，只能删掉。
     * 所以这里只做一件事——把未完成项列清楚，让你显式选一种处置方式。
     */
    import { createEventDispatcher } from "svelte";
    import type { CompletionBlockers, CompletionDisposition } from "./completion";

    export let title = "";
    export let blockers: CompletionBlockers;
    export let disabled = false;
    export let error = "";

    const dispatch = createEventDispatcher<{
        confirm: { disposition: CompletionDisposition; reason: string };
        cancel: Record<string, never>;
    }>();

    let disposition: CompletionDisposition = "drop-unfinished";
    let reason = "";
</script>

<div class="xz-dialog-backdrop" role="presentation" on:click|self={() => !disabled && dispatch("cancel", {})}>
    <section class="xz-complete-dialog" role="dialog" aria-modal="true" aria-labelledby="xz-complete-title">
        <span class="xz-section-kicker">完成事务</span>
        <h2 id="xz-complete-title">“{title}”还有 {blockers.summary} 未完成</h2>
        <p>事务结束由你决定。这里只需要先把未完成项处置掉，避免它们静默消失——已放弃或错过的切片不会再变成完成，所以不能靠“等它做完”来解锁。</p>

        {#if blockers.slices.length > 0}
            <div class="xz-complete-group">
                <h4>未完成的执行切片（{blockers.slices.length}）</h4>
                <ul>
                    {#each blockers.slices as slice (slice.id)}
                        <li><span class="xz-chip">{slice.status === "missed" ? "错过" : "已安排"}</span>{slice.scheduledDate}</li>
                    {/each}
                </ul>
            </div>
        {/if}

        {#if blockers.todos.length > 0}
            <div class="xz-complete-group">
                <h4>未完成的待办（{blockers.todos.length}）</h4>
                <ul>
                    {#each blockers.todos as todo (todo.id)}
                        <li><span class="xz-chip xz-chip--ghost">待办</span>{todo.text}</li>
                    {/each}
                </ul>
            </div>
        {/if}

        <p class="xz-complete-hint">选择一种处置方式：</p>
        <label class="xz-complete-option" class:xz-complete-option--picked={disposition === "drop-unfinished"}>
            <input type="radio" name="xz-complete-disposition" value="drop-unfinished" bind:group={disposition} />
            <span><strong>全部标为放弃后完成</strong><span>切片记为已放弃、待办打叉（都保留痕迹、可撤销），然后完成事务。适合“这件事就到这里”。</span></span>
        </label>
        <label class="xz-complete-option" class:xz-complete-option--picked={disposition === "keep-outstanding"}>
            <input type="radio" name="xz-complete-disposition" value="keep-outstanding" bind:group={disposition} />
            <span><strong>保留为未完成收尾，直接完成</strong><span>不动切片和待办，只在事务的当前状态里记一条“遗留 N 项”，复盘时能看到。</span></span>
        </label>
        <label class="xz-complete-option" class:xz-complete-option--picked={disposition === "reason"}>
            <input type="radio" name="xz-complete-disposition" value="reason" bind:group={disposition} />
            <span><strong>记录原因后完成</strong><span>适合被迫收尾：写一句“为什么现在结束”，与遗留清单一起留在当前状态里。</span></span>
        </label>
        {#if disposition === "reason"}
            <input class="b3-text-field xz-complete-reason" type="text" placeholder="为什么现在结束？" bind:value={reason} disabled={disabled} />
        {/if}

        {#if error}<p class="xz-action-error" role="alert">{error}</p>{/if}

        <div class="xz-complete-actions">
            <button class="b3-button b3-button--outline" type="button" disabled={disabled} on:click={() => dispatch("cancel", {})}>取消</button>
            <span class="xz-complete-actions__spacer"></span>
            {#if disposition === "drop-unfinished"}
                <button class="b3-button b3-button--outline" type="button" disabled={disabled} on:click={() => dispatch("confirm", { disposition: "keep-outstanding", reason: "" })}>先保留，直接完成</button>
            {/if}
            <button class="b3-button" type="button" disabled={disabled} on:click={() => dispatch("confirm", { disposition, reason })}>
                {disabled ? "正在完成…" : "处置并完成事务"}
            </button>
        </div>
    </section>
</div>
