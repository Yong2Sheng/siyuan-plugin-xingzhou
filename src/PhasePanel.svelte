<script lang="ts">
    /**
     * 紧急期面板：横幅 + 「最小一天」核心区 + 结束/延长弹窗。
     *
     * 设计约束（来自真实使用场景，改动前先读一遍）：
     * 1. 紧急期内**不新增判断点**：每天只有一次确认 + 四个锚点，其余字段一律不出现；
     * 2. 不点确认什么都不会发生——不退出、不降级、不算断、不催；
     * 3. 紧急期的目标是 hard deadline：**目标不改、不缩**，唯一能动的是结束日，且由你手动选；
     * 4. 展示上不出现连续天数、不出现百分比——断了不会让前面归零。
     */
    import { createEventDispatcher } from "svelte";
    import { DEFAULT_SPRINT_ANCHORS, LANDING_RUNGS, activeLanding, activeSprint, advanceLanding, clonePhaseStore, confirmSprintDay, currentRung, dateDiffInDays, endLanding, endSprint, extendSprint, isRungActedToday, landedSummary, rungForDate, rungLogOnDate, sprintDayCount, sprintDayEntry, sprintDayIndex, sprintForDate, type PhaseStore } from "./phases";
    import type { DailyRecord } from "./daily-records";
    import type { WorkItem, WorkItemData } from "./work-items";
    import TimeSelect from "./TimeSelect.svelte";
    import { portal } from "./portal";

    export let store: PhaseStore;
    export let savePhaseStore: (next: PhaseStore) => Promise<PhaseStore>;
    export let currentDate = "";
    export let isToday = true;
    /** 今天的每日记录：锚点读写都落在它上面，沿用生活节律自己的自动保存。 */
    export let record: DailyRecord;
    export let patchFields: (changes: Partial<DailyRecord["fields"]>) => void;
    export let loadWorkItems: (() => Promise<WorkItemData>) | null = null;
    export let openWorkItem: (id: string) => void = () => undefined;

    const dispatch = createEventDispatcher<{
        /**
         * 阶段数据保存成功后回传。
         * 父组件（生活节律）用它判断"今天是否处在紧急期"，不同步就会停在旧值：
         * 结束紧急期后表单该回来却回不来，页面看起来一片空白（真实事故）。
         */
        storeChanged: PhaseStore;
        /** 结束归航后想看一眼这段时间的睡眠窗口。 */
        openTrends: Record<string, never>;
    }>();

    /** 归航第 1 级的交付确认选项：模板里不能用 TS 的 as const，因此放在脚本里。 */
    const DELIVERY_OPTIONS: Array<{ value: DailyRecord["fields"]["landingDeliveryState"]; label: string }> = [
        { value: "done", label: "已完成" },
        { value: "partial", label: "部分交付" },
        { value: "short", label: "还差一点" },
    ];

    /** 交接记录输入：模板里不能写 TS 类型断言，因此收在脚本里。 */
    function onHandoverInput(event: Event) {
        const target = event.currentTarget;
        if (target instanceof HTMLTextAreaElement) patchFields({ landingHandoverNote: target.value });
    }

    /** 日期偏移：把归航起始日定在紧急期结束的次日。 */
    function shiftDateKey(date: string, days: number): string {
        const parsed = new Date(`${date}T12:00:00`);
        parsed.setDate(parsed.getDate() + days);
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }

    const todayKey = () => currentDate;

    let busy = false;
    let error = "";
    let extendOpen = false;
    let endOpen = false;
    let landingEndOpen = false;
    let progressOpen = false;
    let sleepEntryOpen = false;
    let workItems: WorkItemData | null = null;
    let todaySlices: Array<{ slice: NonNullable<WorkItem["executionSlices"]>[number]; item: WorkItem }> = [];
    let extendValue = "";

    $: sprint = activeSprint(store, currentDate);
    // 进入今天（或切换日期）时刷新一次「今天的事务」，只用于「选一个」，不参与锚点落库。
    $: if (currentDate && loadWorkItems) void refreshTodaySlices();

    function recomputeTodaySlices(data: WorkItemData) {
        todaySlices = data.items
            .flatMap((item) => (item.executionSlices ?? [])
                .filter((slice) => slice.scheduledDate === currentDate)
                .map((slice) => ({ slice, item })))
            .sort((a, b) => a.item.title.localeCompare(b.item.title, "zh-CN"));
    }

    async function refreshTodaySlices() {
        if (!loadWorkItems) return;
        try {
            const data = await loadWorkItems();
            workItems = data;
            recomputeTodaySlices(data);
        } catch {
            /* 读不到工作项时只影响「选一个」，不影响锚点记录 */
        }
    }
    $: landing = activeLanding(store);
    $: sprintDay = sprint ? sprintDayEntry(sprint, currentDate) : null;
    $: confirmed = Boolean(sprintDay);
    $: dayIndex = sprint ? sprintDayIndex(sprint, currentDate) : 0;
    $: totalDays = sprint ? sprintDayCount(sprint) : 0;
    $: plannedDays = sprint ? Math.max(1, dateDiffInDays(sprint.startDate, sprint.originalEndDate) + 1) : 0;
    $: expired = Boolean(sprint && currentDate > sprint.endDate);
    /*
     * 显示用的级数必须按"这一天"取（rungForDate），不能用光标（currentRung）。
     * 用光标会让"今天点了做完了"把同一天的界面立刻跳成下一级——
     * 而规则是"今天记第 1 级、明天才第 2 级"（用户实际发现）。
     */
    $: rung = landing ? rungForDate(landing, currentDate) : null;

    /**
     * 当天实际级数（0 起）回传给父组件。
     * 父组件必须用它决定显示哪些字段：用光标（advanceLanding 会立刻 +1）会导致
     * "今天点完做完了，当天就冒出下一级的输入框"（真实 bug）。
     */
    export let onRungChange: ((index: number | null) => void) | null = null;
    $: if (onRungChange) onRungChange(rung ? rung.index : null);
    $: rungDone = landing ? isRungActedToday(landing, currentDate) : false;
    $: rungLog = landing ? rungLogOnDate(landing, currentDate) : null;
    /**
     * 归航第 1 级的"交付结果"面板是否显示。
     * 写成脚本里的布尔（而不是在模板里串联条件）：模板里的多条件表达式在类型检查与测试环境里
     * 都更难定位，出问题时排查成本远高于这一行。
     */
    /*
     * 「这次交付完成了吗」只属于**归航第 1 级**，不是"从第 1 级起一直有效"。
     * 之前用 landingOffersGroup(...) 判断，它对每一级都为真，于是走到第 4 级这块还挂着
     * （用户实际看到：横幅写着第 4 级，上面仍是交付面板）。
     */
    $: showDeliveryPanel = Boolean(landing && rung && rung.index === 0);

    const DEFAULT_ANCHOR_IDS = DEFAULT_SPRINT_ANCHORS.map((anchor) => anchor.id);
    /** 这次紧急期实际保护的锚点（熄灯不可去掉）。 */
    $: keptAnchorIds = sprint
        ? DEFAULT_ANCHOR_IDS.filter((id) => sprint.anchors.some((anchor) => anchor.id === id))
        : DEFAULT_ANCHOR_IDS;
    $: plannedLightsOff = record.fields.plannedLightsOffTime;
    $: lightsOffTime = record.fields.lightsOffTime;
    $: wakeTime = record.fields.wakeTime;
    $: mealCount = record.fields.sprintMealCount;
    $: progressText = record.fields.sprintProgressNote ?? "";
    $: progressItemId = record.fields.sprintProgressItemId ?? "";
    $: progressItem = progressItemId
        ? (workItems ? workItems.items.find((item) => item.id === progressItemId) ?? null : null)
        : null;

    /*
     * 跨过零点后第一次打开时，把今天写进阶段数据（每天一条），不需要任何点击。
     * 这样"确认过但没记锚点"与"整天没打开"在事后仍能区分，而用户不必每天报告一次。
     */
    /** 未结束的紧急期：自动记录只在这种区间里发生。 */
    $: openSprint = sprint && sprint.endedAt === null ? sprint : null;
    $: if (openSprint && isToday && !confirmed && !busy) void autoRecordToday();

    async function autoRecordToday() {
        if (!openSprint) return;
        await persist((current) => confirmSprintDay(current, openSprint.id, currentDate));
    }

    /*
     * 到点自动收尾：紧急期最后一天过后第一次打开行舟时，自动把它结束并进入归航期。
     * 为什么必须自动：到点结束是声明时就约定好的事；之前只让它"静默失效"，
     * 界面于是直接切回全量表单，归航阶梯根本没开始（实测：区间结束次日归航为空）。
     *
     * 要找的是"已经过期、但还没被结束"的那一次紧急期。
     * 注意不能用 sprintForDate —— 它只返回**覆盖该日期**的紧急期，区间结束次日已经超出区间，
     * 会返回 null，于是收尾永远不会触发（这正是之前到点后直接回到全量表单的原因）。
     * 也不能用 activeSprint —— 到点后它同样是 null。
     */
    let deadlineClosing = false;
    $: pendingDeadlineSprint = currentDate
        ? store.sprints.find((phase) => phase.endedAt === null && phase.endDate < currentDate) ?? null
        : null;
    $: needsDeadlineClose = Boolean(
        pendingDeadlineSprint
        && isToday
        && landing === null
        && !deadlineClosing
        && !busy
        // 只在"结束次日"自动收尾：更早的历史紧急期交给恢复入口，不在这里静默开一次归航
        && currentDate === shiftDateKey(pendingDeadlineSprint.endDate, 1),
    );
    $: if (needsDeadlineClose) void closeExpiredSprint();

    async function closeExpiredSprint() {
        if (!pendingDeadlineSprint || deadlineClosing) return;
        deadlineClosing = true;
        try {
            await persist((current) => endSprint(current, pendingDeadlineSprint.id, {
                endedBy: "deadline",
                startLanding: true,
                landingStartDate: shiftDateKey(pendingDeadlineSprint.endDate, 1),
            }));
        } finally {
            deadlineClosing = false;
        }
    }

    async function persist(mutate: (current: PhaseStore) => PhaseStore) {
        if (busy) return;
        busy = true;
        error = "";
        try {
            const next = mutate(clonePhaseStore(store));
            store = await savePhaseStore(next);
            dispatch("storeChanged", store);
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        } finally {
            busy = false;
        }
    }

    /** 此刻熄灯：当场记录，归日就是今晚（live 语义）。 */
    function recordLightsOffNow() {
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        patchFields({ lightsOffTime: time, lightsOffTimeSource: "live" });
    }

    function setMealCount(count: number) {
        patchFields({ sprintMealCount: mealCount === count ? null : count });
    }

    function chooseProgress(item: WorkItem) {
        patchFields({ sprintProgressItemId: item.id });
        progressOpen = false;
    }

    function setProgressNote(value: string) {
        patchFields({ sprintProgressItemId: "", sprintProgressNote: value });
    }

    function openExtend() {
        if (!sprint) return;
        extendValue = shift(sprint.endDate, 7);
        extendOpen = true;
    }

    async function confirmExtend() {
        if (!sprint) return;
        const target = extendValue;
        extendOpen = false;
        await persist((current) => extendSprint(current, sprint.id, target));
    }

    /** 结束紧急期：可选同时开始归航；结束本身不改任何已写下的内容。 */
    async function confirmEnd(startLanding: boolean) {
        if (!sprint) return;
        endOpen = false;
        await persist((current) => endSprint(current, sprint.id, { startLanding, endedBy: "manual" }));
    }

    /** 归航的三个动作，一律从明天起生效；同一天重复点击不跳级。 */
    async function actOnRung(status: "done" | "skipped" | "deferred") {
        if (!landing || rungDone) return;
        await persist((current) => advanceLanding(current, landing.id, status, currentDate));
    }

    async function finishLanding() {
        if (!landing) return;
        landingEndOpen = false;
        await persist((current) => endLanding(current, landing.id));
    }

    function shift(date: string, days: number): string {
        const parsed = new Date(`${date}T12:00:00`);
        parsed.setDate(parsed.getDate() + days);
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }

    function formatDateShort(date: string): string {
        const [, month, day] = date.split("-");
        return `${Number(month)} 月 ${Number(day)} 日`;
    }

    function weekdayLabel(date: string): string {
        return `周${"日一二三四五六"[new Date(`${date}T12:00:00`).getDay()]}`;
    }
</script>

<!--
    诊断条：把面板看到的日期、紧急期区间与 isToday 写在页面上（visual-hidden）。
    排查"某一天界面为什么是空的"时直接读这里，不必再靠猜。
-->
<div
    class="xz-phase-panel"
    data-panel-date={currentDate}
    data-panel-sprint={sprint ? `${sprint.startDate}~${sprint.endDate}` : ""}
    data-panel-today={isToday}
    data-panel-landing={landing ? `${landing.id}:cursor=${landing.cursor}` : ""}
    data-panel-rung={rung ? rung.index : ""}
    data-panel-acted-today={landing ? String(isRungActedToday(landing, currentDate)) : ""}
    hidden
></div>

{#if sprint}
    <div class="xz-phase-banner" data-state={expired ? "expired" : "running"}>
        <div class="xz-phase-banner__main">
            <strong>紧急期{ sprint.title ? ` · ${sprint.title}` : "" }{#if expired}<span class="xz-phase-chip xz-phase-chip--ember">今天到期</span>{/if}</strong>
            <p>第 {dayIndex} 天 · 到 {formatDateShort(sprint.endDate)}（{weekdayLabel(sprint.endDate)}）结束{ sprint.extensionCount > 0 ? ` · 已延长 ${sprint.extensionCount} 次` : "" }。只有下面的保护锚点需要记录，其他字段在这段时间不补、也不催。</p>
        </div>
        <div class="xz-phase-banner__actions">
            {#if expired}
                <button class="xz-phase-action xz-phase-action--primary" type="button" disabled={busy} on:click={openExtend}>延长到…</button>
            {:else}
                <button class="xz-phase-action" type="button" disabled={busy} on:click={openExtend}>延长到…</button>
            {/if}
            <button class="xz-phase-action" type="button" disabled={busy} on:click={() => (endOpen = true)}>结束紧急期</button>
        </div>
    </div>

    <section class="xz-phase-core">
        <p class="xz-phase-core__lead">今天只要看这四个锚点就够了——<b>能记就记，一项不记也不会打断</b>。紧急期按你声明的日期区间自动延续，不需要你每天确认。</p>

        <div class="xz-phase-anchors">
            {#if keptAnchorIds.includes("lightsOff")}
                <div class="xz-phase-anchor">
                    <header><strong>今晚熄灯</strong><small>唯一必选锚点</small></header>
                    {#if lightsOffTime}
                        <div class="xz-phase-anchor__row">
                            <span class="xz-phase-time">{lightsOffTime}<small>已记录</small></span>
                            <button class="xz-phase-ghost" type="button" on:click={() => patchFields({ lightsOffTime: "" })}>改</button>
                        </div>
                    {:else}
                        <div class="xz-phase-anchor__row">
                            <button class="xz-phase-action xz-phase-action--primary" type="button" on:click={recordLightsOffNow}>此刻熄灯</button>
                            <button class="xz-phase-ghost" type="button" on:click={() => (sleepEntryOpen = true)}>只记时段</button>
                        </div>
                    {/if}
                    <p class="xz-phase-anchor__note">关灯前按一次，时间当场记下；跨午夜也按今晚算。{ plannedLightsOff ? ` 昨晚计划 ${plannedLightsOff}。` : "" }</p>
                </div>
            {/if}

            {#if keptAnchorIds.includes("wakeTime")}
                <div class="xz-phase-anchor">
                    <header><strong>今早起床</strong><small>决定节律还在不在</small></header>
                    <div class="xz-phase-anchor__row">
                        <TimeSelect bind:value={record.fields.wakeTime} ariaLabel="今早起床" clearable on:change={() => patchFields({})} />
                    </div>
                    <p class="xz-phase-anchor__note">与熄灯配对后，趋势里的睡眠窗口这段时间不会断。</p>
                </div>
            {/if}

            {#if keptAnchorIds.includes("meals")}
                <div class="xz-phase-anchor">
                    <header><strong>今天吃上饭</strong><small>正餐次数</small></header>
                    <div class="xz-phase-anchor__row">
                        <span class="xz-phase-tap-group">
                            {#each [1, 2, 3] as count}
                                <button class="xz-phase-tap" class:is-on={mealCount === count} type="button" on:click={() => setMealCount(count)}>{count}</button>
                            {/each}
                        </span>
                        <span class="xz-phase-anchor__empty">{mealCount ? `已记 ${mealCount} 顿正餐` : "点数字即可，不需要记录吃了什么"}</span>
                    </div>
                    <p class="xz-phase-anchor__note">这一项只做计数，默认留空；不进营养统计，也不会去动营养摄入里的任何一条记录。</p>
                </div>
            {/if}

            {#if keptAnchorIds.includes("progress")}
                <div class="xz-phase-anchor xz-phase-anchor--wide">
                    <header><strong>今天推进了什么</strong><small>两格可以都填，也可以只填一格</small></header>
                    <div class="xz-phase-dual">
                        <div class="xz-phase-slot">
                            <span class="xz-phase-slot__label">个人事务<span>来自行舟的「项目与事务」</span></span>
                            {#if progressItem}
                                <div class="xz-phase-anchor__row">
                                    <span class="xz-phase-anchor__done">✓ {progressItem.title}</span>
                                    <button class="xz-phase-ghost" type="button" on:click={() => (progressOpen = true)}>换一个</button>
                                </div>
                            {:else}
                                <div class="xz-phase-anchor__row">
                                    <button class="xz-phase-action" type="button" on:click={() => (progressOpen = true)}>从今天的事务里选一个</button>
                                </div>
                            {/if}
                        </div>
                        <div class="xz-phase-slot">
                            <span class="xz-phase-slot__label">科研进展<span>自己写一句，不要求格式</span></span>
                            <div class="xz-phase-anchor__row">
                                <input class="xz-phase-input" placeholder="写一句科研进展" value={progressText} on:input={(event) => setProgressNote(event.currentTarget.value)} />
                            </div>
                        </div>
                    </div>
                    <p class="xz-phase-anchor__note">科研那格是自由文字。这里不读、也不写入别的插件的数据——只作为你事后回看的一句话。</p>
                </div>
            {/if}
        </div>

        <div class="xz-phase-tally">
            <span>紧急期第 <b>{dayIndex}</b> 天</span>
            <span>原定 <b>{plannedDays}</b> 天 · 当前到 <b>{formatDateShort(sprint.endDate)}</b></span>
            <span><em>不做连续天数、不做百分比——断了不会让前面归零。</em></span>
        </div>

        {#if error}<p class="xz-phase-error">{error}</p>{/if}
    </section>
{/if}

{#if showDeliveryPanel}
    <section class="xz-phase-delivery">
        <div class="xz-phase-delivery__head">
            <strong>这次交付完成了吗？</strong>
            <small>归航第 1 级 · 交付结果</small>
        </div>
        <div class="xz-phase-delivery__choices">
            {#each DELIVERY_OPTIONS as option}
                <button
                    class="xz-phase-tap"
                    class:is-on={record.fields.landingDeliveryState === option.value}
                    type="button"
                    aria-pressed={record.fields.landingDeliveryState === option.value}
                    on:click={() => patchFields({ landingDeliveryState: record.fields.landingDeliveryState === option.value ? "" : option.value })}
                >{option.label}</button>
            {/each}
        </div>
        <label class="xz-phase-delivery__note">
            <span>后面还等着什么（数据、脚本、笔记、筛选过程、复现步骤）</span>
            <textarea
                rows="3"
                placeholder="每行一条；这些是你以后能复现今天结果的东西，之后随便安排"
                value={record.fields.landingHandoverNote}
                on:input={onHandoverInput}
            ></textarea>
        </label>
        <p class="xz-phase-delivery__hint">这一级只有这一件事。等归航走完七级，完整记录才会恢复。</p>
    </section>
{/if}

{#if landing}
    <section class="xz-phase-landing xz-phase-landing--compact">
        {#if rung}
            <div class="xz-phase-landing__body">
                <div class="xz-phase-landing__head">
                    <strong>归航 · 第 {rung.index + 1} 级（共 {LANDING_RUNGS.length} 级）</strong>
                    <p>今天这一级：{rung.rung.text}。顺序固定，不需要你挑；7 天是节奏，不是截止。</p>
                </div>
                {#if rungDone}
                    <div class="xz-phase-landing__actions">
                        <span class="xz-phase-anchor__done">✓ 今天这一级已记录（{rungLog?.status === "skipped" ? "这一级不需要" : "做完"}）</span>
                    </div>
                {:else}
                    <div class="xz-phase-landing__actions">
                        <button class="xz-phase-action xz-phase-action--primary" type="button" disabled={busy} on:click={() => void actOnRung("done")}>做完了，明天进下一级</button>
                        <button class="xz-phase-action" type="button" disabled={busy} on:click={() => void actOnRung("deferred")}>今天不方便，明天再说</button>
                        <button class="xz-phase-ghost" type="button" disabled={busy} title="这一级不做了，明天直接进下一级" on:click={() => void actOnRung("skipped")}>这一级不需要</button>
                    </div>
                {/if}
            </div>
            {#if error}<p class="xz-phase-error">{error}</p>{/if}
        {:else}
            <div class="xz-phase-landing__body">
                <div class="xz-phase-landing__head">
                    <strong>归航 · 七级已走完</strong>
                    <p>归航结束。下面的数字只用来让你下次排期时心里有底——不打分、不排名、不和上个周期比较。</p>
                </div>
                <div class="xz-phase-fact">
                    <div><strong>{landedSummary(landing, store).days} 天</strong><span>{landing.sprintTitle || "紧急期"} 归航用了多久</span></div>
                    <div><strong>{landedSummary(landing, store).done} / {LANDING_RUNGS.length}</strong><span>做完的级数</span></div>
                    <div><strong>{landedSummary(landing, store).skipped}</strong><span>跳过的级数</span></div>
                    <div><strong>{landedSummary(landing, store).plannedDays} → {landedSummary(landing, store).actualDays} 天</strong><span>原定 / 实际的紧急期长度</span></div>
                </div>
                <div class="xz-phase-landing__actions" style="margin-top:10px">
                    <button class="xz-phase-action" type="button" on:click={() => dispatch("openTrends", {})}>看一下这段时间的睡眠窗口</button>
                    <button class="xz-phase-action" type="button" disabled={busy} on:click={() => (landingEndOpen = true)}>结束归航</button>
                </div>
            </div>
        {/if}
    </section>
{/if}

{#if extendOpen && sprint}
    <div class="xz-dialog-backdrop" use:portal role="presentation" on:click|self={() => (extendOpen = false)}>
    <div class="xz-phase-extend xz-phase-extend--modal">
        <div class="xz-phase-extend__head">
            <strong>延长到哪天？</strong>
            <small>目标不变 · 第 {sprint.extensionCount + 1} 次延长 · 现在到 {formatDateShort(sprint.endDate)}</small>
        </div>
        <div class="xz-phase-extend__quick">
            <button class="xz-phase-action" type="button" on:click={() => (extendValue = shift(sprint.endDate, 3))}>+3 天</button>
            <button class="xz-phase-action" type="button" on:click={() => (extendValue = shift(sprint.endDate, 7))}>+7 天</button>
            <button class="xz-phase-action" type="button" on:click={() => (extendValue = shift(sprint.endDate, 14))}>+14 天</button>
            <input class="xz-phase-input" style="max-width:168px" type="date" aria-label="新的结束日" bind:value={extendValue} />
        </div>
        <p class="xz-phase-extend__note">延长就是延长：目标不缩小、不换成别的东西，结束日改到你选的那天，延长次数照实记下来。<b>它不会因为你延了几次而改变任何判定</b>。下次估工期时，这个次数就是你的参考值。</p>
        <div class="xz-phase-extend__actions">
            <button class="xz-phase-action xz-phase-action--primary" type="button" disabled={busy} on:click={() => void confirmExtend()}>按这个日期延长</button>
            <button class="xz-phase-action" type="button" on:click={() => (extendOpen = false)}>取消</button>
        </div>
    </div>
    </div>
{/if}

{#if endOpen && sprint}
    <div class="xz-dialog-backdrop" use:portal role="presentation" on:click|self={() => (endOpen = false)}>
    <div class="xz-phase-dialog" role="dialog" aria-modal="true">
        <header><strong>结束紧急期？</strong><small>接下来进入归航</small></header>
        <div class="xz-phase-dialog__body">
            <p class="xz-phase-core__lead" style="margin:0">{formatDateShort(sprint.startDate)}–{formatDateShort(sprint.endDate)} 这 {sprintDayCount(sprint)} 天会标为<b>紧急期</b>：不进趋势折线、不进达成率，但睡眠与锚点数据保留，事后能读懂这段时间。已经写下的内容一个字都不会动。</p>
            <div class="xz-phase-checkline" style="align-items:flex-start">
                <span style="flex:1 1 auto;color:var(--xingzhou-text);font-size:12.5px">结束时会提醒你一件事：去「<b>思源任务中心</b>」建一条<b>「整理{sprint.title ? ` · ${sprint.title}` : ""}」</b>——把这次用过的脚本、筛选过程、笔记归到一起，方便以后复现。行舟不替你在那边建任务，只提醒。</span>
            </div>
        </div>
        <footer>
            <p>归航不是补记；它是把节律一级一级开回来。</p>
            <div>
                <button class="xz-phase-action" type="button" on:click={() => (endOpen = false)}>取消</button>
                <button class="xz-phase-action" type="button" disabled={busy} on:click={() => void confirmEnd(false)}>结束，不归航</button>
                <button class="xz-phase-action xz-phase-action--primary" type="button" disabled={busy} on:click={() => void confirmEnd(true)}>结束并开始归航</button>
            </div>
        </footer>
    </div>
    </div>
{/if}

{#if landingEndOpen && landing}
    <div class="xz-dialog-backdrop" use:portal role="presentation" on:click|self={() => (landingEndOpen = false)}>
    <div class="xz-phase-dialog" role="dialog" aria-modal="true">
        <header><strong>结束归航？</strong><small>以后可以再开一次</small></header>
        <div class="xz-phase-dialog__body">
            <p class="xz-phase-core__lead" style="margin:0">结束不是失败，只是这件事先到这里。已经记录的级数不会丢，以后再开一次归航时会从新的一级开始。</p>
        </div>
        <footer>
            <p>停在某一级多久都不会影响任何统计。</p>
            <div>
                <button class="xz-phase-action" type="button" on:click={() => (landingEndOpen = false)}>继续归航</button>
                <button class="xz-phase-action xz-phase-action--primary" type="button" disabled={busy} on:click={() => void finishLanding()}>结束归航</button>
            </div>
        </footer>
    </div>
    </div>
{/if}

{#if progressOpen}
    <div class="xz-dialog-backdrop" use:portal role="presentation" on:click|self={() => (progressOpen = false)}>
    <div class="xz-phase-dialog" role="dialog" aria-modal="true">
        <header><strong>从今天的事务里选一个</strong><small>只列今天安排过切片的事务</small></header>
        <div class="xz-phase-dialog__body">
            {#if todaySlices.length}
                <div class="xz-phase-return">
                    {#each todaySlices as entry (entry.slice.id)}
                        <div class="xz-phase-return__item">
                            <span>{entry.item.title}<small>今天 {entry.slice.status === "completed" ? "已完成" : entry.slice.status === "abandoned" ? "已放弃" : "已安排"}{entry.item.durationMinutes === null ? " · 未估时" : ` · ${entry.item.durationMinutes} 分`}</small></span>
                            <span class="xz-phase-return__choices">
                                <button type="button" on:click={() => chooseProgress(entry.item)}>选它</button>
                                <button type="button" on:click={() => openWorkItem(entry.item.id)}>打开</button>
                            </span>
                        </div>
                    {/each}
                </div>
            {:else}
                <p class="xz-phase-core__lead" style="margin:0">今天还没有安排过执行切片的事务。可以直接写一句话，也可以在「项目与事务」里安排今天的切片。</p>
            {/if}
        </div>
        <footer>
            <p>选中的事务会记账到这一天的锚点上。</p>
            <div><button class="xz-phase-action" type="button" on:click={() => (progressOpen = false)}>取消</button></div>
        </footer>
    </div>
    </div>
{/if}

{#if sleepEntryOpen}
    <div class="xz-dialog-backdrop" use:portal role="presentation" on:click|self={() => (sleepEntryOpen = false)}>
    <div class="xz-phase-dialog" role="dialog" aria-modal="true">
        <header><strong>只记时段</strong><small>不想记具体时刻时用</small></header>
        <div class="xz-phase-dialog__body">
            <div class="xz-phase-checkline">深夜不记精确时间：把今天标成「熬夜」即可，趋势里会画成红色竖带，不会猜一个时间。</div>
        </div>
        <footer>
            <p>熬夜是记录，不是判定。</p>
            <div>
                <button class="xz-phase-action" type="button" on:click={() => (sleepEntryOpen = false)}>取消</button>
                <button class="xz-phase-action xz-phase-action--primary" type="button" on:click={() => { patchFields({ lightsOffTime: "", lightsOffTimeSource: "", lightsOffBand: "after-midnight" }); sleepEntryOpen = false; }}>标为「12 点后」</button>
            </div>
        </footer>
    </div>
    </div>
{/if}
