<script lang="ts">
    import { boundaryRelativeLabel, boundarySummary, type ChecklistBoundaryAttention, type ChecklistBoundaryItem } from "./checklist-boundary";

    export let attention: ChecklistBoundaryAttention;
    export let saving = false;
    export let error = "";
    /** 当前记录日期是不是今天：过去的日期不按时间催办，只做提示。 */
    export let isToday = true;
    /** 没有到点的项最多直接列出几条（其余收进折叠提示）。 */
    export let laterPreviewCount = 3;
    export let onToggle: (key: string, completed: boolean) => void;
    export let onOpenChecklist: () => void;

    function statusLabel(minutesFromNow: number): string {
        return minutesFromNow >= 0 ? `该做了 · ${boundaryRelativeLabel(minutesFromNow)}` : boundaryRelativeLabel(minutesFromNow);
    }

    function toggle(key: string, completed: boolean) {
        if (saving) return;
        onToggle(key, !completed);
    }

    /*
     * 「还没到点」的项也要直接列出来，而不是只报一个数量。
     * 这个面板存在的意义就是对抗遗忘，如果一天里大部分时间它只显示一行字，
     * 那它跟没有一样——你打开今日记录时看到的应该是「接下来该确认什么」。
     */
    $: laterPreview = attention.later.slice(0, laterPreviewCount);
    $: laterRest = Math.max(0, attention.later.length - laterPreview.length);
    $: headline = attention.items.length
        ? (isToday ? boundarySummary(attention) : `这一天有 ${attention.items.length} 项边界提醒`)
        : attention.laterPreviewHeadline;
    /* 有内容可看就不要退化成一行提示：只有真的没有边界项、或今天的都处理完且没有后续时才收起来 */
    $: compactEmpty = !attention.totalCount || (!attention.items.length && !attention.later.length);
</script>

<!--
  边界提醒面板：按时间浮出「成段流程里容易漏掉的离散事件」。
  放在记录卡顶部、待补项目之前——它属于「现在该做什么」，而不是「回头补什么」。
  三类行：逾期／即将到来（可确认）、尚未到点（muted 预览）、已完成（留痕可撤销）。
-->
{#if compactEmpty}
    <section class="xz-daily-boundary-panel is-empty" aria-label="边界提醒">
        <p class="xz-boundary-empty">
            {#if !attention.totalCount}今天没有需要单独确认的边界提醒。{:else}今天的边界提醒都确认完了（{attention.doneCount}/{attention.totalCount}），今天不再有后续项。{/if}
        </p>
    </section>
{:else}
    <section class="xz-daily-boundary-panel" aria-label="边界提醒">
        <header>
            <div>
                <strong>{headline}</strong>
                <small>按时间浮出；勾选与「每日 Checklist」共用同一份状态，任一处确认另一处立即一致。</small>
            </div>
            <div class="xz-boundary-actions">
                <button type="button" class="xz-boundary-link" on:click={onOpenChecklist}>去 Checklist 看今天 ›</button>
            </div>
        </header>
        {#if error}<p class="xz-boundary-error" role="alert">{error}</p>{/if}
        {#if !isToday}
            <p class="xz-boundary-note">这不是今天的记录，下面只列出当天配置过的边界项，不作为催办。</p>
        {/if}
        <ul class="xz-boundary-list">
            {#each attention.items as item (item.key)}
                <li class="xz-boundary-item is-{item.status}">
                    <span class="xz-boundary-item__time">{item.at}</span>
                    <span class="xz-boundary-item__body">
                        <strong title={item.entryTitle}>{item.entryTitle}</strong>
                        <small>{isToday ? `${statusLabel(item.minutesFromNow)} · ${item.reminder}` : item.reminder}</small>
                    </span>
                    <button
                        class="xz-boundary-item__done"
                        type="button"
                        aria-pressed="false"
                        title="确认已做（再点一次可撤销）"
                        disabled={saving}
                        on:click={() => toggle(item.key, false)}
                    >○ 已做</button>
                </li>
            {/each}
            {#each laterPreview as item (item.key)}
                <li class="xz-boundary-item is-later">
                    <span class="xz-boundary-item__time">{item.at}</span>
                    <span class="xz-boundary-item__body">
                        <strong title={item.entryTitle}>{item.entryTitle}</strong>
                        <small title={item.reminder}>{isToday ? `还没到点 · ${item.reminder}` : item.reminder}</small>
                    </span>
                    <button
                        class="xz-boundary-item__done"
                        type="button"
                        aria-pressed="false"
                        title="提前确认已做"
                        disabled={saving}
                        on:click={() => toggle(item.key, false)}
                    >○ 已做</button>
                </li>
            {/each}
            {#each attention.doneKeys as item (item.key)}
                <li class="xz-boundary-item is-done">
                    <span class="xz-boundary-item__time">{item.at}</span>
                    <span class="xz-boundary-item__body">
                        <strong title={item.entryTitle}>{item.entryTitle}</strong>
                        <small>已完成</small>
                    </span>
                    <button
                        class="xz-boundary-item__done"
                        type="button"
                        aria-pressed="true"
                        title="撤销确认"
                        disabled={saving}
                        on:click={() => toggle(item.key, true)}
                    >✓ 已确认</button>
                </li>
            {/each}
        </ul>
        {#if laterRest}
            <p class="xz-boundary-more">今天还有 {laterRest} 项更晚的边界提醒，到点会自动排到前面。</p>
        {/if}
    </section>
{/if}
