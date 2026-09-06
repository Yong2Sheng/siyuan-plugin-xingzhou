import { describe, expect, it } from "vitest";
import {
    createEmptyNutritionStore,
    macroCalorieShares,
    nutritionBackupFileForRevision,
    nutritionTotalsForDate,
    parseNutritionStore,
    type NutritionEntry,
} from "../src/nutrition";

function entry(overrides: Partial<NutritionEntry> = {}): NutritionEntry {
    return {
        id: "entry-1",
        date: "2026-09-06",
        templateId: "template-1",
        nameSnapshot: "希腊酸奶",
        baseAmountSnapshot: 100,
        unitSnapshot: "g",
        valuesPerServing: { caloriesKcal: 150, proteinGrams: 20, carbsGrams: 10, fatGrams: 3 },
        consumedAmount: 100,
        createdAt: 1000,
        updatedAt: 1000,
        ...overrides,
    };
}

describe("营养数据", () => {
    it("按日期和份数汇总四项营养数据", () => {
        const store = createEmptyNutritionStore(1000);
        store.entries = [entry({ consumedAmount: 150 }), entry({ id: "entry-2", date: "2026-09-07" })];

        expect(nutritionTotalsForDate(store, "2026-09-06")).toEqual({
            caloriesKcal: 225,
            proteinGrams: 30,
            carbsGrams: 15,
            fatGrams: 4.5,
            entries: 1,
        });
    });

    it("按 4/4/9 规则计算宏量营养热量占比", () => {
        const shares = macroCalorieShares({ caloriesKcal: 200, proteinGrams: 20, carbsGrams: 20, fatGrams: 4, entries: 1 });
        expect(shares.protein).toBeCloseTo(40);
        expect(shares.carbs).toBeCloseTo(40);
        expect(shares.fat).toBeCloseTo(18);
        expect(shares.unaccounted).toBeCloseTo(2);
    });

    it("拒绝重复记录 ID 和无效份数", () => {
        const store = createEmptyNutritionStore(1000);
        store.entries = [entry(), entry()];
        expect(parseNutritionStore(store)).toBeNull();
        store.entries = [entry({ consumedAmount: 0 })];
        expect(parseNutritionStore(store)).toBeNull();
    });

    it("把旧版份数记录兼容为实际摄入量", () => {
        const legacy = createEmptyNutritionStore(1000) as unknown as Record<string, unknown>;
        legacy.templates = [{ id: "old-template", name: "旧牛奶", servingLabel: "一杯", values: { caloriesKcal: 70, proteinGrams: 3, carbsGrams: 5, fatGrams: 3 }, createdAt: 1, updatedAt: 1 }];
        legacy.entries = [{ id: "old-entry", date: "2026-09-06", templateId: "old-template", nameSnapshot: "旧牛奶", servingLabelSnapshot: "一杯", valuesPerServing: { caloriesKcal: 70, proteinGrams: 3, carbsGrams: 5, fatGrams: 3 }, servings: 1.5, createdAt: 1, updatedAt: 1 }];

        const parsed = parseNutritionStore(legacy);
        expect(parsed?.templates[0]).toMatchObject({ baseAmount: 1, unit: "一杯" });
        expect(parsed?.entries[0]).toMatchObject({ baseAmountSnapshot: 1, unitSnapshot: "一杯", consumedAmount: 1.5 });
    });

    it("使用三槽位轮换备份", () => {
        expect([1, 2, 3, 4].map(nutritionBackupFileForRevision)).toEqual([
            "nutrition.backup-1.json",
            "nutrition.backup-2.json",
            "nutrition.backup-3.json",
            "nutrition.backup-1.json",
        ]);
    });
});
