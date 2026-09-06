<script lang="ts">
    import {
        cloneNutritionStore,
        macroCalorieShares,
        nutritionEntryRatio,
        nutritionTotalsForDate,
        type NutritionEntry,
        type NutritionStore,
        type NutritionTemplate,
        type NutritionValues,
    } from "./nutrition";

    export let date: string;
    export let load: () => Promise<NutritionStore>;
    export let save: (store: NutritionStore) => Promise<NutritionStore>;

    type FoodDraft = {
        name: string;
        baseAmount: string;
        unit: string;
        caloriesKcal: string;
        proteinGrams: string;
        carbsGrams: string;
        fatGrams: string;
    };

    let store: NutritionStore | null = null;
    let loading = true;
    let saving = false;
    let error = "";
    let message = "";
    let managerOpen = false;
    let editingTemplateId: string | null = null;
    let editingEntryId: string | null = null;
    let amountTemplate: NutritionTemplate | null = null;
    let amountDraft = "";
    let manualDraft = emptyFoodDraft();
    let templateDraft = emptyFoodDraft();
    let calorieGoalDraft = "";
    let proteinGoalDraft = "";

    $: todayEntries = (store?.entries ?? []).filter((entry) => entry.date === date).sort((a, b) => b.createdAt - a.createdAt);
    $: totals = store ? nutritionTotalsForDate(store, date) : { caloriesKcal: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0, entries: 0 };
    $: shares = macroCalorieShares(totals);
    $: calorieProgress = progress(totals.caloriesKcal, store?.goals.caloriesKcal ?? null);
    $: proteinProgress = progress(totals.proteinGrams, store?.goals.proteinGrams ?? null);

    Promise.resolve().then(() => void refresh());

    async function refresh() {
        loading = true;
        error = "";
        try {
            applyStore(await load());
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        } finally {
            loading = false;
        }
    }

    function applyStore(next: NutritionStore) {
        store = cloneNutritionStore(next);
        calorieGoalDraft = next.goals.caloriesKcal === null ? "" : String(next.goals.caloriesKcal);
        proteinGoalDraft = next.goals.proteinGrams === null ? "" : String(next.goals.proteinGrams);
    }

    async function persist(next: NutritionStore, success: string) {
        if (saving) return false;
        saving = true;
        error = "";
        message = "";
        try {
            applyStore(await save(next));
            message = success;
            return true;
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
            return false;
        } finally {
            saving = false;
        }
    }

    async function addFromTemplate(template: NutritionTemplate, amount = template.baseAmount) {
        if (!store) return;
        const now = Date.now();
        const entry: NutritionEntry = {
            id: createId("nutrition-entry"),
            date,
            templateId: template.id,
            nameSnapshot: template.name,
            baseAmountSnapshot: template.baseAmount,
            unitSnapshot: template.unit,
            valuesPerServing: { ...template.values },
            consumedAmount: amount,
            createdAt: now,
            updatedAt: now,
        };
        if (await persist({ ...cloneNutritionStore(store), entries: [...store.entries, entry] }, `已记录：${template.name} ${formatAmount(amount, template.unit)}`)) closeAmountDialog();
    }

    function openAmountDialog(template: NutritionTemplate) {
        amountTemplate = template;
        amountDraft = String(template.baseAmount);
        error = "";
        message = "";
    }

    function closeAmountDialog() {
        amountTemplate = null;
        amountDraft = "";
    }

    async function addCustomAmount() {
        if (!amountTemplate) return;
        const amount = parsePositiveNumber(amountDraft);
        if (amount === null) {
            error = "实际摄入量必须是大于 0 的数字。";
            return;
        }
        await addFromTemplate(amountTemplate, amount);
    }

    async function saveManualEntry() {
        if (!store) return;
        const parsed = parseFoodDraft(manualDraft);
        if (!parsed) return;
        const now = Date.now();
        const existing = editingEntryId ? store.entries.find((entry) => entry.id === editingEntryId) : null;
        const entry: NutritionEntry = {
            id: existing?.id ?? createId("nutrition-entry"),
            date: existing?.date ?? date,
            templateId: existing?.templateId ?? null,
            nameSnapshot: parsed.name,
            baseAmountSnapshot: parsed.baseAmount,
            unitSnapshot: parsed.unit,
            valuesPerServing: parsed.values,
            consumedAmount: existing?.consumedAmount ?? parsed.baseAmount,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        const entries = existing
            ? store.entries.map((candidate) => candidate.id === entry.id ? entry : candidate)
            : [...store.entries, entry];
        if (await persist({ ...cloneNutritionStore(store), entries }, existing ? "摄入记录已更新" : `已记录：${entry.nameSnapshot}`)) cancelEntryEdit();
    }

    function editEntry(entry: NutritionEntry) {
        editingEntryId = entry.id;
        manualDraft = foodDraft(entry.nameSnapshot, entry.baseAmountSnapshot, entry.unitSnapshot, entry.valuesPerServing);
        message = "";
        error = "";
    }

    function cancelEntryEdit() {
        editingEntryId = null;
        manualDraft = emptyFoodDraft();
    }

    async function changeAmount(entry: NutritionEntry, amount: number) {
        if (!store) return;
        if (!Number.isFinite(amount) || amount <= 0 || amount === entry.consumedAmount) return;
        const consumedAmount = Math.round(amount * 100) / 100;
        const entries = store.entries.map((candidate) => candidate.id === entry.id ? { ...candidate, consumedAmount, updatedAt: Date.now() } : candidate);
        await persist({ ...cloneNutritionStore(store), entries }, `${entry.nameSnapshot} 已调整为 ${formatAmount(consumedAmount, entry.unitSnapshot)}`);
    }

    async function changeAmountFromInput(entry: NutritionEntry, value: string) {
        const amount = parsePositiveNumber(value);
        if (amount === null) {
            error = "实际摄入量必须是大于 0 的数字。";
            return;
        }
        await changeAmount(entry, amount);
    }

    async function deleteEntry(entry: NutritionEntry) {
        if (!store) return;
        await persist({ ...cloneNutritionStore(store), entries: store.entries.filter((candidate) => candidate.id !== entry.id) }, `已移除：${entry.nameSnapshot}`);
        if (editingEntryId === entry.id) cancelEntryEdit();
    }

    async function saveTemplate() {
        if (!store) return;
        const parsed = parseFoodDraft(templateDraft);
        if (!parsed) return;
        const now = Date.now();
        const existing = editingTemplateId ? store.templates.find((template) => template.id === editingTemplateId) : null;
        const template: NutritionTemplate = {
            id: existing?.id ?? createId("nutrition-template"),
            name: parsed.name,
            baseAmount: parsed.baseAmount,
            unit: parsed.unit,
            values: parsed.values,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        const templates = existing
            ? store.templates.map((candidate) => candidate.id === template.id ? template : candidate)
            : [...store.templates, template];
        if (await persist({ ...cloneNutritionStore(store), templates }, existing ? "模板已更新；历史记录保持原值" : `模板“${template.name}”已建立`)) cancelTemplateEdit();
    }

    function editTemplate(template: NutritionTemplate) {
        editingTemplateId = template.id;
        templateDraft = foodDraft(template.name, template.baseAmount, template.unit, template.values);
        managerOpen = true;
        message = "";
        error = "";
    }

    function cancelTemplateEdit() {
        editingTemplateId = null;
        templateDraft = emptyFoodDraft();
    }

    async function deleteTemplate(template: NutritionTemplate) {
        if (!store) return;
        const templates = store.templates.filter((candidate) => candidate.id !== template.id);
        if (await persist({ ...cloneNutritionStore(store), templates }, `模板“${template.name}”已删除；历史记录不受影响`) && editingTemplateId === template.id) cancelTemplateEdit();
    }

    async function saveGoals() {
        if (!store) return;
        const caloriesKcal = parseOptionalNumber(calorieGoalDraft);
        const proteinGrams = parseOptionalNumber(proteinGoalDraft);
        if (caloriesKcal === undefined || proteinGrams === undefined) {
            error = "目标必须是大于 0 的数字，或留空表示不设置。";
            return;
        }
        await persist({ ...cloneNutritionStore(store), goals: { caloriesKcal, proteinGrams } }, "每日目标已保存");
    }

    function parseFoodDraft(draft: FoodDraft): { name: string; baseAmount: number; unit: string; values: NutritionValues } | null {
        const name = draft.name.trim();
        const baseAmount = parsePositiveNumber(draft.baseAmount);
        const unit = draft.unit.trim();
        const values = {
            caloriesKcal: parseRequiredNumber(draft.caloriesKcal),
            proteinGrams: parseRequiredNumber(draft.proteinGrams),
            carbsGrams: parseRequiredNumber(draft.carbsGrams),
            fatGrams: parseRequiredNumber(draft.fatGrams),
        };
        if (!name) {
            error = "请填写食物名称。";
            return null;
        }
        if (baseAmount === null || !unit) {
            error = "请填写大于 0 的基准量和单位，例如 113 ml。";
            return null;
        }
        if (Object.values(values).some((value) => value === null)) {
            error = "热量、蛋白质、碳水和脂肪必须是大于或等于 0 的数字。";
            return null;
        }
        if (Object.values(values).every((value) => value === 0)) {
            error = "请至少填写一项营养数据。";
            return null;
        }
        return { name, baseAmount, unit, values: values as NutritionValues };
    }

    function emptyFoodDraft(): FoodDraft {
        return { name: "", baseAmount: "1", unit: "份", caloriesKcal: "", proteinGrams: "", carbsGrams: "", fatGrams: "" };
    }

    function foodDraft(name: string, baseAmount: number, unit: string, values: NutritionValues): FoodDraft {
        return {
            name,
            baseAmount: String(baseAmount),
            unit,
            caloriesKcal: String(values.caloriesKcal),
            proteinGrams: String(values.proteinGrams),
            carbsGrams: String(values.carbsGrams),
            fatGrams: String(values.fatGrams),
        };
    }

    function parseRequiredNumber(value: string): number | null {
        if (String(value).trim() === "") return 0;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }

    function parseOptionalNumber(value: string): number | null | undefined {
        if (String(value).trim() === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }

    function parsePositiveNumber(value: string | number): number | null {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    function amountStep(unit: string): number {
        const normalized = unit.trim().toLowerCase();
        if (["g", "克", "ml", "毫升"].includes(normalized)) return 10;
        if (["kg", "千克", "公斤", "l", "升"].includes(normalized)) return .1;
        return .5;
    }

    function formatAmount(amount: number, unit: string): string {
        return `${formatNumber(amount)} ${unit}`;
    }

    function progress(value: number, goal: number | null): number {
        return goal && goal > 0 ? Math.min(100, value / goal * 100) : 0;
    }

    function formatNumber(value: number): string {
        const rounded = Math.round(value * 10) / 10;
        return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    }

    function formatDate(value: string): string {
        const parsed = new Date(`${value}T12:00:00`);
        return `${parsed.getFullYear()} 年 ${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日`;
    }

    function createId(prefix: string): string {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).slice(2, 9).padEnd(7, "0");
        return `${prefix}-${timestamp}-${random}`;
    }
</script>

{#if loading}
    <div class="xz-state"><span class="xz-spinner"></span><p>正在读取营养记录……</p></div>
{:else if error && !store}
    <div class="xz-state xz-error"><h2>暂时无法读取营养记录</h2><p>{error}</p><button class="b3-button" type="button" on:click={() => void refresh()}>重试</button></div>
{:else if store}
    <section class="xz-nutrition-page" aria-busy={saving}>
        <header class="xz-nutrition-heading">
            <div><h2>{formatDate(date)} · 营养摄入</h2><p>不区分餐次，吃了就记；以趋势和大致总量为主。</p></div>
            <button class="xz-nutrition-manage" type="button" aria-expanded={managerOpen} on:click={() => managerOpen = !managerOpen}>{managerOpen ? "收起管理" : "管理模板与目标"}</button>
        </header>

        <div class="xz-nutrition-primary-summary">
            <section>
                <div><span>总热量</span><strong>{formatNumber(totals.caloriesKcal)} <small>kcal</small></strong></div>
                {#if store.goals.caloriesKcal}<p>目标 {formatNumber(store.goals.caloriesKcal)} kcal · {totals.caloriesKcal <= store.goals.caloriesKcal ? `还可摄入 ${formatNumber(store.goals.caloriesKcal - totals.caloriesKcal)} kcal` : `超出 ${formatNumber(totals.caloriesKcal - store.goals.caloriesKcal)} kcal`}</p><div class="xz-nutrition-progress"><i style={`width:${calorieProgress}%`}></i></div>{:else}<p>未设置每日目标</p>{/if}
            </section>
            <section class="protein">
                <div><span>蛋白质</span><strong>{formatNumber(totals.proteinGrams)} <small>g</small></strong></div>
                {#if store.goals.proteinGrams}<p>目标 {formatNumber(store.goals.proteinGrams)} g · {totals.proteinGrams >= store.goals.proteinGrams ? "已达到" : `还差 ${formatNumber(store.goals.proteinGrams - totals.proteinGrams)} g`}</p><div class="xz-nutrition-progress"><i style={`width:${proteinProgress}%`}></i></div>{:else}<p>未设置每日目标</p>{/if}
            </section>
        </div>

        <div class="xz-nutrition-macro-summary">
            <div><span>碳水</span><strong>{formatNumber(totals.carbsGrams)} g</strong><small>约 {formatNumber(shares.carbs)}% 热量</small></div>
            <div><span>脂肪</span><strong>{formatNumber(totals.fatGrams)} g</strong><small>约 {formatNumber(shares.fat)}% 热量</small></div>
            <div class="xz-nutrition-macro-bar" aria-label={`蛋白质约 ${formatNumber(shares.protein)}%，碳水约 ${formatNumber(shares.carbs)}%，脂肪约 ${formatNumber(shares.fat)}%`}>
                <i class="protein" style={`width:${shares.protein}%`}></i><i class="carbs" style={`width:${shares.carbs}%`}></i><i class="fat" style={`width:${shares.fat}%`}></i><i class="other" style={`width:${shares.unaccounted}%`}></i>
            </div>
            <p><span><i class="protein"></i>蛋白质 {formatNumber(shares.protein)}%</span><span><i class="carbs"></i>碳水 {formatNumber(shares.carbs)}%</span><span><i class="fat"></i>脂肪 {formatNumber(shares.fat)}%</span><small>按 4／4／9 kcal 每克近似换算</small></p>
        </div>

        {#if managerOpen}
            <section class="xz-nutrition-manager">
                <div class="xz-nutrition-goals">
                    <h3>每日目标</h3>
                    <label><span>热量目标（kcal）</span><input class="b3-text-field" type="number" min="1" bind:value={calorieGoalDraft} placeholder="不设置" /></label>
                    <label><span>蛋白质目标（g）</span><input class="b3-text-field" type="number" min="1" step="0.1" bind:value={proteinGoalDraft} placeholder="不设置" /></label>
                    <button type="button" disabled={saving} on:click={() => void saveGoals()}>保存目标</button>
                </div>
                <div class="xz-nutrition-template-editor">
                    <h3>{editingTemplateId ? "编辑常用模板" : "新建常用模板"}</h3>
                    <div class="xz-nutrition-food-fields">
                        <label class="name"><span>食物名称</span><input class="b3-text-field" bind:value={templateDraft.name} placeholder="例如：训练后奶昔" /></label>
                        <label><span>基准量</span><input class="b3-text-field" type="number" min="0.01" step="any" bind:value={templateDraft.baseAmount} placeholder="113" /></label>
                        <label><span>单位</span><input class="b3-text-field" bind:value={templateDraft.unit} placeholder="ml／g／份" /></label>
                        <label><span>热量 kcal</span><input class="b3-text-field" type="number" min="0" bind:value={templateDraft.caloriesKcal} /></label>
                        <label><span>蛋白质 g</span><input class="b3-text-field" type="number" min="0" step="0.1" bind:value={templateDraft.proteinGrams} /></label>
                        <label><span>碳水 g</span><input class="b3-text-field" type="number" min="0" step="0.1" bind:value={templateDraft.carbsGrams} /></label>
                        <label><span>脂肪 g</span><input class="b3-text-field" type="number" min="0" step="0.1" bind:value={templateDraft.fatGrams} /></label>
                    </div>
                    <div class="xz-nutrition-editor-actions"><button class="primary" type="button" disabled={saving} on:click={() => void saveTemplate()}>{editingTemplateId ? "保存修改" : "建立模板"}</button>{#if editingTemplateId}<button type="button" on:click={cancelTemplateEdit}>取消编辑</button>{/if}</div>
                </div>
                {#if store.templates.length > 0}<div class="xz-nutrition-template-list">{#each store.templates as template (template.id)}<div><span><strong>{template.name}</strong><small>每 {formatAmount(template.baseAmount, template.unit)} · {formatNumber(template.values.caloriesKcal)} kcal · 蛋白质 {formatNumber(template.values.proteinGrams)}g · 碳水 {formatNumber(template.values.carbsGrams)}g · 脂肪 {formatNumber(template.values.fatGrams)}g</small></span><button type="button" on:click={() => editTemplate(template)}>编辑</button><button class="danger" type="button" on:click={() => void deleteTemplate(template)}>删除</button></div>{/each}</div>{/if}
            </section>
        {/if}

        <div class="xz-nutrition-layout">
            <div>
                <section class="xz-nutrition-section">
                    <header><h3>常用食物</h3><span>一键按基准量记录，也可按实际量记录</span></header>
                    {#if store.templates.length > 0}
                        <div class="xz-nutrition-template-grid">{#each store.templates as template (template.id)}<article><button class="xz-nutrition-template-default" type="button" disabled={saving} on:click={() => void addFromTemplate(template)}><span><strong>{template.name}</strong><small>{formatAmount(template.baseAmount, template.unit)} · {formatNumber(template.values.caloriesKcal)} kcal · 蛋白质 {formatNumber(template.values.proteinGrams)}g</small></span><b>＋</b></button><button class="xz-nutrition-template-amount" type="button" disabled={saving} on:click={() => openAmountDialog(template)}>按量</button></article>{/each}</div>
                    {:else}
                        <div class="xz-nutrition-empty"><p>还没有常用食物模板。</p><button type="button" on:click={() => managerOpen = true}>建立第一个模板</button></div>
                    {/if}
                </section>

                <section class="xz-nutrition-section">
                    <header><h3>{editingEntryId ? "编辑摄入记录" : "临时记录"}</h3><span>{editingEntryId ? "只修改本条记录，不改变模板" : "不会自动保存为模板"}</span></header>
                    <div class="xz-nutrition-food-fields">
                        <label class="name"><span>食物名称</span><input class="b3-text-field" bind:value={manualDraft.name} placeholder="例如：牛肉面" /></label>
                        <label><span>{editingEntryId ? "营养基准量" : "实际量"}</span><input class="b3-text-field" type="number" min="0.01" step="any" bind:value={manualDraft.baseAmount} /></label>
                        <label><span>单位</span><input class="b3-text-field" bind:value={manualDraft.unit} placeholder="份／g／ml" /></label>
                        <label><span>热量 kcal</span><input class="b3-text-field" type="number" min="0" bind:value={manualDraft.caloriesKcal} /></label>
                        <label><span>蛋白质 g</span><input class="b3-text-field" type="number" min="0" step="0.1" bind:value={manualDraft.proteinGrams} /></label>
                        <label><span>碳水 g</span><input class="b3-text-field" type="number" min="0" step="0.1" bind:value={manualDraft.carbsGrams} /></label>
                        <label><span>脂肪 g</span><input class="b3-text-field" type="number" min="0" step="0.1" bind:value={manualDraft.fatGrams} /></label>
                    </div>
                    <div class="xz-nutrition-editor-actions"><button class="primary" type="button" disabled={saving} on:click={() => void saveManualEntry()}>{editingEntryId ? "保存记录" : "加入当日"}</button>{#if editingEntryId}<button type="button" on:click={cancelEntryEdit}>取消编辑</button>{/if}</div>
                </section>
            </div>

            <section class="xz-nutrition-section xz-nutrition-today">
                <header><h3>当日已吃</h3><span>{totals.entries} 条记录</span></header>
                {#if todayEntries.length > 0}
                    <div class="xz-nutrition-entry-list">{#each todayEntries as entry (entry.id)}<article><div><strong>{entry.nameSnapshot}</strong><small>营养基准：每 {formatAmount(entry.baseAmountSnapshot, entry.unitSnapshot)}</small><span>{formatNumber(entry.valuesPerServing.caloriesKcal * nutritionEntryRatio(entry))} kcal · 蛋白质 {formatNumber(entry.valuesPerServing.proteinGrams * nutritionEntryRatio(entry))}g · 碳水 {formatNumber(entry.valuesPerServing.carbsGrams * nutritionEntryRatio(entry))}g · 脂肪 {formatNumber(entry.valuesPerServing.fatGrams * nutritionEntryRatio(entry))}g</span></div><div class="xz-nutrition-entry-actions"><button type="button" aria-label={`减少“${entry.nameSnapshot}”的摄入量`} disabled={saving || entry.consumedAmount <= amountStep(entry.unitSnapshot)} on:click={() => void changeAmount(entry, Math.max(.01, entry.consumedAmount - amountStep(entry.unitSnapshot)))}>−</button><label><input aria-label={`“${entry.nameSnapshot}”的实际摄入量`} type="number" min="0.01" step="any" value={entry.consumedAmount} disabled={saving} on:change={(event) => void changeAmountFromInput(entry, event.currentTarget.value)} /><span>{entry.unitSnapshot}</span></label><button type="button" aria-label={`增加“${entry.nameSnapshot}”的摄入量`} disabled={saving} on:click={() => void changeAmount(entry, entry.consumedAmount + amountStep(entry.unitSnapshot))}>＋</button><button type="button" disabled={saving} on:click={() => editEntry(entry)}>编辑营养</button><button class="danger" type="button" disabled={saving} on:click={() => void deleteEntry(entry)}>删除</button></div></article>{/each}</div>
                {:else}
                    <div class="xz-nutrition-empty"><p>这一天还没有营养记录。</p><span>点击左侧模板，或者录入临时食物。</span></div>
                {/if}
            </section>
        </div>

        <div class="xz-nutrition-feedback" aria-live="polite">{#if saving}<span>正在保存并复核……</span>{:else if error}<strong>{error}</strong>{:else if message}<span>{message}</span>{/if}</div>

        {#if amountTemplate}
            <div class="xz-nutrition-amount-backdrop" role="presentation" on:click|self={closeAmountDialog}>
                <section class="xz-nutrition-amount-dialog" role="dialog" aria-modal="true" aria-labelledby="xz-nutrition-amount-title">
                    <header><div><h3 id="xz-nutrition-amount-title">按实际量记录 · {amountTemplate.name}</h3><p>模板基准为 {formatAmount(amountTemplate.baseAmount, amountTemplate.unit)}，营养数据将按比例自动计算。</p></div><button type="button" aria-label="关闭" on:click={closeAmountDialog}>×</button></header>
                    <label><span>实际摄入量</span><div><input class="b3-text-field" type="number" min="0.01" step="any" bind:value={amountDraft} /><b>{amountTemplate.unit}</b></div></label>
                    <p class="xz-nutrition-amount-preview">预计：{formatNumber(amountTemplate.values.caloriesKcal * (parsePositiveNumber(amountDraft) ?? 0) / amountTemplate.baseAmount)} kcal · 蛋白质 {formatNumber(amountTemplate.values.proteinGrams * (parsePositiveNumber(amountDraft) ?? 0) / amountTemplate.baseAmount)}g · 碳水 {formatNumber(amountTemplate.values.carbsGrams * (parsePositiveNumber(amountDraft) ?? 0) / amountTemplate.baseAmount)}g · 脂肪 {formatNumber(amountTemplate.values.fatGrams * (parsePositiveNumber(amountDraft) ?? 0) / amountTemplate.baseAmount)}g</p>
                    <footer><button type="button" on:click={closeAmountDialog}>取消</button><button class="primary" type="button" disabled={saving} on:click={() => void addCustomAmount()}>记录这次摄入</button></footer>
                </section>
            </div>
        {/if}
    </section>
{/if}
