<script lang="ts">
    import { tick } from "svelte";
    import {
        cloneChecklistStore,
        createDefaultChecklistStore,
        updateChecklistDayState,
        updateChecklistStore,
        type ChecklistEntry,
        type ChecklistStore,
        type ChecklistTemplate,
        type ChecklistTemplateId,
        type ChecklistTone,
        type ChecklistTrainingMode,
        type ChecklistViewMode,
    } from "./checklist";

    export let date: string;
    export let loadChecklist: () => Promise<ChecklistStore>;
    export let saveChecklist: (store: ChecklistStore) => Promise<ChecklistStore>;

    let store = createDefaultChecklistStore();
    let loading = true;
    let saving = false;
    let error = "";
    let editorOpen = false;
    let printing = false;
    let editingId = "";
    let editTime = "";
    let editTitle = "";
    let editReminders = "";
    let editTrainingReminders = "";
    let editRestReminders = "";
    let editHasTrainingChoices = false;
    let editTone: ChecklistTone = "plain";
    let lastDate = date;
    let checked = new Set<string>();
    let trainingMode: ChecklistTrainingMode = "";
    let saveSequence = 0;

    $: templateId = templateIdForDate(date);
    $: template = store.templates.find((candidate) => candidate.id === templateId) ?? store.templates[0];
    $: allReminderKeys = template.entries.flatMap((item) => visibleReminders(item, trainingMode).map((reminder) => reminder.key));
    $: completedCount = allReminderKeys.filter((key) => checked.has(key)).length;
    $: completionPercent = allReminderKeys.length ? Math.round(completedCount / allReminderKeys.length * 100) : 0;
    $: paperColumns = splitPaperEntries(template);
    $: if (date !== lastDate) {
        lastDate = date;
        hydrateDayState(date);
    }

    Promise.resolve().then(async () => {
        try {
            store = cloneChecklistStore(await loadChecklist());
            hydrateDayState(date);
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        } finally {
            loading = false;
        }
    });

    function hydrateDayState(currentDate: string) {
        const state = store.dayStates.find((candidate) => candidate.date === currentDate);
        checked = new Set(state?.checkedKeys ?? []);
        trainingMode = state?.trainingMode ?? "";
    }

    function toggleCheck(key: string) {
        const nextChecked = new Set(checked);
        if (nextChecked.has(key)) nextChecked.delete(key);
        else nextChecked.add(key);
        checked = nextChecked;
        void persistDayState();
    }

    function chooseTrainingMode(mode: Exclude<ChecklistTrainingMode, "">) {
        trainingMode = mode;
        void persistDayState();
    }

    function visibleReminders(item: ChecklistEntry, mode: ChecklistTrainingMode): Array<{ key: string; text: string }> {
        const common = item.reminders.map((text, index) => ({ key: `${item.id}:common:${index}`, text }));
        if (!item.trainingChoices || !mode) return common;
        return [
            ...common,
            ...item.trainingChoices[mode].map((text, index) => ({ key: `${item.id}:${mode}:${index}`, text })),
        ];
    }

    async function changeViewMode(viewMode: ChecklistViewMode) {
        if (store.viewMode === viewMode || saving) return;
        await persist(updateChecklistStore(store, { viewMode }));
    }

    async function persistDayState(): Promise<void> {
        const next = updateChecklistDayState(store, date, checked, trainingMode);
        await persist(next);
    }

    function openEditor(entry?: ChecklistEntry) {
        const selected = entry ?? template.entries[0];
        editingId = selected?.id ?? "";
        editTime = selected?.time ?? "";
        editTitle = selected?.title ?? "";
        editReminders = selected?.reminders.join("\n") ?? "";
        editHasTrainingChoices = Boolean(selected?.trainingChoices);
        editTrainingReminders = selected?.trainingChoices?.training.join("\n") ?? "";
        editRestReminders = selected?.trainingChoices?.rest.join("\n") ?? "";
        editTone = selected?.tone ?? "plain";
        editorOpen = true;
    }

    function createEntry() {
        editingId = "";
        editTime = "";
        editTitle = "";
        editReminders = "";
        editTrainingReminders = "";
        editRestReminders = "";
        editHasTrainingChoices = false;
        editTone = "plain";
        editorOpen = true;
    }

    async function saveEntry() {
        const time = editTime.trim();
        const title = editTitle.trim();
        const reminders = editReminders.split("\n").map((value) => value.trim()).filter(Boolean);
        const training = editTrainingReminders.split("\n").map((value) => value.trim()).filter(Boolean);
        const rest = editRestReminders.split("\n").map((value) => value.trim()).filter(Boolean);
        const trainingChoices = editHasTrainingChoices && training.length && rest.length ? { training, rest } : undefined;
        if (!time || !title || (!reminders.length && !trainingChoices) || (editHasTrainingChoices && !trainingChoices)) {
            error = editHasTrainingChoices ? "时间节点、标题、训练日提醒和休息日提醒都不能为空。" : "时间节点、标题和至少一条提醒不能为空。";
            return;
        }
        const next = cloneChecklistStore(store);
        const target = next.templates.find((candidate) => candidate.id === template.id);
        if (!target) return;
        if (editingId) {
            const index = target.entries.findIndex((candidate) => candidate.id === editingId);
            if (index >= 0) target.entries[index] = { id: target.entries[index].id, time, title, reminders, tone: editTone, ...(trainingChoices ? { trainingChoices } : {}) };
        } else {
            target.entries.push({ id: createEntryId(), time, title, reminders, tone: editTone });
        }
        if (await persist(updateChecklistStore(next, { templates: next.templates }))) editorOpen = false;
    }

    async function deleteEntry() {
        if (!editingId) return;
        const next = cloneChecklistStore(store);
        const target = next.templates.find((candidate) => candidate.id === template.id);
        if (!target || target.entries.length <= 1) {
            error = "每个模板至少需要保留一个时间节点。";
            return;
        }
        target.entries = target.entries.filter((candidate) => candidate.id !== editingId);
        if (await persist(updateChecklistStore(next, { templates: next.templates }))) editorOpen = false;
    }

    async function moveEntry(entryId: string, offset: number) {
        const next = cloneChecklistStore(store);
        const target = next.templates.find((candidate) => candidate.id === template.id);
        if (!target) return;
        const index = target.entries.findIndex((candidate) => candidate.id === entryId);
        const destination = index + offset;
        if (index < 0 || destination < 0 || destination >= target.entries.length) return;
        const [entry] = target.entries.splice(index, 1);
        target.entries.splice(destination, 0, entry);
        await persist(updateChecklistStore(next, { templates: next.templates }));
    }

    async function persist(next: ChecklistStore): Promise<boolean> {
        const previous = cloneChecklistStore(store);
        const sequence = ++saveSequence;
        store = cloneChecklistStore(next);
        saving = true;
        error = "";
        try {
            const saved = cloneChecklistStore(await saveChecklist(next));
            if (sequence === saveSequence) store = saved;
            return true;
        } catch (caught) {
            if (sequence === saveSequence) store = previous;
            error = caught instanceof Error ? caught.message : String(caught);
            return false;
        } finally {
            if (sequence === saveSequence) saving = false;
        }
    }

    function templateIdForDate(value: string): ChecklistTemplateId {
        const weekday = new Date(`${value}T12:00:00`).getDay();
        return weekday === 6 ? "saturday" : weekday === 0 ? "sunday" : "workday";
    }

    function formatDate(value: string): string {
        const parsed = new Date(`${value}T12:00:00`);
        return `${parsed.getFullYear()} 年 ${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日`;
    }

    function weekdayLabel(value: string): string {
        return ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][new Date(`${value}T12:00:00`).getDay()];
    }

    function splitPaperEntries(currentTemplate: ChecklistTemplate): [ChecklistEntry[], ChecklistEntry[]] {
        const preferredSplit = currentTemplate.id === "workday" ? 9 : currentTemplate.id === "saturday" ? 7 : 8;
        const splitAt = Math.min(Math.max(1, preferredSplit), Math.max(1, currentTemplate.entries.length - 1));
        return [currentTemplate.entries.slice(0, splitAt), currentTemplate.entries.slice(splitAt)];
    }

    function createEntryId(): string {
        return `check-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    }

    async function printChecklist() {
        printing = true;
        await tick();
        window.print();
        printing = false;
    }
</script>

{#if loading}
    <div class="xz-state"><span class="xz-spinner"></span><p>正在读取 Checklist 模板……</p></div>
{:else}
    <section class="xz-checklist-page" on:input|stopPropagation on:change|stopPropagation>
        <header class="xz-checklist-header">
            <div>
                <span class="xz-section-kicker">当日提醒，不进入历史数据</span>
                <h2>每日行动 Checklist</h2>
                <p>{template.label} · {template.subtitle}</p>
            </div>
            <div class="xz-checklist-actions">
                <div class="xz-checklist-view-switch" aria-label="显示方式">
                    <span>显示方式</span>
                    <button class:active={store.viewMode === "xingzhou"} type="button" on:click={() => void changeViewMode("xingzhou")}>行舟视图</button>
                    <button class:active={store.viewMode === "paper"} type="button" on:click={() => void changeViewMode("paper")}>纸质视图</button>
                </div>
                <button type="button" on:click={() => createEntry()}>＋ 新增时间节点</button>
                <button type="button" on:click={printChecklist}>打印清单</button>
            </div>
        </header>

        {#if error}<p class="xz-checklist-error" role="alert">{error}</p>{/if}

        {#if store.viewMode === "xingzhou" && !printing}
            <div class="xz-checklist-native-layout">
                <article class="xz-checklist-native-list">
                    <header>
                        <div><h3>{formatDate(date)}</h3><p>{weekdayLabel(date)} · {template.label}</p></div>
                        <span>当日勾选会自动保存</span>
                    </header>
                    <div class="xz-checklist-native-entries">
                        {#each template.entries as item, entryIndex (item.id)}
                            <section class="xz-checklist-native-entry">
                                <div class="xz-checklist-native-time">{item.time}</div>
                                <div class="xz-checklist-native-content">
                                    <div class="xz-checklist-native-title">
                                        <strong>{item.title}</strong>
                                        <span>{visibleReminders(item, trainingMode).length} 项提醒</span>
                                        <div>
                                            <button type="button" aria-label="上移" disabled={entryIndex === 0 || saving} on:click={() => void moveEntry(item.id, -1)}>↑</button>
                                            <button type="button" aria-label="下移" disabled={entryIndex === template.entries.length - 1 || saving} on:click={() => void moveEntry(item.id, 1)}>↓</button>
                                            <button type="button" on:click={() => openEditor(item)}>编辑</button>
                                        </div>
                                    </div>
                                    {#if item.trainingChoices}
                                        <div class="xz-checklist-training-choice">
                                            <span>今天怎么安排？</span>
                                            <button class:active={trainingMode === "training"} type="button" on:click={() => chooseTrainingMode("training")}>训练日</button>
                                            <button class:active={trainingMode === "rest"} type="button" on:click={() => chooseTrainingMode("rest")}>休息日</button>
                                            {#if !trainingMode}<small>先选一种，当天可随时切换</small>{/if}
                                        </div>
                                    {/if}
                                    <div class="xz-checklist-native-reminders">
                                        {#each visibleReminders(item, trainingMode) as reminder (reminder.key)}
                                            <label class:checked={checked.has(reminder.key)}>
                                                <input type="checkbox" checked={checked.has(reminder.key)} on:change={() => toggleCheck(reminder.key)} />
                                                <span>{reminder.text}</span>
                                            </label>
                                        {/each}
                                    </div>
                                </div>
                            </section>
                        {/each}
                    </div>
                </article>
                <aside class="xz-checklist-summary">
                    <h3>今日进度</h3>
                    <strong>{completionPercent}%</strong>
                    <span>{completedCount} / {allReminderKeys.length} 项</span>
                    <div class="xz-checklist-progress"><i style={`width:${completionPercent}%`}></i></div>
                    <p>Checklist 只负责提醒。需要记录的结果、时长和观察仍在“今日记录”中填写。</p>
                </aside>
            </div>
        {:else}
            <div class="xz-checklist-paper-layout">
                <article class="xz-checklist-paper">
                    <header>
                        <div><h3>改变 2026 · 每日行动 CHECKLIST</h3><p>{template.label}｜{template.subtitle}</p></div>
                        <dl><dt>日期</dt><dd>{formatDate(date)}</dd><dt>星期</dt><dd>{weekdayLabel(date)}</dd></dl>
                    </header>
                    <p class="xz-checklist-paper-intro">做完即可，不追求全部完美；下班后可做低压力工作闭环，但不重新进入执行状态。</p>
                    <div class="xz-checklist-paper-progress"><span>今日完成 {completedCount} / {allReminderKeys.length}</span><i><b style={`width:${completionPercent}%`}></b></i><span>{completionPercent}%</span></div>
                    <div class="xz-checklist-paper-columns">
                        {#each paperColumns as column}
                            <div>
                                {#each column as item (item.id)}
                                    <section class:mint={item.tone === "mint"} class:sand={item.tone === "sand"} class:rose={item.tone === "rose"}>
                                        <header><span>{item.time}</span><strong>{item.title}</strong><button type="button" on:click={() => openEditor(item)}>编辑</button></header>
                                        {#if item.trainingChoices}
                                            <div class="xz-checklist-training-choice paper">
                                                <span>今日安排</span>
                                                <button class:active={trainingMode === "training"} type="button" on:click={() => chooseTrainingMode("training")}>训练日</button>
                                                <button class:active={trainingMode === "rest"} type="button" on:click={() => chooseTrainingMode("rest")}>休息日</button>
                                            </div>
                                        {/if}
                                        {#each visibleReminders(item, trainingMode) as reminder (reminder.key)}
                                            <label class:checked={checked.has(reminder.key)}>
                                                <input type="checkbox" checked={checked.has(reminder.key)} on:change={() => toggleCheck(reminder.key)} />
                                                <span>{reminder.text}</span>
                                            </label>
                                        {/each}
                                    </section>
                                {/each}
                            </div>
                        {/each}
                    </div>
                    <footer><span>仅用于提醒与勾选；评估数据仍在生活节律中完成。</span><span>{template.label}模板</span></footer>
                </article>
                <aside class="xz-checklist-summary">
                    <h3>今日进度</h3>
                    <strong>{completionPercent}%</strong>
                    <span>{completedCount} / {allReminderKeys.length} 项</span>
                    <div class="xz-checklist-progress"><i style={`width:${completionPercent}%`}></i></div>
                    <p>当前仍是可交互的纸质样式。可以直接勾选或编辑，打印时只输出左侧清单。</p>
                </aside>
            </div>
        {/if}

        <p class="xz-checklist-reset-note">勾选与周末训练安排按日期自动保存；切换视图、重启插件或更换设备后仍可恢复。</p>
    </section>
{/if}

{#if editorOpen}
    <div class="xz-dialog-backdrop" role="presentation" on:click|self={() => editorOpen = false}>
        <section class="xz-checklist-editor" role="dialog" aria-modal="true" aria-labelledby="xz-checklist-editor-title">
            <header><div><span class="xz-section-kicker">{template.label}模板</span><h2 id="xz-checklist-editor-title">{editingId ? "编辑时间节点" : "新增时间节点"}</h2></div><button type="button" aria-label="关闭" on:click={() => editorOpen = false}>×</button></header>
            <p>时间、标题和提醒内容都可以修改，但建议只在长期节奏发生变化时调整。每行文字会成为一条提醒，不会生成填写字段。</p>
            <label><span>时间节点（不建议频繁修改）</span><input bind:value={editTime} placeholder="例如：20:15–21:00" /></label>
            <label><span>标题</span><input bind:value={editTitle} placeholder="例如：准备明天" /></label>
            {#if editHasTrainingChoices}
                <label><span>通用提醒（可选，每行一条）</span><textarea bind:value={editReminders} placeholder="无论训练或休息都会显示"></textarea></label>
                <label><span>训练日提醒（每行一条）</span><textarea bind:value={editTrainingReminders} placeholder="选择训练日后显示"></textarea></label>
                <label><span>休息日提醒（每行一条）</span><textarea bind:value={editRestReminders} placeholder="选择休息日后显示"></textarea></label>
            {:else}
                <label><span>提醒内容（每行一条）</span><textarea bind:value={editReminders} placeholder="每行填写一条提醒"></textarea></label>
            {/if}
            <label><span>纸质视图区块样式</span><select bind:value={editTone}><option value="plain">普通</option><option value="mint">节律提示</option><option value="sand">准备事项</option><option value="rose">边界提醒</option></select></label>
            <footer>
                {#if editingId}<button class="xz-checklist-delete" type="button" disabled={saving} on:click={() => void deleteEntry()}>删除时间节点</button>{/if}
                <span></span>
                <button type="button" on:click={() => editorOpen = false}>取消</button>
                <button class="b3-button" type="button" disabled={saving} on:click={() => void saveEntry()}>{saving ? "保存中…" : "保存模板"}</button>
            </footer>
        </section>
    </div>
{/if}
