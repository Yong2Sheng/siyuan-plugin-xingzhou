export const NUTRITION_STORE_FILE = "nutrition.json";
export const NUTRITION_STORE_VERSION = 1;

export type NutritionValues = {
    caloriesKcal: number;
    proteinGrams: number;
    carbsGrams: number;
    fatGrams: number;
};

export type NutritionGoals = {
    caloriesKcal: number | null;
    proteinGrams: number | null;
};

export type NutritionTemplate = {
    id: string;
    name: string;
    baseAmount: number;
    unit: string;
    values: NutritionValues;
    createdAt: number;
    updatedAt: number;
};

export type NutritionEntry = {
    id: string;
    date: string;
    templateId: string | null;
    nameSnapshot: string;
    baseAmountSnapshot: number;
    unitSnapshot: string;
    valuesPerServing: NutritionValues;
    consumedAmount: number;
    createdAt: number;
    updatedAt: number;
};

export type NutritionStore = {
    version: 1;
    revision: number;
    createdAt: number;
    updatedAt: number;
    goals: NutritionGoals;
    templates: NutritionTemplate[];
    entries: NutritionEntry[];
};

export type NutritionTotals = NutritionValues & { entries: number };

export function createEmptyNutritionStore(now = Date.now()): NutritionStore {
    return {
        version: NUTRITION_STORE_VERSION,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        goals: { caloriesKcal: null, proteinGrams: null },
        templates: [],
        entries: [],
    };
}

export function cloneNutritionStore(store: NutritionStore): NutritionStore {
    return {
        ...store,
        goals: { ...store.goals },
        templates: store.templates.map((template) => ({ ...template, values: { ...template.values } })),
        entries: store.entries.map((entry) => ({ ...entry, valuesPerServing: { ...entry.valuesPerServing } })),
    };
}

export function parseNutritionStore(value: unknown): NutritionStore | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<NutritionStore>;
    if (source.version !== NUTRITION_STORE_VERSION || !Array.isArray(source.templates) || !Array.isArray(source.entries)) return null;
    const templateIds = new Set<string>();
    const templates: NutritionTemplate[] = [];
    for (const candidate of source.templates) {
        const template = normalizeTemplate(candidate);
        if (!template || templateIds.has(template.id)) return null;
        templateIds.add(template.id);
        templates.push(template);
    }
    const entryIds = new Set<string>();
    const entries: NutritionEntry[] = [];
    for (const candidate of source.entries) {
        const entry = normalizeEntry(candidate);
        if (!entry || entryIds.has(entry.id)) return null;
        entryIds.add(entry.id);
        entries.push(entry);
    }
    const createdAt = finiteNumber(source.createdAt) ?? Date.now();
    const rawGoals = source.goals && typeof source.goals === "object" ? source.goals as Partial<NutritionGoals> : {};
    return {
        version: NUTRITION_STORE_VERSION,
        revision: Math.max(0, Math.trunc(finiteNumber(source.revision) ?? 0)),
        createdAt,
        updatedAt: finiteNumber(source.updatedAt) ?? createdAt,
        goals: {
            caloriesKcal: nullableNonNegative(rawGoals.caloriesKcal),
            proteinGrams: nullableNonNegative(rawGoals.proteinGrams),
        },
        templates: templates.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name, "zh-CN")),
        entries: entries.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt),
    };
}

export function nutritionStoresMatch(expected: NutritionStore, actual: NutritionStore): boolean {
    return JSON.stringify(expected) === JSON.stringify(actual);
}

export function nutritionBackupFileForRevision(revision: number): string {
    return `nutrition.backup-${Math.abs(revision - 1) % 3 + 1}.json`;
}

export function nutritionTotalsForDate(store: NutritionStore, date: string): NutritionTotals {
    return store.entries.filter((entry) => entry.date === date).reduce<NutritionTotals>((totals, entry) => ({
        caloriesKcal: totals.caloriesKcal + entry.valuesPerServing.caloriesKcal * nutritionEntryRatio(entry),
        proteinGrams: totals.proteinGrams + entry.valuesPerServing.proteinGrams * nutritionEntryRatio(entry),
        carbsGrams: totals.carbsGrams + entry.valuesPerServing.carbsGrams * nutritionEntryRatio(entry),
        fatGrams: totals.fatGrams + entry.valuesPerServing.fatGrams * nutritionEntryRatio(entry),
        entries: totals.entries + 1,
    }), { caloriesKcal: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0, entries: 0 });
}

export function nutritionEntryRatio(entry: NutritionEntry): number {
    return entry.consumedAmount / entry.baseAmountSnapshot;
}

export function macroCalorieShares(totals: NutritionTotals): { protein: number; carbs: number; fat: number; unaccounted: number } {
    if (totals.caloriesKcal <= 0) return { protein: 0, carbs: 0, fat: 0, unaccounted: 100 };
    const protein = totals.proteinGrams * 4 / totals.caloriesKcal * 100;
    const carbs = totals.carbsGrams * 4 / totals.caloriesKcal * 100;
    const fat = totals.fatGrams * 9 / totals.caloriesKcal * 100;
    const scale = Math.max(1, (protein + carbs + fat) / 100);
    return {
        protein: protein / scale,
        carbs: carbs / scale,
        fat: fat / scale,
        unaccounted: Math.max(0, 100 - (protein + carbs + fat) / scale),
    };
}

function normalizeTemplate(value: unknown): NutritionTemplate | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<NutritionTemplate>;
    const values = normalizeValues(source.values);
    const createdAt = finiteNumber(source.createdAt) ?? Date.now();
    const legacy = source as Partial<NutritionTemplate> & { servingLabel?: unknown };
    const baseAmount = positive(source.baseAmount) ?? 1;
    const unit = text(source.unit) || text(legacy.servingLabel) || "份";
    if (typeof source.id !== "string" || !source.id || typeof source.name !== "string" || !source.name.trim() || !values) return null;
    return {
        id: source.id,
        name: source.name.trim(),
        baseAmount,
        unit,
        values,
        createdAt,
        updatedAt: finiteNumber(source.updatedAt) ?? createdAt,
    };
}

function normalizeEntry(value: unknown): NutritionEntry | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<NutritionEntry>;
    const values = normalizeValues(source.valuesPerServing);
    const legacy = source as Partial<NutritionEntry> & { servingLabelSnapshot?: unknown; servings?: unknown };
    const baseAmountSnapshot = positive(source.baseAmountSnapshot) ?? 1;
    const legacyServings = positive(legacy.servings);
    const consumedAmount = positive(source.consumedAmount) ?? (legacyServings === null ? null : legacyServings * baseAmountSnapshot);
    const unitSnapshot = text(source.unitSnapshot) || text(legacy.servingLabelSnapshot) || "份";
    const createdAt = finiteNumber(source.createdAt) ?? Date.now();
    if (typeof source.id !== "string" || !source.id || !isDateKey(source.date) || typeof source.nameSnapshot !== "string" || !source.nameSnapshot.trim() || !values || consumedAmount === null) return null;
    return {
        id: source.id,
        date: source.date,
        templateId: typeof source.templateId === "string" && source.templateId ? source.templateId : null,
        nameSnapshot: source.nameSnapshot.trim(),
        baseAmountSnapshot,
        unitSnapshot,
        valuesPerServing: values,
        consumedAmount,
        createdAt,
        updatedAt: finiteNumber(source.updatedAt) ?? createdAt,
    };
}

function normalizeValues(value: unknown): NutritionValues | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<NutritionValues>;
    const caloriesKcal = nonNegative(source.caloriesKcal);
    const proteinGrams = nonNegative(source.proteinGrams);
    const carbsGrams = nonNegative(source.carbsGrams);
    const fatGrams = nonNegative(source.fatGrams);
    if (caloriesKcal === null || proteinGrams === null || carbsGrams === null || fatGrams === null) return null;
    return { caloriesKcal, proteinGrams, carbsGrams, fatGrams };
}

function nonNegative(value: unknown): number | null {
    const number = finiteNumber(value);
    return number !== null && number >= 0 ? number : null;
}

function positive(value: unknown): number | null {
    const number = finiteNumber(value);
    return number !== null && number > 0 ? number : null;
}

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function nullableNonNegative(value: unknown): number | null {
    return value === null || value === undefined || value === "" ? null : nonNegative(value);
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isDateKey(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
