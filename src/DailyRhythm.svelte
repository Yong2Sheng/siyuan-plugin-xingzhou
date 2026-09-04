<script lang="ts">
    import {
        DAILY_RUBRICS,
        cloneDailyRecord,
        createDailyRecord,
        defaultDayType,
        isWorkMetricApplicable,
        resolveSleepDateTimes,
        type ClosureNeed,
        type DailyDayType,
        type DailyRecord,
        type DailyRecordStore,
        type DailyRubric,
        type ResultState,
    } from "./daily-records";
    import DurationSelect from "./DurationSelect.svelte";
    import ScoreInput from "./ScoreInput.svelte";
    import TimeSelect from "./TimeSelect.svelte";

    export let loadDaily: () => Promise<DailyRecordStore>;
    export let saveDaily: (record: DailyRecord) => Promise<DailyRecordStore>;

    type View = "today" | "history" | "rubrics" | "timeline";
    type Stage = "morning" | "learning" | "boundary" | "recovery" | "evening" | "all";

    const dayTypes: Array<{ value: DailyDayType; label: string; guidance: string }> = [
        { value: "research-workday", label: "科研工作日", guidance: "记录完整科研工作、学习、下班边界和个人生活。" },
        { value: "saturday-reset", label: "周六轻量复盘", guidance: "轻量复盘后进入至少 24 小时完全无工作区间。" },
        { value: "sunday-half-day", label: "周日半日科研", guidance: "上午休息，12:00–17:00 科研，17:00 后回到个人生活。" },
        { value: "holiday", label: "休假／节假日", guidance: "科研字段不适用，只记录身体、恢复、训练、生活与晚间观察。" },
    ];
    const profileRows = [
        ["科研工作日", "周一至周五默认", "早晨安排", "完整科研与工作边界", "晚间复盘"],
        ["周六轻量复盘", "周六默认", "轻量工作复盘", "随后 24 小时无工作", "生活与恢复"],
        ["周日半日科研", "周日默认", "上午不工作", "12:00–17:00 科研", "17:00 后个人生活"],
        ["休假／节假日", "按日期覆盖", "科研字段不适用", "不计入工作达标率", "身体、休息与生活"],
    ];
    const rubricById = Object.fromEntries(DAILY_RUBRICS.map((rubric) => [rubric.id, rubric])) as Record<DailyRubric["id"], DailyRubric>;

    let store: DailyRecordStore | null = null;
    let currentDate = localDateKey();
    let draft = createDailyRecord(currentDate);
    let view: View = "today";
    let stage: Stage = "morning";
    let selectedRubric: DailyRubric = DAILY_RUBRICS[0];
    let loading = true;
    let saving = false;
    let dirty = false;
    let error = "";
    let message = "";

    $: workApplicable = isWorkMetricApplicable(draft.dayType);
    $: dayGuidance = dayTypes.find((entry) => entry.value === draft.dayType)?.guidance ?? "";
    $: boundary = calculateBoundary(draft.fields.plannedWorkEndTime, draft.fields.actualWorkEndTime);
    $: resolvedSleep = resolveSleepDateTimes(draft);

    Promise.resolve().then(() => void refresh());

    async function refresh() {
        loading = true;
        error = "";
        try {
            applyStore(await loadDaily(), currentDate);
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        } finally {
            loading = false;
        }
    }

    function applyStore(next: DailyRecordStore, date: string) {
        store = next;
        currentDate = date;
        draft = cloneDailyRecord(next.records.find((record) => record.date === date) ?? createDailyRecord(date));
        dirty = false;
    }

    function openDate(date: string) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        currentDate = date;
        draft = cloneDailyRecord(store?.records.find((record) => record.date === date) ?? createDailyRecord(date));
        dirty = false;
        message = "";
        error = "";
    }

    function shiftDate(days: number) {
        const date = new Date(`${currentDate}T12:00:00`);
        date.setDate(date.getDate() + days);
        openDate(localDateKey(date));
    }

    function markDirty() {
        dirty = true;
        message = "";
    }

    function changeDayType(dayType: string) {
        if (!dayTypes.some((entry) => entry.value === dayType)) return;
        draft.dayType = dayType as DailyDayType;
        if (dayType === "holiday" && (stage === "learning" || stage === "boundary")) stage = "recovery";
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changeKeyWorkResult(value: string) {
        const allowed: ResultState[] = ["", "met", "exceeded", "missed", "not-applicable"];
        if (!allowed.includes(value as ResultState)) return;
        draft.fields.keyWorkResult = value as ResultState;
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    function changeClosureNeed(value: string) {
        const allowed: ClosureNeed[] = ["", "not-needed", "needed"];
        if (!allowed.includes(value as ClosureNeed)) return;
        draft.fields.closureNeed = value as ClosureNeed;
        draft = { ...draft, fields: { ...draft.fields } };
        markDirty();
    }

    async function save() {
        if (saving) return;
        saving = true;
        error = "";
        message = "";
        try {
            const next = await saveDaily(cloneDailyRecord(draft));
            applyStore(next, currentDate);
            message = `${formatDate(currentDate)} 已保存并复核`;
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        } finally {
            saving = false;
        }
    }

    function inspectRubric(event: CustomEvent<DailyRubric>) {
        selectedRubric = event.detail;
    }

    function scoreDirection(rubric: DailyRubric): string {
        if (rubric.direction === "higher-is-better") return "越高越好";
        if (rubric.direction === "lower-is-better") return "越低越好";
        return "看是否适度且可控";
    }

    function statusFor(record: DailyRecord): string {
        if (!isWorkMetricApplicable(record.dayType)) return "工作指标不适用";
        const result = calculateBoundary(record.fields.plannedWorkEndTime, record.fields.actualWorkEndTime);
        return result?.label ?? "下班边界待填写";
    }

    function localDateKey(date = new Date()): string {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function formatDate(date: string): string {
        const parsed = new Date(`${date}T12:00:00`);
        return `${parsed.getFullYear()} 年 ${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日`;
    }

    function dayTypeLabel(dayType: DailyDayType): string {
        return dayTypes.find((entry) => entry.value === dayType)?.label ?? dayType;
    }

    function shortDateFromLocalDateTime(value: string): string {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return "";
        const date = new Date(`${value.slice(0, 10)}T12:00:00`);
        return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
    }

    function calculateBoundary(planned: string, actual: string): { late: boolean; difference: number; label: string } | null {
        if (!/^\d{2}:\d{2}$/.test(planned) || !/^\d{2}:\d{2}$/.test(actual)) return null;
        const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
        const difference = toMinutes(actual) - toMinutes(planned);
        return {
            late: difference > 0,
            difference,
            label: difference > 0 ? `超出计划 ${difference} 分钟` : difference === 0 ? "正好按计划下班" : `比计划早 ${Math.abs(difference)} 分钟`,
        };
    }
</script>

<section class="xz-daily-module" on:input={markDirty} on:change={markDirty}>
    <div class="xz-daily-toolbar">
        <div class="xz-daily-date-nav">
            <button type="button" aria-label="前一天" on:click={() => shiftDate(-1)}>‹</button>
            <input type="date" aria-label="记录日期" value={currentDate} on:change|stopPropagation={(event) => openDate(event.currentTarget.value)} />
            <button type="button" aria-label="后一天" on:click={() => shiftDate(1)}>›</button>
            <button type="button" on:click={() => openDate(localDateKey())}>今天</button>
        </div>
        <nav class="xz-daily-view-nav" aria-label="生活节律视图">
            <button class:active={view === "today"} type="button" on:click={() => view = "today"}>今日记录</button>
            <button class:active={view === "history"} type="button" on:click={() => view = "history"}>历史数据</button>
            <button class:active={view === "rubrics"} type="button" on:click={() => view = "rubrics"}>评分标准</button>
            <button class:active={view === "timeline"} type="button" on:click={() => view = "timeline"}>时间线</button>
        </nav>
    </div>

    {#if loading}
        <div class="xz-state"><span class="xz-spinner"></span><p>正在读取生活节律内部数据……</p></div>
    {:else if error && !store}
        <div class="xz-state xz-error"><h2>暂时无法读取生活节律数据</h2><p>{error}</p><button class="b3-button" type="button" on:click={() => void refresh()}>重试</button></div>
    {:else if view === "today"}
        <div class="xz-daily-context">
            <label><span>今日类型</span><select value={draft.dayType} on:change|stopPropagation={(event) => changeDayType(event.currentTarget.value)}>{#each dayTypes as type}<option value={type.value}>{type.label}</option>{/each}</select></label>
            <p>{dayGuidance} 日期类型可以覆盖每周默认。</p>
        </div>

        <div class="xz-daily-progress" class:holiday={!workApplicable}>
            <div><i>1</i><span><strong>早晨记录</strong><small>睡眠、身体与安排</small></span></div>
            {#if workApplicable}
                <div><i>2</i><span><strong>午饭后学习</strong><small>材料、主题与停点</small></span></div>
                <div class:late={boundary?.late}><i>{boundary ? boundary.late ? "×" : "✓" : "3"}</i><span><strong>工作边界</strong><small>{boundary?.label ?? "等待下班记录"}</small></span></div>
            {:else}
                <div><i>2</i><span><strong>恢复与生活</strong><small>科研字段不适用</small></span></div>
            {/if}
            <div><i>{workApplicable ? "4" : "3"}</i><span><strong>21:00 复盘</strong><small>生活结果与明日承接</small></span></div>
        </div>

        <div class="xz-daily-layout">
            <article class="xz-daily-record">
                <header class="xz-daily-record-header">
                    <div><h2>{formatDate(currentDate)}</h2><p>{dayTypeLabel(draft.dayType)} · {store?.records.some((record) => record.date === currentDate) ? "已有记录" : "尚未保存"}</p></div>
                    <nav class="xz-daily-stage-nav" aria-label="填写阶段">
                        <button class:active={stage === "morning"} type="button" on:click={() => stage = "morning"}>早晨</button>
                        {#if workApplicable}<button class:active={stage === "learning"} type="button" on:click={() => stage = "learning"}>午饭后</button><button class:active={stage === "boundary"} type="button" on:click={() => stage = "boundary"}>下班</button>{:else}<button class:active={stage === "recovery"} type="button" on:click={() => stage = "recovery"}>恢复</button>{/if}
                        <button class:active={stage === "evening"} type="button" on:click={() => stage = "evening"}>21:00</button>
                        <button class:active={stage === "all"} type="button" on:click={() => stage = "all"}>全部</button>
                    </nav>
                </header>

                {#if stage === "morning" || stage === "all"}
                    <section class="xz-daily-form-section">
                        <h3>睡眠与身体</h3>
                        <div class="xz-daily-fields three">
                            <div class="xz-daily-field"><span class="xz-daily-label-with-note">昨晚熄灯 {#if resolvedSleep.fields.lightsOffAt}<small>{shortDateFromLocalDateTime(resolvedSleep.fields.lightsOffAt)}</small>{/if}</span><TimeSelect bind:value={draft.fields.lightsOffTime} ariaLabel="昨晚熄灯" /></div>
                            <div class="xz-daily-field"><span class="xz-daily-label-with-note">今日起床 {#if resolvedSleep.fields.wakeAt}<small>{shortDateFromLocalDateTime(resolvedSleep.fields.wakeAt)}</small>{/if}</span><TimeSelect bind:value={draft.fields.wakeTime} ariaLabel="今日起床" /></div>
                            <div class="xz-daily-field"><span>睡眠时长</span><DurationSelect bind:value={draft.fields.sleepDurationMinutes} maxHours={16} ariaLabel="睡眠时长" /></div>
                            <label><span>手表睡眠评分</span><input class="xz-daily-compact-number" type="number" min="0" max="100" bind:value={draft.fields.watchSleepScore} placeholder="未填写" /></label>
                            <ScoreInput bind:value={draft.fields.subjectiveSleepQuality} rubric={rubricById.subjectiveSleepQuality} on:inspect={inspectRubric} on:change={markDirty} />
                            <label><span>晨起体重</span><div class="xz-daily-inline"><input type="number" min="0" step="0.1" bind:value={draft.fields.morningWeight} placeholder="未填写" /><select bind:value={draft.fields.weightUnit}><option value="kg">kg</option><option value="lb">lb</option></select></div></label>
                        </div>
                    </section>
                    <section class="xz-daily-form-section">
                        <h3>今日安排</h3>
                        <div class="xz-daily-fields two">
                            {#if workApplicable}
                                <div class="xz-daily-field"><span>上班时间</span><TimeSelect bind:value={draft.fields.workStartTime} ariaLabel="上班时间" /></div>
                                <div class="xz-daily-field"><span>计划下班时间</span><TimeSelect bind:value={draft.fields.plannedWorkEndTime} ariaLabel="计划下班时间" /></div>
                                <label><span>今天最重要的工作内容</span><textarea bind:value={draft.fields.importantWorkPlan}></textarea></label>
                            {:else}
                                <label><span>今天如何休息／个人生活重点</span><textarea bind:value={draft.fields.restAndLifePlan} placeholder="例如：散步、做饭、陪伴家人、完全离开科研"></textarea></label>
                            {/if}
                            <label><span>今日节奏与临时调整</span><textarea bind:value={draft.fields.dayAdjustments}></textarea></label>
                            <label><span>今天的训练内容</span><textarea bind:value={draft.fields.trainingPlan}></textarea></label>
                            <label><span>今天的个人项目</span><textarea bind:value={draft.fields.personalProjectPlan}></textarea></label>
                        </div>
                    </section>
                {/if}

                {#if workApplicable && (stage === "learning" || stage === "all")}
                    <section class="xz-daily-form-section">
                        <h3>午饭后专业学习安排</h3>
                        <div class="xz-daily-fields two">
                            <label><span>书目／材料</span><input bind:value={draft.fields.studyMaterial} /></label>
                            <label><span>章节／主题</span><input bind:value={draft.fields.studyTopic} /></label>
                            <label><span>学习安排</span><textarea bind:value={draft.fields.studyPlan}></textarea></label>
                            <label><span>完成时长与页码／停点</span><textarea bind:value={draft.fields.studyResult}></textarea></label>
                        </div>
                    </section>
                {/if}

                {#if workApplicable && (stage === "boundary" || stage === "all")}
                    <section class="xz-daily-form-section">
                        <h3>工作时间边界</h3>
                        <div class="xz-daily-fields three">
                            <label><span>早晨确定的计划下班时间</span><output>{draft.fields.plannedWorkEndTime || "未填写"}</output></label>
                            <div class="xz-daily-field"><span>实际下班时间</span><TimeSelect bind:value={draft.fields.actualWorkEndTime} ariaLabel="实际下班时间" /></div>
                            <label><span>下班结果（自动计算）</span><output class:late={boundary?.late} class:good={boundary && !boundary.late}>{boundary ? `${boundary.late ? "×" : "✓"} ${boundary.label}` : "填写两项时间后自动计算"}</output></label>
                        </div>
                    </section>
                    <section class="xz-daily-form-section">
                        <h3>结果与状态评分</h3>
                        <div class="xz-daily-fields two">
                            <label><span>关键工作结果</span><select value={draft.fields.keyWorkResult} on:change|stopPropagation={(event) => changeKeyWorkResult(event.currentTarget.value)}><option value="">尚未填写</option><option value="met">✓ 达标</option><option value="exceeded">★ 超预期</option><option value="missed">× 未达标</option></select></label>
                            <label><span>完成训练</span><select bind:value={draft.fields.trainingCompleted}><option value="">尚未填写</option><option value="yes">✓ 已完成</option><option value="no">× 未完成</option><option value="not-applicable">— 休息日</option></select></label>
                            <label><span>今天最重要的工作结果</span><textarea bind:value={draft.fields.importantWorkResult}></textarea></label>
                            <div class="xz-daily-field"><span>个人项目实际时长</span><DurationSelect bind:value={draft.fields.personalProjectDurationMinutes} maxHours={12} ariaLabel="个人项目实际时长" /></div>
                            <ScoreInput bind:value={draft.fields.daytimeEnergy} rubric={rubricById.daytimeEnergy} on:inspect={inspectRubric} on:change={markDirty} />
                            <ScoreInput bind:value={draft.fields.workEfficiency} rubric={rubricById.workEfficiency} on:inspect={inspectRubric} on:change={markDirty} />
                            <ScoreInput bind:value={draft.fields.promotingStress} rubric={rubricById.promotingStress} on:inspect={inspectRubric} on:change={markDirty} />
                            <ScoreInput bind:value={draft.fields.depletingStress} rubric={rubricById.depletingStress} on:inspect={inspectRubric} on:change={markDirty} />
                        </div>
                    </section>
                    <section class="xz-daily-form-section">
                        <h3>下班后工作闭环入口（按需）</h3>
                        <div class="xz-daily-fields two">
                            <label class="xz-daily-closure-choice">
                                <span>本次是否需要工作闭环</span>
                                <select value={draft.fields.closureNeed} on:change|stopPropagation={(event) => changeClosureNeed(event.currentTarget.value)}>
                                    <option value="">尚未确认</option>
                                    <option value="not-needed">不需要</option>
                                    <option value="needed">需要</option>
                                </select>
                            </label>
                        </div>
                        {#if draft.fields.closureNeed === "needed"}
                            <div class="xz-daily-fields two xz-daily-closure-details">
                                <label><span>对象／材料</span><textarea bind:value={draft.fields.closureObject} placeholder="只记录待整理入口，不在这里展开执行"></textarea></label>
                                <div class="xz-daily-field"><span>预计时间</span><DurationSelect bind:value={draft.fields.closurePlannedMinutes} maxHours={4} ariaLabel="工作闭环预计时间" /></div>
                                <label><span>是否有下一步安排</span><textarea bind:value={draft.fields.closureNextStep} placeholder="写清下一步，不开始下一步"></textarea></label>
                                <div class="xz-daily-field"><span>实际闭环时长</span><DurationSelect bind:value={draft.fields.closureActualMinutes} maxHours={4} ariaLabel="工作闭环实际时长" /></div>
                            </div>
                        {:else if draft.fields.closureNeed === "not-needed"}
                            <p class="xz-daily-closure-note">今天不需要下班后工作闭环；相关时间按“不适用”保存，不计为 0 分钟。</p>
                        {:else}
                            <p class="xz-daily-closure-note">确认是否需要闭环后再填写；“尚未确认”表示还没有完成判断。</p>
                        {/if}
                    </section>
                {/if}

                {#if !workApplicable && (stage === "recovery" || stage === "all")}
                    <section class="xz-daily-form-section">
                        <h3>恢复与生活</h3>
                        <div class="xz-daily-fields two">
                            <ScoreInput bind:value={draft.fields.daytimeEnergy} rubric={rubricById.daytimeEnergy} on:inspect={inspectRubric} on:change={markDirty} />
                            <label><span>完成训练</span><select bind:value={draft.fields.trainingCompleted}><option value="">尚未填写</option><option value="yes">✓ 已完成</option><option value="no">× 未完成</option><option value="not-applicable">— 休息日</option></select></label>
                            <label><span>今天的个人生活或兴趣项目结果</span><textarea bind:value={draft.fields.personalLifeResult}></textarea></label>
                            <div class="xz-daily-field"><span>个人项目实际时长</span><DurationSelect bind:value={draft.fields.personalProjectDurationMinutes} maxHours={12} ariaLabel="个人项目实际时长" /></div>
                        </div>
                    </section>
                {/if}

                {#if stage === "evening" || stage === "all"}
                    <section class="xz-daily-form-section">
                        <h3>21:00 简要复盘</h3>
                        <div class="xz-daily-fields two">
                            {#if workApplicable}<label><span>今天的个人生活或兴趣项目结果</span><textarea bind:value={draft.fields.personalLifeResult}></textarea></label>{/if}
                            <label><span>今天做得最好的一件事</span><textarea bind:value={draft.fields.bestThing}></textarea></label>
                            <label><span>今天最大的阻碍或消耗</span><textarea bind:value={draft.fields.obstacleOrCost}></textarea></label>
                            {#if workApplicable}<label><span>如果下班后处理了工作，原因</span><textarea bind:value={draft.fields.afterHoursWorkReason} placeholder="没有则留空"></textarea></label><label><span>明天开始工作时的第一个动作</span><textarea bind:value={draft.fields.tomorrowFirstAction}></textarea></label>{/if}
                            <label><span>其他需要记录的异常或观察</span><textarea bind:value={draft.fields.anomalyOrObservation}></textarea></label>
                        </div>
                    </section>
                    <section class="xz-daily-form-section">
                        <h3>睡前准备</h3>
                        <div class="xz-daily-fields two">
                            <label><span>21:00 开始睡前准备</span><select bind:value={draft.fields.bedtimePreparation}><option value="">尚未填写</option><option value="yes">✓ 是</option><option value="no">× 否</option></select></label>
                            <div class="xz-daily-field"><span>计划熄灯时间</span><TimeSelect bind:value={draft.fields.plannedLightsOffTime} ariaLabel="计划熄灯时间" /></div>
                        </div>
                    </section>
                {/if}

                <footer class="xz-daily-save-bar">
                    <div>{#if error}<span class="error" role="alert">{error}</span>{:else if message}<span class="success" role="status">{message}</span>{:else if dirty}<span>有尚未保存的修改</span>{/if}</div>
                    <button class="b3-button" type="button" disabled={saving} on:click={() => void save()}>{saving ? "正在保存并复核…" : "保存今日记录"}</button>
                </footer>
            </article>

            <aside class="xz-daily-rubric-card">
                <header><h3>评分规则</h3><p>{selectedRubric.label} · {scoreDirection(selectedRubric)}</p></header>
                <ol>{#each selectedRubric.levels as level, index}<li class:active={draft.fields[selectedRubric.id] === index + 1}><b>{index + 1}</b><span>{level}</span></li>{/each}</ol>
                <p class="xz-daily-rubric-note">规则随当前评分字段切换，填写时不必再打开评估表文档。</p>
            </aside>
        </div>
    {:else if view === "history"}
        <section class="xz-daily-list-view">
            <header><div><span class="xz-section-kicker">插件内部数据库</span><h2>历史数据</h2></div><span>{store?.records.length ?? 0} 天</span></header>
            {#if !store?.records.length}<div class="xz-daily-empty"><h3>还没有每日记录</h3><p>从 9 月 3 日开始手动录入即可；这里不会迁移旧文档数据。</p></div>{:else}{#each [...store.records].reverse() as record (record.date)}<button class="xz-daily-history-row" type="button" on:click={() => { openDate(record.date); view = "today"; }}><strong>{record.date}</strong><span>{dayTypeLabel(record.dayType)}</span><span>睡眠 {record.fields.sleepDurationMinutes === null ? "—" : `${Math.floor(record.fields.sleepDurationMinutes / 60)} 小时 ${record.fields.sleepDurationMinutes % 60} 分`}</span><span>精力 {record.fields.daytimeEnergy ?? "—"}</span><span>{statusFor(record)}</span></button>{/each}{/if}
        </section>
    {:else if view === "rubrics"}
        <section class="xz-daily-list-view">
            <header><div><span class="xz-section-kicker">固定评分口径</span><h2>评分标准</h2></div></header>
            {#each DAILY_RUBRICS as rubric}<article class="xz-daily-rubric-row"><strong>{rubric.label}</strong><span>1 · {rubric.levels[0]}</span><span>3 · {rubric.levels[2]}</span><span>5 · {rubric.levels[4]}</span><em>{scoreDirection(rubric)}</em></article>{/each}
        </section>
    {:else}
        <section class="xz-daily-list-view">
            <header><div><span class="xz-section-kicker">每周默认，可逐日覆盖</span><h2>生活节律时间线</h2></div></header>
            {#each profileRows as row}<article class="xz-daily-timeline-row">{#each row as cell, index}{#if index === 0}<strong>{cell}</strong>{:else}<span>{cell}</span>{/if}{/each}</article>{/each}
        </section>
    {/if}
</section>
