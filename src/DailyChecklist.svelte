<script lang="ts">
    import { tick } from "svelte";
    import type { DailyDayType } from "./daily-records";
    import {
        cloneChecklistStore,
        createDefaultChecklistStore,
        boundaryKeyFor,
        pruneEntryBoundaries,
        reconcileReminders,
        setChecklistBoundary,
        updateChecklistDayState,
        updateChecklistStore,
        type ChecklistEntry,
        type ChecklistReminder,
        type ChecklistReminderState,
        type ChecklistStore,
        type ChecklistTemplate,
        type ChecklistTemplateId,
        type ChecklistTone,
        type ChecklistTrainingMode,
        type ChecklistViewMode,
    } from "./checklist";

    export let date: string;
    export let dayType: DailyDayType | null = null;
    /**
     * 数据来源：默认由本组件自加载。
     * 「今日记录」里的边界提醒面板会用同一个 checklist.json 写入勾选状态，
     * 那时由父组件传入同一个 loader，让两个视图共用一份数据，避免各持旧快照互相覆盖。
     */
    export let loadChecklist: (() => Promise<ChecklistStore>) | undefined = undefined;
    export let saveChecklist: (store: ChecklistStore) => Promise<ChecklistStore>;
    /** 每次成功保存后回调当前快照，供父组件同步它持有的那份数据。 */
    export let onStorePersisted: ((store: ChecklistStore) => void) | undefined = undefined;

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
    /** 行内「＋ 添加一行提醒」：正在给哪个条目输入新提醒。 */
    let addingEntryId = "";
    let addingText = "";
    let addInput: HTMLInputElement | null = null;
    /** 窄屏用「?」浮层展示类型图例。 */
    let typeHelpOpen = false;
    /**
     * 行内删除的两步确认：第一次点只是选中（行变成确认态），再点一次才真的删。
     * 不用弹窗，避免删一行提醒也要开对话框；点的别的行会自动切换目标。
     */
    let pendingDeleteKey = "";
    let reminderStates = new Map<string, ChecklistReminderState>();
    let trainingMode: ChecklistTrainingMode = "";
    let saveSequence = 0;

    $: templateId = dayType === "conference-day" ? "conference" : templateIdForDate(date);
    $: template = store.templates.find((candidate) => candidate.id === templateId) ?? store.templates[0];
    $: allReminderKeys = template.entries.flatMap((item) => visibleReminderRows(item, trainingMode).map((reminder) => reminder.key));
    $: completedCount = countState(allReminderKeys, "completed");
    $: partialCount = countState(allReminderKeys, "partial");
    $: missedCount = countState(allReminderKeys, "missed");
    $: pendingCount = allReminderKeys.length - completedCount - partialCount - missedCount;
    $: weightedCompletedCount = completedCount + partialCount * 0.5;
    $: weightedCompletedLabel = Number.isInteger(weightedCompletedCount) ? String(weightedCompletedCount) : weightedCompletedCount.toFixed(1);
    $: completionPercent = allReminderKeys.length ? Math.round(weightedCompletedCount / allReminderKeys.length * 100) : 0;
    $: paperColumns = splitPaperEntries(template);
    $: if (date !== lastDate) {
        lastDate = date;
        hydrateDayState(date);
    }

    Promise.resolve().then(async () => {
        try {
            store = cloneChecklistStore(await (loadChecklist?.() ?? createDefaultChecklistStore()));
            hydrateDayState(date);
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        } finally {
            loading = false;
        }
    });

    /*
     * 父组件换了数据源（边界提醒面板写入后 loadChecklist 会返回新快照）就重新读取。
     * 用序号丢弃过期结果：连续两次写入时，先到的旧快照不能盖掉后到的新快照。
     */
    $: if (!loading && loadChecklist) void reloadFromSource(loadChecklist);

    let reloadSequence = 0;
    async function reloadFromSource(source: () => Promise<ChecklistStore>) {
        const sequence = ++reloadSequence;
        try {
            const loaded = cloneChecklistStore(await source());
            if (sequence !== reloadSequence || loaded.revision === store.revision) return;
            store = loaded;
            hydrateDayState(date);
        } catch (caught) {
            if (sequence === reloadSequence) error = caught instanceof Error ? caught.message : String(caught);
        }
    }

    function hydrateDayState(currentDate: string) {
        const state = store.dayStates.find((candidate) => candidate.date === currentDate);
        reminderStates = new Map(Object.entries(state?.reminderStates ?? {}));
        trainingMode = state?.trainingMode ?? "";
    }

    function changeReminderState(key: string, value: string) {
        if (value !== "" && value !== "completed" && value !== "partial" && value !== "missed") return;
        const nextStates = new Map(reminderStates);
        if (value) nextStates.set(key, value);
        else nextStates.delete(key);
        reminderStates = nextStates;
        void persistDayState();
    }

    function reminderState(key: string): ChecklistReminderState | "" {
        return reminderStates.get(key) ?? "";
    }

    function countState(keys: string[], state: ChecklistReminderState): number {
        return keys.filter((key) => reminderStates.get(key) === state).length;
    }

    function chooseTrainingMode(mode: Exclude<ChecklistTrainingMode, "">) {
        trainingMode = mode;
        void persistDayState();
    }

    /** 当前模式下实际显示的提醒，各自带上状态键与边界时间。 */
    function visibleReminderRows(item: ChecklistEntry, mode: ChecklistTrainingMode): Array<{ key: string; reminderId: string; text: string; at: string }> {
        return visibleReminderGroups(item, mode).flatMap((group) => group.reminders.map((reminder) => {
            const key = boundaryKeyFor(item.id, reminder.id);
            return { key, reminderId: reminder.id, text: reminder.text, at: item.boundaries?.[key] ?? "" };
        }));
    }

    function visibleReminderGroups(item: ChecklistEntry, mode: ChecklistTrainingMode): Array<{ mode: "common" | "training" | "rest"; reminders: ChecklistReminder[] }> {
        const groups: Array<{ mode: "common" | "training" | "rest"; reminders: ChecklistReminder[] }> = [{ mode: "common", reminders: item.reminders }];
        if (!item.trainingChoices || !mode) return groups;
        groups.push({ mode, reminders: item.trainingChoices[mode] });
        return groups;
    }

    /** 四种类型的中文名，与纸质视图共用同一套 tone。 */
    function toneLabel(tone: ChecklistTone): string {
        if (tone === "mint") return "节律提示";
        if (tone === "sand") return "准备事项";
        if (tone === "rose") return "边界提醒";
        return "普通";
    }

    function startAdding(item: ChecklistEntry) {
        addingEntryId = item.id;
        addingText = "";
        void tick().then(() => addInput?.focus());
    }

    function cancelAdding() {
        addingEntryId = "";
        addingText = "";
    }

    /**
     * 把正在输入的这一行追加到条目末尾。
     * 复用保存编辑时同一套对齐逻辑，因此新增一行不会影响任何已有提醒的 id 与边界时间。
     */
    async function commitAdding(item: ChecklistEntry) {
        const text = addingText.trim();
        if (!text || saving) return;
        const next = cloneChecklistStore(store);
        const target = next.templates.find((candidate) => candidate.id === template.id)?.entries.find((candidate) => candidate.id === item.id);
        if (!target) return;
        target.reminders = reconcileReminders(item.id, [...target.reminders.map((reminder) => reminder.text), text], target.reminders);
        if (await persist(updateChecklistStore(next, { templates: next.templates }))) {
            // 保持展开，方便连续添加多行
            addingText = "";
            void tick().then(() => addInput?.focus());
        }
    }

    /**
     * 行内删除一条提醒。第一次调用只是进入确认态，第二次才真的删除。
     * 删除时该提醒的边界时间会一起消失（它绑在这条提醒上），这是预期行为。
     */
    async function removeReminder(item: ChecklistEntry, reminder: { key: string; text: string }) {
        if (pendingDeleteKey !== reminder.key) {
            pendingDeleteKey = reminder.key;
            return;
        }
        pendingDeleteKey = "";
        const next = cloneChecklistStore(store);
        const target = next.templates.find((candidate) => candidate.id === template.id)?.entries.find((candidate) => candidate.id === item.id);
        if (!target) return;
        const kept = target.reminders.filter((candidate) => candidate.text !== reminder.text);
        // 至少保留一条提醒，否则这个时间节点就没有内容了
        if (!kept.length) {
            error = "每个时间节点至少要保留一条提醒。";
            return;
        }
        target.reminders = reconcileReminders(item.id, kept.map((candidate) => candidate.text), target.reminders);
        Object.assign(target, pruneEntryBoundaries(target));
        await persist(updateChecklistStore(next, { templates: next.templates }));
    }

    function handleAddKeydown(event: KeyboardEvent, item: ChecklistEntry) {
        if (event.key === "Enter") {
            event.preventDefault();
            void commitAdding(item);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            cancelAdding();
        }
    }

    /**
     * 设置或清空某条提醒的边界提醒时间。
     * 绑定在提醒 id 上，因此调整清单顺序不会让时间跑到别的事情上。
     */
    async function editBoundaryTime(item: ChecklistEntry, reminderId: string, value: string) {
        await persist(setChecklistBoundary(store, template.id, { entryId: item.id, reminderId, at: value }));
    }

    async function changeViewMode(viewMode: ChecklistViewMode) {
        if (store.viewMode === viewMode || saving) return;
        await persist(updateChecklistStore(store, { viewMode }));
    }

    async function persistDayState(): Promise<void> {
        const next = updateChecklistDayState(store, date, reminderStates, trainingMode);
        await persist(next);
    }

    function openEditor(entry?: ChecklistEntry) {
        const selected = entry ?? template.entries[0];
        editingId = selected?.id ?? "";
        editTime = selected?.time ?? "";
        editTitle = selected?.title ?? "";
        editReminders = selected?.reminders.map((reminder) => reminder.text).join("\n") ?? "";
        editHasTrainingChoices = Boolean(selected?.trainingChoices);
        editTrainingReminders = selected?.trainingChoices?.training.map((reminder) => reminder.text).join("\n") ?? "";
        editRestReminders = selected?.trainingChoices?.rest.map((reminder) => reminder.text).join("\n") ?? "";
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
            if (index >= 0) {
                const previous = target.entries[index];
                /*
                 * 文字没变的提醒保留原 id，边界时间因此跟着这条提醒走；
                 * 新加的文字拿新 id；被删掉的提醒连同它的边界时间一起消失。
                 */
                const merged: ChecklistEntry = {
                    ...previous,
                    time,
                    title,
                    reminders: reconcileReminders(previous.id, reminders, previous.reminders),
                    tone: editTone,
                    ...(trainingChoices
                        ? {
                            trainingChoices: {
                                training: reconcileReminders(previous.id, trainingChoices.training, previous.trainingChoices?.training ?? [], "training"),
                                rest: reconcileReminders(previous.id, trainingChoices.rest, previous.trainingChoices?.rest ?? [], "rest"),
                            },
                        }
                        : { trainingChoices: undefined }),
                };
                target.entries[index] = pruneEntryBoundaries(merged);
            }
        } else {
            const created: ChecklistEntry = {
                id: createEntryId(),
                time,
                title,
                reminders: reconcileReminders("", reminders, []),
                tone: editTone,
            };
            target.entries.push({ ...created, reminders: created.reminders.map((reminder, position) => ({ id: `${created.id}:${position}`, text: reminder.text })) });
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
            onStorePersisted?.(saved);
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
        const preferredSplit = currentTemplate.id === "workday" ? 9 : currentTemplate.id === "conference" ? 5 : currentTemplate.id === "saturday" ? 7 : 8;
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
                        <span>当日状态会自动保存</span>
                    </header>
                    <div class="xz-checklist-native-entries">
                        {#each template.entries as item, entryIndex (item.id)}
                            <section class="xz-checklist-native-entry t-{item.tone}">
                                <div class="xz-type-strip" title="类型：{toneLabel(item.tone)}"><span>{toneLabel(item.tone)}</span></div>
                                <div class="xz-checklist-native-content">
                                    <div class="xz-checklist-native-title">
                                        <strong>{item.title}</strong>
                                        <span class="xz-checklist-native-when">{item.time}</span>
                                        <span>{visibleReminderRows(item, trainingMode).length} 项提醒</span>
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
                                        {#each visibleReminderRows(item, trainingMode) as reminder (reminder.key)}
                                            <label class:completed={reminderState(reminder.key) === "completed"} class:partial={reminderState(reminder.key) === "partial"} class:missed={reminderState(reminder.key) === "missed"}>
                                                <input
                                                    class="xz-checklist-boundary-time"
                                                    class:is-set={Boolean(reminder.at)}
                                                    type="time"
                                                    value={reminder.at}
                                                    title="边界提醒时间：填了以后，这条会在「今日记录」里到点浮出来"
                                                    aria-label={`“${reminder.text}”的边界提醒时间`}
                                                    on:change={(event) => void editBoundaryTime(item, reminder.reminderId, event.currentTarget.value)}
                                                />
                                                <select class="xz-checklist-state-select" aria-label={`设置“${reminder.text}”状态`} value={reminderState(reminder.key)} on:change={(event) => changeReminderState(reminder.key, event.currentTarget.value)}>
                                                    <option value="">○ 待处理</option>
                                                    <option value="completed">✓ 已完成</option>
                                                    <option value="partial">◐ 部分完成</option>
                                                    <option value="missed">× 未完成</option>
                                                </select>
                                                <span>{reminder.text}</span>
                                                <button
                                                    class="xz-checklist-remove-reminder"
                                                    class:is-confirming={pendingDeleteKey === reminder.key}
                                                    type="button"
                                                    title={pendingDeleteKey === reminder.key ? "再点一次确认删除" : "删除这条提醒"}
                                                    aria-label={pendingDeleteKey === reminder.key ? `确认删除“${reminder.text}”` : `删除“${reminder.text}”`}
                                                    disabled={saving}
                                                    on:click={() => void removeReminder(item, reminder)}
                                                >{pendingDeleteKey === reminder.key ? "确认删除" : "×"}</button>
                                            </label>
                                        {/each}
                                    </div>
                                    {#if addingEntryId === item.id}
                                        <div class="xz-checklist-add-reminder__box">
                                            <input
                                                bind:this={addInput}
                                                bind:value={addingText}
                                                placeholder="这一行要提醒什么？回车添加"
                                                aria-label={`给“${item.title}”添加一行提醒`}
                                                on:keydown={(event) => handleAddKeydown(event, item)}
                                            />
                                            <button class="primary" type="button" disabled={saving || !addingText.trim()} on:click={() => void commitAdding(item)}>{saving ? "保存中…" : "添加"}</button>
                                            <button type="button" on:click={cancelAdding}>取消</button>
                                        </div>
                                    {:else}
                                        <button class="xz-checklist-add-reminder" type="button" disabled={saving} on:click={() => startAdding(item)}>＋ 添加一行提醒</button>
                                    {/if}
                                </div>
                            </section>
                        {/each}
                    </div>
                </article>
                <aside class="xz-checklist-summary">
                    <h3>今日进度</h3>
                    <strong>{completionPercent}%</strong>
                    <span>折算 {weightedCompletedLabel} / {allReminderKeys.length} 项</span>
                    <div class="xz-checklist-progress"><i style={`width:${completionPercent}%`}></i></div>
                    <div class="xz-checklist-state-summary"><span>✓ {completedCount}</span><span>◐ {partialCount}</span><span>× {missedCount}</span><span>○ {pendingCount}</span></div>
                    <p>Checklist 只负责提醒。需要记录的结果、时长和观察仍在“今日记录”中填写。</p>
                    <div class="xz-checklist-type-legend">
                        <h4>类型底色</h4>
                        <dl>
                            <div class="plain"><i></i><dt>普通</dt><dd>常规时间节点</dd></div>
                            <div class="mint"><i></i><dt>节律提示</dt><dd>照顾身体与状态：鱼油、专业学习、熄灯</dd></div>
                            <div class="sand"><i></i><dt>准备事项</dt><dd>为下一段做准备：下班区间、准备明天</dd></div>
                            <div class="rose"><i></i><dt>边界提醒</dt><dd>工作与生活的分界：收尾仪式、无工作区间</dd></div>
                        </dl>
                        <p>纸质视图用同一套颜色；打印后按深浅区分。</p>
                    </div>
                    <div class="xz-checklist-type-help">
                        {#if typeHelpOpen}
                            <div class="xz-checklist-type-help__popover">
                                <h4>类型底色</h4>
                                <dl>
                                    <div class="plain"><i></i><dt>普通</dt><dd>常规时间节点</dd></div>
                                    <div class="mint"><i></i><dt>节律提示</dt><dd>照顾身体与状态：鱼油、学习、熄灯</dd></div>
                                    <div class="sand"><i></i><dt>准备事项</dt><dd>为下一段做准备：下班区间、准备明天</dd></div>
                                    <div class="rose"><i></i><dt>边界提醒</dt><dd>工作与生活的分界：收尾仪式、无工作区间</dd></div>
                                </dl>
                            </div>
                        {/if}
                        <button class="xz-checklist-type-help__button" type="button" aria-expanded={typeHelpOpen} title="类型底色说明" aria-label="类型底色说明" on:click={() => typeHelpOpen = !typeHelpOpen}>?</button>
                    </div>
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
                    <div class="xz-checklist-paper-progress"><span>今日折算完成 {weightedCompletedLabel} / {allReminderKeys.length}</span><i><b style={`width:${completionPercent}%`}></b></i><span>{completionPercent}%</span></div>
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
                                        {#each visibleReminderRows(item, trainingMode) as reminder (reminder.key)}
                                            <label class:completed={reminderState(reminder.key) === "completed"} class:partial={reminderState(reminder.key) === "partial"} class:missed={reminderState(reminder.key) === "missed"}>
                                                <select class="xz-checklist-state-select" aria-label={`设置“${reminder.text}”状态`} value={reminderState(reminder.key)} on:change={(event) => changeReminderState(reminder.key, event.currentTarget.value)}>
                                                    <option value="">○ 待处理</option>
                                                    <option value="completed">✓ 已完成</option>
                                                    <option value="partial">◐ 部分完成</option>
                                                    <option value="missed">× 未完成</option>
                                                </select>
                                                <span>{reminder.text}{#if reminder.at}<em class="xz-checklist-boundary-badge">边界 {reminder.at}</em>{/if}</span>
                                                {#if reminder.at}
                                                    <button type="button" class="xz-checklist-boundary-clear" title="取消这条的边界提醒" on:click={() => void editBoundaryTime(item, reminder.reminderId, "")}>×</button>
                                                {/if}
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
                    <span>折算 {weightedCompletedLabel} / {allReminderKeys.length} 项</span>
                    <div class="xz-checklist-progress"><i style={`width:${completionPercent}%`}></i></div>
                    <div class="xz-checklist-state-summary"><span>✓ {completedCount}</span><span>◐ {partialCount}</span><span>× {missedCount}</span><span>○ {pendingCount}</span></div>
                    <p>当前仍是可交互的纸质样式。可以直接选择状态或编辑，打印时只输出左侧清单。</p>
                    <div class="xz-checklist-type-legend">
                        <h4>类型底色</h4>
                        <dl>
                            <div class="plain"><i></i><dt>普通</dt><dd>常规时间节点</dd></div>
                            <div class="mint"><i></i><dt>节律提示</dt><dd>照顾身体与状态：鱼油、专业学习、熄灯</dd></div>
                            <div class="sand"><i></i><dt>准备事项</dt><dd>为下一段做准备：下班区间、准备明天</dd></div>
                            <div class="rose"><i></i><dt>边界提醒</dt><dd>工作与生活的分界：收尾仪式、无工作区间</dd></div>
                        </dl>
                        <p>纸质视图用同一套颜色；打印后按深浅区分。</p>
                    </div>
                    <div class="xz-checklist-type-help">
                        {#if typeHelpOpen}
                            <div class="xz-checklist-type-help__popover">
                                <h4>类型底色</h4>
                                <dl>
                                    <div class="plain"><i></i><dt>普通</dt><dd>常规时间节点</dd></div>
                                    <div class="mint"><i></i><dt>节律提示</dt><dd>照顾身体与状态：鱼油、学习、熄灯</dd></div>
                                    <div class="sand"><i></i><dt>准备事项</dt><dd>为下一段做准备：下班区间、准备明天</dd></div>
                                    <div class="rose"><i></i><dt>边界提醒</dt><dd>工作与生活的分界：收尾仪式、无工作区间</dd></div>
                                </dl>
                            </div>
                        {/if}
                        <button class="xz-checklist-type-help__button" type="button" aria-expanded={typeHelpOpen} title="类型底色说明" aria-label="类型底色说明" on:click={() => typeHelpOpen = !typeHelpOpen}>?</button>
                    </div>
                </aside>
            </div>
        {/if}

        <p class="xz-checklist-reset-note">Checklist 状态与周末训练安排按日期自动保存；切换视图、重启插件或更换设备后仍可恢复。</p>
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
