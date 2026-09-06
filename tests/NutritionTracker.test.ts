import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import NutritionTracker from "../src/NutritionTracker.svelte";
import { cloneNutritionStore, createEmptyNutritionStore, type NutritionStore } from "../src/nutrition";

describe("营养摄入界面", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("点击常用模板即可保存当天的一份快照", async () => {
        const initial = createStore();
        const save = vi.fn(async (next: NutritionStore) => cloneNutritionStore(next));
        component = new NutritionTracker({
            target: document.body,
            props: { date: "2026-09-06", load: vi.fn().mockResolvedValue(initial), save },
        });
        await tick();
        await vi.waitFor(() => expect(document.body.textContent).toContain("训练后奶昔"));

        const templateButton = [...document.querySelectorAll(".xz-nutrition-template-grid button")]
            .find((button) => button.textContent?.includes("训练后奶昔")) as HTMLButtonElement;
        templateButton.click();
        await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());

        const saved = save.mock.calls[0][0];
        expect(saved.entries[0]).toMatchObject({
            date: "2026-09-06",
            templateId: "template-1",
            nameSnapshot: "训练后奶昔",
            baseAmountSnapshot: 300,
            unitSnapshot: "ml",
            consumedAmount: 300,
            valuesPerServing: { caloriesKcal: 320, proteinGrams: 35, carbsGrams: 28, fatGrams: 8 },
        });
        await tick();
        expect(document.body.textContent).toContain("320 kcal");
        expect(document.body.textContent).toContain("蛋白质 35g");
    });

    it("窄屏所需内容有独立结构类，且使用当日而非固定今天文案", async () => {
        component = new NutritionTracker({
            target: document.body,
            props: { date: "2026-09-05", load: vi.fn().mockResolvedValue(createStore()), save: vi.fn() },
        });
        await tick();
        await vi.waitFor(() => expect(document.querySelector(".xz-nutrition-page")).not.toBeNull());
        expect(document.querySelector(".xz-nutrition-primary-summary")).not.toBeNull();
        expect(document.querySelector(".xz-nutrition-template-grid")).not.toBeNull();
        expect(document.querySelector(".xz-nutrition-today")?.textContent).toContain("当日已吃");
        expect(document.body.textContent).toContain("2026 年 9 月 5 日");

        clickButton("管理模板与目标");
        await tick();
        const managerCards = [...document.querySelectorAll(".xz-nutrition-manager-card")];
        expect(managerCards).toHaveLength(2);
        expect(managerCards[0].textContent).toContain("每日目标");
        expect(managerCards[1].textContent).toContain("新建常用模板");
    });

    it("按实际量记录时自动按模板基准比例换算", async () => {
        const initial = createStore();
        initial.templates[0].baseAmount = 113;
        initial.templates[0].values = { caloriesKcal: 70, proteinGrams: 3.5, carbsGrams: 5, fatGrams: 3 };
        const save = vi.fn(async (next: NutritionStore) => cloneNutritionStore(next));
        component = new NutritionTracker({
            target: document.body,
            props: { date: "2026-09-06", load: vi.fn().mockResolvedValue(initial), save },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-nutrition-template-amount")).not.toBeNull());

        (document.querySelector(".xz-nutrition-template-amount") as HTMLButtonElement).click();
        await tick();
        const input = document.querySelector('.xz-nutrition-amount-dialog input[type="number"]') as HTMLInputElement;
        input.value = "98";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();
        expect(document.querySelector(".xz-nutrition-amount-preview")?.textContent).toContain("60.7 kcal");

        clickButton("记录这次摄入");
        await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
        expect(save.mock.calls[0][0].entries[0]).toMatchObject({
            baseAmountSnapshot: 113,
            unitSnapshot: "ml",
            consumedAmount: 98,
        });
        await tick();
        expect(document.querySelector(".xz-nutrition-entry-list")?.textContent).toContain("60.7 kcal");
    });
});

function createStore(): NutritionStore {
    const store = createEmptyNutritionStore(1000);
    store.goals = { caloriesKcal: 2200, proteinGrams: 150 };
    store.templates = [{
        id: "template-1",
        name: "训练后奶昔",
        baseAmount: 300,
        unit: "ml",
        values: { caloriesKcal: 320, proteinGrams: 35, carbsGrams: 28, fatGrams: 8 },
        createdAt: 1000,
        updatedAt: 1000,
    }];
    return store;
}

function clickButton(label: string): void {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label) as HTMLButtonElement | undefined;
    if (!button) throw new Error(`没有找到按钮：${label}`);
    button.click();
}
