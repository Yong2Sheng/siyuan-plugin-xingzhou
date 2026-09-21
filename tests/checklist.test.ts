import { describe, expect, it } from "vitest";
import { boundaryKeyFor, checklistStoresMatch, createDefaultChecklistStore, entryReminderIds, parseChecklistStore, reminderIdFor, setChecklistBoundary, updateChecklistDayState, updateChecklistStore } from "../src/checklist";

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

    it("按日期保存四态结果和训练安排，并兼容旧版勾选数据", () => {
        const initial = createDefaultChecklistStore(1000);
        const saved = updateChecklistDayState(initial, "2026-09-06", new Map([
            ["sun-wake::sun-wake:0", "completed" as const],
            ["sun-wake::sun-wake:1", "partial" as const],
            ["sun-training::sun-training:rest:0", "missed" as const],
        ]), "rest", 2000);
        expect(saved.dayStates).toEqual([{
            date: "2026-09-06",
            checkedKeys: ["sun-wake::sun-wake:0"],
            reminderStates: {
                "sun-training::sun-training:rest:0": "missed",
                "sun-wake::sun-wake:0": "completed",
                "sun-wake::sun-wake:1": "partial",
            },
            trainingMode: "rest",
            updatedAt: 2000,
        }]);
        const migrated = parseChecklistStore({
            ...initial,
            dayStates: [{ date: "2026-09-05", checkedKeys: ["sat-wake::sat-wake:0"], trainingMode: "", updatedAt: 1500 }],
        });
        expect(migrated?.dayStates[0]).toMatchObject({
            checkedKeys: ["sat-wake::sat-wake:0"],
            reminderStates: { "sat-wake::sat-wake:0": "completed" },
        });
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
        // 训练边界时间挂在通用提醒上（训练／休息由当天选择决定），因此共同提醒保留训练结束时刻
        expect(migrated?.reminders.map((reminder) => reminder.text)).toEqual(["07:30 结束训练"]);
        expect(migrated?.trainingChoices?.training.map((reminder) => reminder.text)).toContain("只做器材动作，无器材核心回家完成");
        expect(migrated?.trainingChoices?.rest.map((reminder) => reminder.text)).toContain("今天休息，不补做训练");
    });

    it("默认模板给随餐鱼油、平光镜、到点吃饭和下班收尾配了边界提醒时间", () => {
        const store = createDefaultChecklistStore(1000);
        const workday = store.templates.find((template) => template.id === "workday")!;
        const boundaryOf = (entryId: string, index: number) => workday.entries.find((entry) => entry.id === entryId)?.boundaries?.[boundaryKeyFor(entryId, reminderIdFor(entryId, index))];
        expect(boundaryOf("wd-breakfast", 1)).toBe("08:45");
        expect(boundaryOf("wd-lunch", 1)).toBe("12:10");
        expect(boundaryOf("wd-dinner", 0)).toBe("18:00");
        expect(boundaryOf("wd-off", 0)).toBe("17:00");
        expect(boundaryOf("wd-prepare", 1)).toBe("20:15");
        expect(workday.entries.find((entry) => entry.id === "wd-prepare")?.reminders[1].text).toContain("平光镜");
        // 所有默认边界时间都必须是合法 HH:MM，否则写入后会被规范化丢弃
        for (const template of store.templates) {
            for (const entry of template.entries) {
                for (const [key, at] of Object.entries(entry.boundaries ?? {})) {
                    expect(key.startsWith(`${entry.id}:`)).toBe(true);
                    expect(at).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
                }
            }
        }
    });

    it("每条默认边界提醒都绑定在一条真实存在的提醒上", () => {
        // 边界键是 `<条目id>:<提醒id>`：指错了面板会显示成别的提醒（甚至空白），
        // 所以默认数据必须逐条能命中原提醒对象
        const store = createDefaultChecklistStore(1000);
        let checked = 0;
        for (const template of store.templates) {
            for (const entry of template.entries) {
                const ids = entryReminderIds(entry);
                for (const [key, at] of Object.entries(entry.boundaries ?? {})) {
                    const sep = key.indexOf("::");
                    expect(sep, `${key} 不是合法的边界键`).toBeGreaterThan(0);
                    expect(key.slice(0, sep), `${key} 的条目 id 不对`).toBe(entry.id);
                    expect(ids.has(key.slice(sep + 2)), `${entry.id} 的边界提醒 ${at} 没有对应提醒`).toBe(true);
                    expect(at).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
                    checked += 1;
                }
            }
        }
        // 覆盖用户实际会漏的那几类：鱼油、平光镜、到点吃饭、训练、下班收尾
        expect(checked).toBeGreaterThanOrEqual(14);
    });

    it("边界提醒时间写入、清除与重新读取后保持一致", () => {
        const store = createDefaultChecklistStore(1000);
        const written = setChecklistBoundary(store, "workday", { entryId: "wd-wake", reminderId: "wd-wake:0", at: "06:05" }, 2000);
        expect(written.revision).toBe(store.revision + 1);
        expect(written.templates.find((template) => template.id === "workday")?.entries.find((entry) => entry.id === "wd-wake")?.boundaries).toEqual({ "wd-wake::wd-wake:0": "06:05" });
        // 通过完整解析复核后仍然一致，说明能被安全写回磁盘
        expect(parseChecklistStore(written)).toEqual(written);
        expect(checklistStoresMatch(written, parseChecklistStore(written)!)).toBe(true);

        const cleared = setChecklistBoundary(written, "workday", { entryId: "wd-wake", reminderId: "wd-wake:0", at: "" }, 3000);
        const wake = cleared.templates.find((template) => template.id === "workday")?.entries.find((entry) => entry.id === "wd-wake");
        // 清除写成空串而不是删键：这样解析时才能区分「用户取消」和「旧数据里还没有默认值」
        expect(wake?.boundaries).toEqual({ "wd-wake::wd-wake:0": "" });
    });

    it("存量数据里没有边界提醒的条目会补上默认时间，取消过的不会复活", () => {
        const store = createDefaultChecklistStore(1000);
        // 模拟已发布版本的 checklist.json：条目齐全但没有 boundaries 字段
        const legacy = {
            version: 1,
            revision: 7,
            updatedAt: 1500,
            viewMode: "xingzhou",
            templates: store.templates.map((template) => ({
                ...template,
                entries: template.entries.map(({ boundaries: _boundaries, ...rest }) => rest),
            })),
            dayStates: [],
        };

        const parsed = parseChecklistStore(legacy);
        const workday = parsed?.templates.find((template) => template.id === "workday");
        const dinner = workday?.entries.find((entry) => entry.id === "wd-dinner");
        expect(dinner?.boundaries).toEqual({ "wd-dinner::wd-dinner:0": "18:00" });
        // 修订号与其余内容保持原样，升级本身不产生写入
        expect(parsed?.revision).toBe(7);
        expect(parsed?.updatedAt).toBe(1500);

        // 用户手动取消过（空串）的那一条不再被默认值复活
        const cancelled = {
            ...legacy,
            templates: legacy.templates.map((template) => template.id !== "workday" ? template : {
                ...template,
                entries: template.entries.map((entry) => entry.id !== "wd-dinner" ? entry : { ...entry, boundaries: { "wd-dinner::wd-dinner:0": "" } }),
            }),
        };
        const cancelledDinner = parseChecklistStore(cancelled)?.templates.find((template) => template.id === "workday")?.entries.find((entry) => entry.id === "wd-dinner");
        expect(cancelledDinner?.boundaries).toEqual({ "wd-dinner::wd-dinner:0": "" });
    });

    it("非法的边界时间被丢弃，旧的位置键按下标迁移到对应提醒，指不到提醒的键也丢弃", () => {
        const store = createDefaultChecklistStore(1000);
        const withBoundaries = (boundaries: Record<string, string>) => ({
            ...store,
            templates: store.templates.map((template) => template.id !== "workday" ? template : {
                ...template,
                entries: template.entries.map((entry) => entry.id !== "wd-wake" ? entry : { ...entry, boundaries }),
            }),
        });
        const wakeBoundaries = (source: unknown) => parseChecklistStore(source)
            ?.templates.find((template) => template.id === "workday")
            ?.entries.find((entry) => entry.id === "wd-wake")?.boundaries;

        // 时间格式非法的丢弃，合法的留下
        expect(wakeBoundaries(withBoundaries({ "wd-wake::wd-wake:0": "6:05", "wd-wake::wd-wake:2": "25:00", "wd-wake::wd-wake:1": "06:05" })))
            .toEqual({ "wd-wake::wd-wake:1": "06:05" });

        // 旧的位置键（本功能上一版）按下标迁移成对应提醒的 id；更早的 `<条目id>:common:<下标>` 同样
        expect(wakeBoundaries(withBoundaries({ "wd-wake:1": "06:05" }))).toEqual({ "wd-wake::wd-wake:1": "06:05" });
        expect(wakeBoundaries(withBoundaries({ "wd-wake:common:1": "06:05" }))).toEqual({ "wd-wake::wd-wake:1": "06:05" });

        // 下标越界、提醒已不存在、完全不成格式的键：一律丢弃，不猜（起床本来就没有默认边界，因此整条为空）
        expect(wakeBoundaries(withBoundaries({ "wd-wake:9": "06:05", "wd-wake::wd-wake:不存在": "06:05", "没有分隔符": "06:05" })))
            .toBeUndefined();
    });
});
