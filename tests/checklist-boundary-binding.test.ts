import { describe, expect, it } from "vitest";
import {
    boundaryKeyFor,
    cloneChecklistStore,
    createDefaultChecklistStore,
    parseChecklistStore,
    pruneEntryBoundaries,
    reconcileReminders,
    reminderIdFor,
    type ChecklistEntry,
    type ChecklistStore,
} from "../src/checklist";
import { boundaryAttention } from "../src/checklist-boundary";

/*
 * 「编辑清单不能让时间错位」的回归测试。
 *
 * 用户的原始数据（已发布版本写下的 checklist.json）里，提醒只是字符串数组、没有 boundaries 字段，
 * 因此这里刻意从那种形态出发，走一遍真实的读取 → 编辑 → 保存 → 再读取，
 * 断言每条边界时间始终跟着原来那件事的文本。
 */

const DATE = "2026-09-21";
const DAY_TYPE = "research-workday";

/** 模拟用户磁盘上的文件：提醒是字符串数组、没有 boundaries。 */
function legacyStore(): Record<string, unknown> {
    const store = createDefaultChecklistStore(1000);
    return {
        ...store,
        templates: store.templates.map((template) => ({
            ...template,
            entries: template.entries.map(({ boundaries: _boundaries, ...rest }) => ({
                ...rest,
                // 用户当年存下的就是纯字符串
                reminders: rest.reminders.map((reminder) => reminder.text),
                ...(rest.trainingChoices
                    ? { trainingChoices: { training: rest.trainingChoices.training.map((r) => r.text), rest: rest.trainingChoices.rest.map((r) => r.text) } }
                    : {}),
            })),
        })),
    };
}

function entry(store: ChecklistStore, entryId: string): ChecklistEntry {
    const found = store.templates.flatMap((template) => template.entries).find((candidate) => candidate.id === entryId);
    if (!found) throw new Error(`没有找到条目 ${entryId}`);
    return found;
}

/** 时间 → 它绑定到的那条提醒文本。测试里最关心的就是这张对应表。 */
function timeToText(store: ChecklistStore, entryId: string): Record<string, string> {
    const target = entry(store, entryId);
    const pairs: Record<string, string> = {};
    for (const [key, at] of Object.entries(target.boundaries ?? {})) {
        const reminderId = key.slice(key.indexOf("::") + 2);
        const text = [...target.reminders, ...(target.trainingChoices?.training ?? []), ...(target.trainingChoices?.rest ?? [])]
            .find((reminder) => reminder.id === reminderId)?.text;
        if (at) pairs[at] = text ?? "(提醒已不存在)";
    }
    return pairs;
}

/** 模拟「编辑条目 → 保存」这一步，与 DailyChecklist 的保存路径一致。 */
function saveEdited(store: ChecklistStore, entryId: string, texts: string[]): ChecklistStore {
    const next = cloneChecklistStore(store);
    const target = next.templates.flatMap((template) => template.entries).find((candidate) => candidate.id === entryId);
    if (!target) throw new Error(`没有找到条目 ${entryId}`);
    target.reminders = reconcileReminders(target.id, texts, target.reminders);
    const pruned = pruneEntryBoundaries(target);
    Object.assign(target, pruned);
    return parseChecklistStore(next)!;
}

function reminderTexts(store: ChecklistStore, entryId: string): string[] {
    return entry(store, entryId).reminders.map((reminder) => reminder.text);
}

const PREPARE_DEFAULT = [
    "整理书包；训练用品、蛋白粉和肌酸提前装好，确保拎起就走",
    "平光镜放进书包",
    "净水器加满水；给蒸锅换水；早餐入蒸锅：2 个鸡蛋、1/4 红薯、半根玉米、100g 冻虾",
    "洗净所有脏杯子和碗",
];

describe("编辑清单后边界时间不错位", () => {
    it("从旧数据读入时，时间就绑在「平光镜放进书包」这条提醒上", () => {
        const parsed = parseChecklistStore(legacyStore())!;
        expect(timeToText(parsed, "wd-prepare")).toEqual({ "20:15": "平光镜放进书包" });
        expect(timeToText(parsed, "wd-dinner")).toEqual({ "18:00": "随餐鱼油 1 粒" });
        expect(reminderTexts(parsed, "wd-prepare")).toEqual(PREPARE_DEFAULT);
    });

    it("在边界提醒**前面**插入一行，时间仍跟着平光镜", () => {
        const before = parseChecklistStore(legacyStore())!;
        const after = saveEdited(before, "wd-prepare", ["把水杯洗干净", ...PREPARE_DEFAULT]);
        expect(reminderTexts(after, "wd-prepare")).toEqual(["把水杯洗干净", ...PREPARE_DEFAULT]);
        expect(timeToText(after, "wd-prepare")).toEqual({ "20:15": "平光镜放进书包" });
    });

    it("在边界提醒**后面**插入一行，时间仍跟着平光镜", () => {
        const before = parseChecklistStore(legacyStore())!;
        const after = saveEdited(before, "wd-prepare", [...PREPARE_DEFAULT, "顺手倒垃圾"]);
        expect(timeToText(after, "wd-prepare")).toEqual({ "20:15": "平光镜放进书包" });
    });

    it("删掉边界提醒之前的一行，时间仍跟着平光镜", () => {
        const before = parseChecklistStore(legacyStore())!;
        const after = saveEdited(before, "wd-prepare", PREPARE_DEFAULT.filter((text) => !text.startsWith("净水器")));
        expect(reminderTexts(after, "wd-prepare")).not.toContain("净水器加满水；给蒸锅换水；早餐入蒸锅：2 个鸡蛋、1/4 红薯、半根玉米、100g 冻虾");
        expect(timeToText(after, "wd-prepare")).toEqual({ "20:15": "平光镜放进书包" });
    });

    it("把边界提醒挪到别的顺序位置，时间仍跟着它", () => {
        const before = parseChecklistStore(legacyStore())!;
        const moved = [PREPARE_DEFAULT[0], PREPARE_DEFAULT[2], PREPARE_DEFAULT[3], PREPARE_DEFAULT[1]];
        const after = saveEdited(before, "wd-prepare", moved);
        expect(reminderTexts(after, "wd-prepare")).toEqual(moved);
        expect(timeToText(after, "wd-prepare")).toEqual({ "20:15": "平光镜放进书包" });
    });

    it("整条目顺序调换也不影响（时间不在条目下标上）", () => {
        const before = parseChecklistStore(legacyStore())!;
        const next = cloneChecklistStore(before);
        const workday = next.templates.find((template) => template.id === "workday")!;
        const index = workday.entries.findIndex((candidate) => candidate.id === "wd-prepare");
        const swapped = [...workday.entries];
        [swapped[0], swapped[index]] = [swapped[index], swapped[0]];
        workday.entries = swapped;
        const after = parseChecklistStore(next)!;
        expect(timeToText(after, "wd-prepare")).toEqual({ "20:15": "平光镜放进书包" });
        expect(timeToText(after, "wd-dinner")).toEqual({ "18:00": "随餐鱼油 1 粒" });
    });

    it("改写边界提醒的文字，时间仍跟着这条提醒（显示新文字）", () => {
        const before = parseChecklistStore(legacyStore())!;
        const edited = PREPARE_DEFAULT.map((text, index) => (index === 1 ? "平光镜与充电器放进书包" : text));
        const after = saveEdited(before, "wd-prepare", edited);
        expect(timeToText(after, "wd-prepare")).toEqual({ "20:15": "平光镜与充电器放进书包" });
        // 面板上也显示新文字
        const template = after.templates.find((candidate) => candidate.id === "workday")!;
        const attention = boundaryAttention(template, new Map(), {
            date: DATE,
            dayType: DAY_TYPE,
            now: new Date("2026-09-21T20:16:00").getTime(),
        });
        const item = [...attention.items, ...attention.later].find((candidate) => candidate.entryId === "wd-prepare");
        expect(item?.at).toBe("20:15");
        expect(item?.reminder).toBe("平光镜与充电器放进书包");
    });

    it("删掉边界提醒本身（在 Checklist 里删掉那一行），时间随之消失且不会被默认值复活", () => {
        const before = parseChecklistStore(legacyStore())!;
        // 先把时间落到磁盘形态（带 boundaries 字段），模拟用户此前已经用过这个功能
        const persisted = JSON.parse(JSON.stringify(before)) as ChecklistStore;
        const after = saveEdited(persisted, "wd-prepare", PREPARE_DEFAULT.filter((text) => text !== "平光镜放进书包"));
        expect(reminderTexts(after, "wd-prepare")).toEqual(PREPARE_DEFAULT.filter((text) => text !== "平光镜放进书包"));
        expect(entry(after, "wd-prepare").boundaries).toBeUndefined();
        expect(timeToText(after, "wd-prepare")).toEqual({});
    });

    it("同一条目里两条提醒都设了时间时，各自跟着自己", () => {
        let store = parseChecklistStore(legacyStore())!;
        const target = entry(store, "wd-dinner");
        const next = cloneChecklistStore(store);
        const dinner = next.templates.flatMap((template) => template.entries).find((candidate) => candidate.id === "wd-dinner")!;
        dinner.boundaries = {
            ...dinner.boundaries,
            [boundaryKeyFor("wd-dinner", reminderIdFor("wd-dinner", 1))]: "18:30",
        };
        store = parseChecklistStore(next)!;
        expect(timeToText(store, "wd-dinner")).toEqual({ "18:00": "随餐鱼油 1 粒", "18:30": "到家先用约 30 分钟放松、换衣服并与对象交流" });

        // 把第一条挪到后面，两条时间各自跟着自己的文字
        const reordered = saveEdited(store, "wd-dinner", [
            "到家先用约 30 分钟放松、换衣服并与对象交流",
            "随餐鱼油 1 粒",
        ]);
        expect(timeToText(reordered, "wd-dinner")).toEqual({
            "18:00": "随餐鱼油 1 粒",
            "18:30": "到家先用约 30 分钟放松、换衣服并与对象交流",
        });
        void target;
    });

    it("升级时旧的位置键按下标迁移，正在生效的时间不会丢一次", () => {
        // 模拟本功能上一版写下的文件：键是 `<条目id>:<下标>`
        const legacy = legacyStore() as { templates: Array<{ id: string; entries: Array<Record<string, unknown>> }>; [key: string]: unknown };
        const parsed = parseChecklistStore({
            ...legacy,
            templates: legacy.templates.map((template) => template.id !== "workday" ? template : {
                ...template,
                entries: template.entries.map((item) => item.id !== "wd-prepare" ? item : { ...item, boundaries: { "wd-prepare:1": "20:15" } }),
            }),
        })!;
        expect(timeToText(parsed, "wd-prepare")).toEqual({ "20:15": "平光镜放进书包" });
    });
    it("连续编辑多次：插入、删除、移动、改写交替进行，时间始终跟着平光镜", () => {
        let store = parseChecklistStore(legacyStore())!;
        const texts = () => entry(store, "wd-prepare").reminders.map((reminder) => reminder.text);

        // 1) 最前面插一行
        store = saveEdited(store, "wd-prepare", ["把水杯洗干净", ...texts()]);
        expect(timeToText(store, "wd-prepare")).toEqual({ "20:15": "平光镜放进书包" });

        // 2) 删掉中间一行
        store = saveEdited(store, "wd-prepare", texts().filter((text) => text.startsWith("净水器") === false));
        expect(timeToText(store, "wd-prepare")).toEqual({ "20:15": "平光镜放进书包" });

        // 3) 把平光镜挪到最后
        store = saveEdited(store, "wd-prepare", [...texts().filter((text) => text !== "平光镜放进书包"), "平光镜放进书包"]);
        expect(timeToText(store, "wd-prepare")).toEqual({ "20:15": "平光镜放进书包" });

        // 4) 就地改写它的说法：时间跟着这条提醒，显示新文字
        store = saveEdited(store, "wd-prepare", texts().map((text) => (text === "平光镜放进书包" ? "平光镜与充电器放进书包" : text)));
        expect(timeToText(store, "wd-prepare")).toEqual({ "20:15": "平光镜与充电器放进书包" });

        // 5) 重开插件（重新解析磁盘内容）后依然如此
        const reopened = parseChecklistStore(JSON.parse(JSON.stringify(store)))!;
        expect(timeToText(reopened, "wd-prepare")).toEqual({ "20:15": "平光镜与充电器放进书包" });
    });

    it("插入新提醒时不会抢走相邻提醒的 id", () => {
        let store = parseChecklistStore(legacyStore())!;
        const before = entry(store, "wd-prepare").reminders.map((reminder) => reminder.id);
        store = saveEdited(store, "wd-prepare", ["新的一行", ...entry(store, "wd-prepare").reminders.map((reminder) => reminder.text)]);
        const after = entry(store, "wd-prepare").reminders.map((reminder) => reminder.id);
        // 原有提醒的 id 一个都没变（新行的 id 不能占用它们的位置序号）
        expect(after.slice(1)).toEqual(before);
        expect(new Set(after).size).toBe(after.length);
    });
});
