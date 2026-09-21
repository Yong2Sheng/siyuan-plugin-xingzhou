import { describe, expect, it } from "vitest";
import { boundaryKeyFor, createDefaultChecklistStore, reminderIdFor, type ChecklistEntry, type ChecklistStore, type ChecklistTemplate } from "../src/checklist";
import { BOUNDARY_MAX_VISIBLE, boundaryAttention, boundaryRelativeLabel, boundarySummary, boundaryTemplateId } from "../src/checklist-boundary";

/** 2026-03-12 是星期四 → 工作日模板。 */
const DATE = "2026-03-12";

function at(hour: number, minute = 0): number {
    return new Date(`${DATE}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`).getTime();
}

function workday(store: ChecklistStore = createDefaultChecklistStore(1000)): ChecklistTemplate {
    const template = store.templates.find((candidate) => candidate.id === "workday");
    if (!template) throw new Error("缺少工作日模板");
    return template;
}

function attention(now: number, states: Record<string, string> = {}, template = workday(), date = DATE) {
    return boundaryAttention(template, new Map(Object.entries(states)), { date, dayType: "research-workday", now });
}

/** 极简模板：只保留指定边界时间的条目，便于精确断言窗口行为。 */
function templateWith(entries: Array<{ id: string; title: string; at: string; reminder?: string }>): ChecklistTemplate {
    return {
        id: "workday",
        label: "测试",
        subtitle: "测试用模板",
        entries: entries.map((item): ChecklistEntry => ({
            id: item.id,
            time: item.at,
            title: item.title,
            reminders: [{ id: reminderIdFor(item.id, 0), text: item.reminder ?? item.title }],
            boundaries: { [boundaryKeyFor(item.id, reminderIdFor(item.id, 0))]: item.at },
            tone: "plain",
        })),
    };
}

describe("边界提醒窗口", () => {
    it("逾期未确认与 60 分钟内即将到来的项浮出，其余收进折叠区", () => {
        // 17:32：17:00 已过 32 分钟（逾期），18:00 还有 28 分钟（即将到来）
        const result = attention(at(17, 32));
        expect(result.items.map((item) => item.key)).toEqual(["wd-off::wd-off:0", "wd-dinner::wd-dinner:0"]);
        expect(result.items[0]).toMatchObject({ status: "overdue", at: "17:00", minutesFromNow: 32, entryTitle: "按早晨计划正式下班" });
        expect(result.items[1]).toMatchObject({ status: "soon", at: "18:00", minutesFromNow: -28, entryTitle: "晚饭与回家" });
        // 当天更晚的 20:00 酪蛋白、20:15 平光镜，以及当天更早的 08:45／12:10 都属于「稍后」
        expect(result.later.map((item) => item.at)).toEqual(["08:45", "12:10", "20:00", "20:15"]);
        expect(boundarySummary(result)).toBe("现在要确认的 2 件事");
    });

    it("已确认的边界项不再催办，但仍计入完成数", () => {
        const result = attention(at(17, 32), { "wd-off::wd-off:0": "completed" });
        expect(result.items.map((item) => item.key)).toEqual(["wd-dinner::wd-dinner:0"]);
        expect(result.doneKeys.map((item) => item.key)).toEqual(["wd-off::wd-off:0"]);
        expect(result.doneCount).toBe(1);
        expect(boundarySummary(result)).toBe("现在要确认的 1 件事");
    });

    it("标记为未完成的仍算待处理：那是还没做的事，不是做完了", () => {
        const result = attention(at(17, 32), { "wd-off::wd-off:0": "missed" });
        expect(result.items.map((item) => item.key)).toContain("wd-off::wd-off:0");
        expect(result.doneKeys).toHaveLength(0);
    });

    it("逾期超过 3 小时不再催办，避免翻旧账", () => {
        // 21:30：17:00（已过 4.5 小时）与 18:00（已过 3.5 小时）都超出 3 小时窗口，
        // 只剩 20:15（刚过 75 分钟）与 20:00（刚过 90 分钟），越近的越靠前
        const result = attention(at(21, 30));
        expect(result.items.map((item) => item.at)).toEqual(["20:15", "20:00"]);
        expect(result.items.every((item) => item.status === "overdue")).toBe(true);
        expect(result.items.map((item) => item.minutesFromNow)).toEqual([75, 90]);
        expect(result.later.map((item) => item.at)).toEqual(["08:45", "12:10", "17:00", "18:00"]);

        // 23:00：20:00 正好压到 3 小时边界仍算待确认，20:15 已过 2 小时 45 分
        const late = attention(at(23, 0));
        expect(late.items.map((item) => [item.at, item.minutesFromNow])).toEqual([["20:15", 165], ["20:00", 180]]);
    });

    it("凌晨不把昨晚的时间点算成今天逾期", () => {
        // 02:00：20:15 的边界时间是昨晚的，不该显示为「已过 5 小时 45 分钟」
        const result = attention(at(2, 0));
        expect(result.items).toHaveLength(0);
        expect(result.later.map((item) => item.at)).toEqual(["08:45", "12:10", "17:00", "18:00", "20:00", "20:15"]);
    });

    it("一次最多展开 4 项，其余进入折叠区", () => {
        const template = templateWith([
            { id: "a", title: "A", at: "10:00" },
            { id: "b", title: "B", at: "10:30" },
            { id: "c", title: "C", at: "11:00" },
            { id: "d", title: "D", at: "11:20" },
            { id: "e", title: "E", at: "11:40" },
            { id: "f", title: "F", at: "11:50" },
        ]);
        const result = attention(at(11, 30), {}, template);
        expect(result.items).toHaveLength(BOUNDARY_MAX_VISIBLE);
        expect(result.later).toHaveLength(2);
    });

    it("逾期项按「刚过点」优先排序", () => {
        const template = templateWith([
            { id: "early", title: "早很久", at: "09:00" },
            { id: "late", title: "刚过点", at: "11:20" },
        ]);
        const result = attention(at(11, 30), {}, template);
        expect(result.items.map((item) => item.entryId)).toEqual(["late", "early"]);
    });

    it("翻到不是今天的日期时不按时间催办", () => {
        const result = attention(at(17, 32), {}, workday(), "2026-03-11");
        expect(result.items).toHaveLength(0);
        expect(result.later).toHaveLength(0);
        expect(result.doneKeys).toHaveLength(0);
        // 提醒仍然被统计到，只是不作为催办列出
        expect(result.totalCount).toBeGreaterThan(0);
    });

    it("一天里大部分时间没有可催办项时，也要给出「接下来是什么」", () => {
        // 用户实际遇到的场景：上午 09:45 时最近的可催办项是 08:45 的早餐鱼油（刚过 1 小时），
        // 之后 12:10／17:00 都还没到点。这时面板不能只剩一行数量提示，必须说清接下来是什么。
        const morning = attention(at(9, 45));
        expect(morning.items.map((item) => [item.at, item.minutesFromNow])).toEqual([["08:45", 60]]);
        expect(boundarySummary(morning)).toBe("现在要确认的 1 件事");
        expect(morning.later.map((item) => item.at)).toEqual(["12:10", "17:00", "18:00", "20:00", "20:15"]);

        // 用只含后续项的模板验证标题文案：没有任何催办项时要说「接下来是……」
        const laterOnly = templateWith([
            { id: "lunch", title: "午饭", at: "12:10" },
            { id: "dinner", title: "晚饭与回家", at: "18:00" },
        ]);
        const quiet = attention(at(9, 45), {}, laterOnly);
        expect(quiet.items).toHaveLength(0);
        expect(quiet.laterPreviewHeadline).toBe("接下来是 12:10 的午饭");
        expect(quiet.later.map((item) => item.at)).toEqual(["12:10", "18:00"]);

        // 12:05 时 12:10 进入「即将到来」，标题变回催办式，随后的项成为「接下来」
        const noon = attention(at(12, 5), {}, laterOnly);
        expect(noon.items.map((item) => item.at)).toEqual(["12:10"]);
        expect(boundarySummary(noon)).toBe("现在要确认的 1 件事");
        expect(noon.laterPreviewHeadline).toBe("接下来是 18:00 的晚饭与回家");

        // 后续项都确认掉以后标题退化为空串，不再假装有事要做
        const cleared = attention(at(9, 45), { "lunch::lunch:0": "completed", "dinner::dinner:0": "completed" }, laterOnly);
        expect(cleared.items).toHaveLength(0);
        expect(cleared.later).toHaveLength(0);
        expect(cleared.laterPreviewHeadline).toBe("");
    });

    it("没有配置边界时间的模板不出现在面板里", () => {
        const store = createDefaultChecklistStore(1000);
        const bare: ChecklistTemplate = {
            ...workday(store),
            entries: workday(store).entries.map(({ boundaries: _boundaries, ...rest }) => rest),
        };
        const result = attention(at(17, 32), {}, bare);
        expect(result.totalCount).toBe(0);
        expect(boundarySummary(result)).toBe("");
    });

    it("改写提醒文字后，边界时间仍然跟着这条提醒（按身份绑定，不按位置）", () => {
        const template = workday();
        const renamed: ChecklistTemplate = {
            ...template,
            entries: template.entries.map((entry) => entry.id !== "wd-dinner"
                ? entry
                : { ...entry, reminders: entry.reminders.map((reminder) => ({ ...reminder, text: "改写后的晚饭提醒" })) }),
        };
        // 时间绑在提醒 id 上：文字改了照样按 18:00 浮出，而且显示的是新文字
        const result = attention(at(18, 5), {}, renamed);
        const dinner = result.items.find((item) => item.entryId === "wd-dinner");
        expect(dinner?.at).toBe("18:00");
        expect(dinner?.reminder).toBe("改写后的晚饭提醒");
        // 其他条目的边界提醒不受影响
        expect(result.later.map((item) => item.key)).toContain("wd-prepare::wd-prepare:1");
    });

    it("用户自己新增的边界提醒也按 id 生效", () => {
        const template = workday();
        const custom: ChecklistTemplate = {
            ...template,
            entries: template.entries.map((entry) => entry.id !== "wd-wake"
                ? entry
                : {
                    ...entry,
                    reminders: [{ id: "wd-wake:0", text: "自定义提醒" }, ...entry.reminders.slice(1)],
                    boundaries: { "wd-wake::wd-wake:0": "06:05" },
                }),
        };
        const result = attention(at(6, 20), {}, custom);
        expect(result.items.map((item) => item.key)).toEqual(["wd-wake::wd-wake:0"]);
        expect(result.items[0].reminder).toBe("自定义提醒");
    });

    it("周末训练日与休息日共用条目级的训练边界，早餐边界两组都生效", () => {
        // 2026-09-12 是星期六。训练结束时间挂在通用提醒上（训练/休息由当天选择决定），
        // 因此两种模式下这一条都在；早餐鱼油每天都要吃，同样两种模式都浮出。
        const expected = ["sat-training::sat-training:0", "sat-breakfast::sat-breakfast:0"];
        for (const mode of ["training", "rest"] as const) {
            const result = boundaryAttention(saturdayTemplate(), new Map(), {
                date: "2026-09-12",
                dayType: "saturday-reset",
                trainingMode: mode,
                now: new Date("2026-09-12T07:15:00").getTime(),
            });
            expect(result.items.map((item) => item.key), `训练模式 ${mode}`).toEqual(expected);
        }

        // 训练/休息各自专属的提醒也只在选定模式下参与边界判断
        const withGroupBoundary: ChecklistTemplate = {
            ...saturdayTemplate(),
            entries: saturdayTemplate().entries.map((entry) => entry.id !== "sat-training"
                ? entry
                : { ...entry, boundaries: { ...entry.boundaries, "sat-training::sat-training:rest:1": "08:00" } }),
        };
        const restOnly = boundaryAttention(withGroupBoundary, new Map(), {
            date: "2026-09-12",
            dayType: "saturday-reset",
            trainingMode: "rest",
            now: new Date("2026-09-12T07:15:00").getTime(),
        });
        expect(restOnly.items.map((item) => item.reminder)).toContain("肌酸随早餐或午餐");
        const trainingOnly = boundaryAttention(withGroupBoundary, new Map(), {
            date: "2026-09-12",
            dayType: "saturday-reset",
            trainingMode: "training",
            now: new Date("2026-09-12T07:15:00").getTime(),
        });
        expect(trainingOnly.items.map((item) => item.reminder)).not.toContain("肌酸随早餐或午餐");
    });
});

describe("边界提醒的模板与文案", () => {
    it("开会日覆盖星期模板，与 Checklist 视图取模板规则一致", () => {
        expect(boundaryTemplateId(DATE, "conference-day")).toBe("conference");
        expect(boundaryTemplateId(DATE, "research-workday")).toBe("workday");
        expect(boundaryTemplateId("2026-09-12", null)).toBe("saturday");
        expect(boundaryTemplateId("2026-09-13", null)).toBe("sunday");
    });

    it("相对时间文案覆盖整点与零分钟", () => {
        expect(boundaryRelativeLabel(32)).toBe("已过 32 分钟");
        expect(boundaryRelativeLabel(60)).toBe("已过 1 小时");
        expect(boundaryRelativeLabel(0)).toBe("就是现在");
        expect(boundaryRelativeLabel(-28)).toBe("28 分钟后");
        expect(boundaryRelativeLabel(-120)).toBe("2 小时后");
    });
});

function saturdayTemplate(): ChecklistTemplate {
    const store = createDefaultChecklistStore(1000);
    const template = store.templates.find((candidate) => candidate.id === "saturday");
    if (!template) throw new Error("缺少周六模板");
    return template;
}
