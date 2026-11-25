<script lang="ts">
    /**
     * 记录／编辑一条断点。
     *
     * 三条硬要求：
     * ① 十秒填得完：只有「做到哪」必填，其余留空就是「待定 / 没记」，不制造必填感；
     * ② 入口是点出来的，不是打出来的：优先列出「用过的入口」（带图标），一点即填；
     * ③ 上一条的下一步以灰字放在表单顶上——不是要你抄，是让你知道刚才停在哪。
     */
    import { createEventDispatcher } from "svelte";
    import EntryIcon from "./EntryIcon.svelte";
    import type { ActionCheckpoint, ActionEntryPoint } from "./action-detail";
    import { ENTRY_TYPES, entryTypeLabel, type EntryUsage } from "./entry-points";
    import { autoResizeTextarea } from "./textarea-autosize";

    export let initial: ActionCheckpoint;
    /** 用过的入口；本工作项的排前面 */
    export let usages: EntryUsage[] = [];
    /** 当前工作项 id：用来判断「这个入口是不是本工作项用过的」 */
    export let currentItemId: string | null = null;
    /** 展示「上一条的下一步」，给出上下文（不预填） */
    export let prevNext = "";
    export let modeLabel = "记一次断点";
    export let nowLabel = "";
    export let disabled = false;
    /** 打开时就展开「新建入口」的输入 */
    export let pickerOpen = false;

    const dispatch = createEventDispatcher<{
        save: { value: ActionCheckpoint };
        cancel: Record<string, never>;
    }>();

    let did = initial.did;
    let stuck = initial.stuck;
    let next = initial.next;
    let payload = initial.payload;
    let starred = initial.starred;
    let entry: ActionEntryPoint | null = initial.entry;
    let creating = pickerOpen;
    let stuckOpen = Boolean(initial.stuck);
    let showAll = false;
    let draftType = "vscode";
    let draftLabel = "";
    let draftTarget = "";

    $: canSave = did.trim().length > 0;
    /* 常用的就摆在明面上：前 4 个一点即填，其余收进「更多」 */
    $: visibleUsages = showAll ? usages : usages.slice(0, 4);
    $: moreCount = Math.max(0, usages.length - visibleUsages.length);

    function useUsage(item: EntryUsage) {
        entry = { type: item.type, label: item.label, target: item.target };
        creating = false;
    }

    function createEntry() {
        const label = draftLabel.trim();
        if (!label) return;
        entry = { type: draftType, label, target: draftTarget.trim() };
        creating = false;
        draftLabel = "";
        draftTarget = "";
    }

    function submit() {
        if (!canSave || disabled) return;
        dispatch("save", {
            value: {
                ...initial,
                did: did.trim(),
                stuck: stuck.trim(),
                next: next.trim(),
                payload,
                starred,
                entry,
            },
        });
    }
</script>

<form class="xz-cpf" on:submit|preventDefault={submit} data-cpf>
    <header class="xz-cpf__head">
        <h4>{modeLabel}</h4>
        <span class="xz-cpf__when">{nowLabel}</span>
        <button class="xz-plan-field__edit" type="button" on:click={() => dispatch("cancel", {})}>取消</button>
    </header>

    {#if prevNext}
        <p class="xz-cpf__prev"><span>上一条的下一步</span>{prevNext}</p>
    {/if}

    <label class="xz-cpf__field">
        <span class="xz-cpf__key">做到哪<i>必填</i></span>
        <textarea
            class="b3-text-field xz-cpf__input xz-cpf__input--area"
            rows="2"
            bind:value={did}
            {disabled}
            placeholder="这次做到哪了？停在哪一步？"
            data-cpf-did
        ></textarea>
    </label>

    {#if stuckOpen}
        <label class="xz-cpf__field">
            <span class="xz-cpf__key">卡在哪<i>可选 · 一行一个</i></span>
            <textarea
                class="b3-text-field xz-cpf__input xz-cpf__input--area xz-cpf__stuck"
                rows="1"
                bind:value={stuck}
                use:autoResizeTextarea={stuck}
                {disabled}
                placeholder="一行一个卡点，例如：第一条建立在错误事实上；府里世界词错误"
                data-cpf-stuck
            ></textarea>
            <span class="xz-cpf__stuck-hint">回车换行＝另一个卡点；回来时按行显示，每条单独一行</span>
        </label>
    {:else}
        <button class="xz-cpf__link" type="button" on:click={() => (stuckOpen = true)}>＋ 记一下卡点</button>
    {/if}

    <label class="xz-cpf__field">
        <span class="xz-cpf__key">下一步</span>
        <input
            class="b3-text-field xz-cpf__input"
            type="text"
            bind:value={next}
            {disabled}
            placeholder="下次接着做什么——想不清楚可以留空，显示为「待定」"
        />
    </label>

    <div class="xz-cpf__field">
        <span class="xz-cpf__key">入口<i>从哪继续</i></span>

        {#if entry}
            <div class="xz-cpf__entry-set">
                <span class="xz-cp-entry">
                    <EntryIcon type={entry.type} />
                    <span class="xz-cp-entry__label">{entry.label}</span>
                    {#if entry.target}<span class="xz-cp-entry__target">{entry.target}</span>{/if}
                </span>
                <button class="xz-cp-act" type="button" on:click={() => (entry = null)}>换一个</button>
            </div>
        {:else}
            {#if usages.length > 0}
                <div class="xz-cpf__usages" data-cpf-usages>
                    <span class="xz-cpf__usages-hint">用过的</span>
                    {#each visibleUsages as item (item.key)}
                        <button
                            class="xz-cpf__usage"
                            type="button"
                            title={`${item.target}${item.itemId === currentItemId ? "" : `\n来自：${item.itemTitle}`}`}
                            on:click={() => useUsage(item)}
                        >
                            <EntryIcon type={item.type} size={13} />
                            <span class="xz-cpf__usage-label">{item.label}</span>
                            {#if item.itemId !== currentItemId}<span class="xz-cpf__usage-from">· {item.itemTitle}</span>{/if}
                        </button>
                    {/each}
                    {#if moreCount > 0}
                        <button class="xz-cp-act" type="button" on:click={() => (showAll = true)}>更多 {moreCount}</button>
                    {/if}
                </div>
            {/if}
            <button class="xz-cpf__entry-empty" type="button" on:click={() => (creating = !creating)} data-cpf-entry-empty>
                ＋ 新建一个入口（文件、对话、笔记、终端…）
            </button>
        {/if}

        {#if creating && !entry}
            <div class="xz-cpf__picker" data-cpf-picker>
                <div class="xz-cpf__picker-new">
                    <select class="b3-text-field xz-cpf__input xz-cpf__select" bind:value={draftType} aria-label="入口类型">
                        {#each ENTRY_TYPES as item (item.value)}<option value={item.value}>{item.label}</option>{/each}
                    </select>
                    <input class="b3-text-field xz-cpf__input" type="text" bind:value={draftLabel} placeholder="名称，例如 GRB_Localization.ipynb" aria-label="入口名称" />
                    <input class="b3-text-field xz-cpf__input" type="text" bind:value={draftTarget} placeholder="位置（路径／网址／块 id）" aria-label="入口位置" />
                    <button class="b3-button b3-button--outline xz-cpf__mini" type="button" disabled={!draftLabel.trim()} on:click={createEntry}>用这个</button>
                </div>
                <p class="xz-cpf__picker-note">思源里能直接打开网页和思源块；本地路径只显示位置，由你自己打开。</p>
            </div>
        {/if}

        {#if entry && entry.type === "other"}
            <p class="xz-cpf__picker-note">「{entryTypeLabel(entry.type)}」这类入口只作提示，界面上不提供打开。</p>
        {/if}
    </div>

    <label class="xz-cpf__field">
        <span class="xz-cpf__key">交接内容<i>下次开工前要带走的</i></span>
        <textarea
            class="b3-text-field xz-cpf__input xz-cpf__input--area"
            rows="2"
            bind:value={payload}
            {disabled}
            placeholder="趁现在还记得就写下：下次要粘给 AI 的、或者你自己要照做的步骤（可留空）"
        ></textarea>
    </label>

    <footer class="xz-cpf__foot">
        <button class="b3-button b3-button--text xz-cpf__save" type="submit" disabled={disabled || !canSave} data-cpf-save>保存断点</button>
        <label class="xz-cpf__star">
            <input type="checkbox" bind:checked={starred} {disabled} />
            顺带标为阶段性成果
        </label>
        <span class="xz-cpf__hint">只有「做到哪」必填</span>
    </footer>
</form>
