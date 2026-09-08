import { describe, expect, it } from "vitest";
import { checklistStoresMatch, createDefaultChecklistStore, parseChecklistStore, updateChecklistDayState, updateChecklistStore } from "../src/checklist";

describe("Checklist 配置", () => {
    it("提供工作日、开会日、周六和周日四套默认提醒，且不包含需要填写的横线字段", () => {
        const store = createDefaultChecklistStore(1000);
        expect(store.templates.map((template) => template.id)).toEqual(["workday", "conference", "saturday", "sunday"]);
        expect(store.templates.find((template) => template.id === "workday")?.entries.some((entry) => entry.title.includes("专业学习"))).toBe(true);
        expect(store.templates.find((template) => template.id === "conference")?.entries.map((entry) => entry.title)).toEqual(expect.arrayContaining(["会议与交流优先", "确认晚间安排"]));
        expect(JSON.stringify(store.templates.find((template) => template.id === "conference"))).toContain("不记录或补录营养摄入");
        expect(JSON.stringify(store.templates)).not.toContain("\\rule");
    });

    it("旧配置没有开会日模板时自动补入默认模板", () => {
        const source = createDefaultChecklistStore(1000);
        const parsed = parseChecklistStore({ ...source, templates: source.templates.filter((template) => template.id !== "conference") });
        expect(parsed?.templates.find((template) => template.id === "conference")?.entries.length).toBeGreaterThan(5);
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

    it("按日期保存勾选和训练安排，并兼容没有每日状态的旧配置", () => {
        const initial = createDefaultChecklistStore(1000);
        const saved = updateChecklistDayState(initial, "2026-09-06", ["sun-wake:common:0", "sun-wake:common:0"], "rest", 2000);
        expect(saved.dayStates).toEqual([{
            date: "2026-09-06",
            checkedKeys: ["sun-wake:common:0"],
            trainingMode: "rest",
            updatedAt: 2000,
        }]);
        const { dayStates: _discarded, ...legacy } = saved;
        expect(parseChecklistStore(legacy)?.dayStates).toEqual([]);
        expect(checklistStoresMatch(saved, JSON.parse(JSON.stringify(saved)))).toBe(true);
    });

    it("损坏的单个模板会恢复对应默认值，而不是破坏其他模板", () => {
        const source = createDefaultChecklistStore(1000);
        const parsed = parseChecklistStore({
            ...source,
            templates: source.templates.map((template) => template.id === "workday" ? { ...template, entries: [] } : template),
        });
        expect(parsed?.templates.find((template) => template.id === "workday")?.entries.length).toBeGreaterThan(10);
    });

    it("旧版周末训练提醒会迁移成训练日和休息日两个可编辑分支", () => {
        const source = createDefaultChecklistStore(1000);
        const saturday = source.templates.find((template) => template.id === "saturday")!;
        const legacy = {
            ...source,
            templates: source.templates.map((template) => template.id !== "saturday" ? template : {
                ...template,
                entries: template.entries.map((entry) => entry.id !== "sat-training" ? entry : {
                    id: entry.id,
                    time: entry.time,
                    title: entry.title,
                    reminders: ["训练日做训练；休息日不补做"],
                    tone: entry.tone,
                }),
            }),
        };

        const parsed = parseChecklistStore(legacy);
        const migrated = parsed?.templates.find((template) => template.id === saturday.id)?.entries.find((entry) => entry.id === "sat-training");
        expect(migrated?.reminders).toEqual([]);
        expect(migrated?.trainingChoices?.training).toContain("只做器材动作，无器材核心回家完成");
        expect(migrated?.trainingChoices?.rest).toContain("今天休息，不补做训练");
    });
});
