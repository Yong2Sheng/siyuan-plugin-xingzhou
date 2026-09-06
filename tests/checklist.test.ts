import { describe, expect, it } from "vitest";
import { checklistStoresMatch, createDefaultChecklistStore, parseChecklistStore, updateChecklistStore } from "../src/checklist";

describe("Checklist 配置", () => {
    it("提供工作日、周六和周日三套默认提醒，且不包含需要填写的横线字段", () => {
        const store = createDefaultChecklistStore(1000);
        expect(store.templates.map((template) => template.id)).toEqual(["workday", "saturday", "sunday"]);
        expect(store.templates.find((template) => template.id === "workday")?.entries.some((entry) => entry.title.includes("专业学习"))).toBe(true);
        expect(JSON.stringify(store.templates)).not.toContain("\\rule");
    });

    it("保存显示方式和模板修改时递增修订号", () => {
        const store = createDefaultChecklistStore(1000);
        const next = updateChecklistStore(store, { viewMode: "paper" }, 2000);
        expect(next.viewMode).toBe("paper");
        expect(next.revision).toBe(store.revision + 1);
        expect(next.updatedAt).toBe(2000);
        expect(parseChecklistStore(next)).toEqual(next);
    });

    it("默认配置写入并重新读取后能够通过完整性复核", () => {
        const initial = createDefaultChecklistStore(1000);
        const restored = parseChecklistStore(JSON.parse(JSON.stringify(initial)));
        expect(restored).not.toBeNull();
        expect(checklistStoresMatch(initial, restored!)).toBe(true);
    });

    it("损坏的单个模板会恢复对应默认值，而不是破坏其他模板", () => {
        const source = createDefaultChecklistStore(1000);
        const parsed = parseChecklistStore({
            ...source,
            templates: source.templates.map((template) => template.id === "workday" ? { ...template, entries: [] } : template),
        });
        expect(parsed?.templates.find((template) => template.id === "workday")?.entries.length).toBeGreaterThan(10);
    });
});
