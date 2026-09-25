import { afterEach, describe, expect, it, vi } from "vitest";
import DailyBoundaryPanel from "../src/DailyBoundaryPanel.svelte";
import { boundaryHeadlineParts, type ChecklistBoundaryAttention, type ChecklistBoundaryItem } from "../src/checklist-boundary";

describe("边界提醒面板", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    function render(attention: ChecklistBoundaryAttention, props: Record<string, unknown> = {}) {
        component = new DailyBoundaryPanel({
            target: document.body,
            props: { attention, onToggle: () => undefined, onOpenChecklist: () => undefined, ...props },
        });
    }

    it("列出待确认项，并区分「该做了」与「还有多久」", async () => {
        render(attention());
        const items = [...document.querySelectorAll(".xz-boundary-item")];
        // 2 项需要现在处理 + 2 项尚未到点的预览 + 3 项已完成
        expect(items).toHaveLength(7);
        expect(document.querySelector(".xz-daily-boundary-panel > header strong")?.textContent).toBe("现在要确认的 2 件事");

        const overdue = items[0];
        expect(overdue.classList.contains("is-overdue")).toBe(true);
        expect(overdue.textContent).toContain("17:00");
        expect(overdue.textContent).toContain("按早晨计划正式下班");
        expect(overdue.textContent).toContain("该做了 · 已过 32 分钟");
        expect(overdue.textContent).toContain("已做");
        // 标题位写具体事项，阶段名与状态退到补充行
        expect(overdue.querySelector(".xz-boundary-item__body strong")?.textContent).toBe("区间内自选现实时间");
        expect(overdue.querySelector(".xz-boundary-item__body small")?.textContent).toBe("按早晨计划正式下班 · 该做了 · 已过 32 分钟 · 计划时刻＝收尾完成并关闭工作环境");
        expect(overdue.querySelector(".xz-boundary-item__body strong")?.getAttribute("title")).toBe("区间内自选现实时间；计划时刻＝收尾完成并关闭工作环境（按早晨计划正式下班）");

        const soon = items[1];
        expect(soon.classList.contains("is-soon")).toBe(true);
        expect(soon.textContent).toContain("28 分钟后");
        // 提醒原文只有一句时，标题就是整句，补充行不重复同一句话
        expect(soon.querySelector(".xz-boundary-item__body strong")?.textContent).toBe("随餐鱼油 1 粒");
        expect(soon.querySelector(".xz-boundary-item__body small")?.textContent).toBe("晚饭与回家 · 28 分钟后");
    });

    it("点完「已做」挪到已确认区后，抬头仍是同一条具体事项（用户实际遇到的困惑）", async () => {
        render(attention());
        // 12:10 的午饭那条：抬头不能还是「午饭」，否则看不出勾掉的是哪一条
        const lunch = document.querySelector('.xz-boundary-item.is-done[data-boundary-key="wd-lunch::wd-lunch:1"]');
        expect(lunch?.textContent).toContain("12:10");
        expect(lunch?.querySelector(".xz-boundary-item__body strong")?.textContent).toBe("随餐鱼油 1 粒");
        expect(lunch?.querySelector(".xz-boundary-item__body small")?.textContent).toBe("午饭 · 已完成");
        // 抬头本来就是阶段名的那条（提醒原文＝条目标题）不重复一遍阶段名
        const breakfast = document.querySelector('.xz-boundary-item.is-done[data-boundary-key="wd-wake::wd-wake:0"]');
        expect(breakfast?.querySelector(".xz-boundary-item__body strong")?.textContent).toBe("起床");
        expect(breakfast?.querySelector(".xz-boundary-item__body small")?.textContent).toBe("已完成");
    });

    it("确认按钮的无障碍名称带上阶段名，读屏时不丢上下文", async () => {
        render(attention());
        expect(document.querySelector(".xz-boundary-item.is-overdue .xz-boundary-item__done")?.getAttribute("aria-label"))
            .toBe("确认已做：按早晨计划正式下班 · 区间内自选现实时间");
        expect(document.querySelector(".xz-boundary-item.is-later .xz-boundary-item__done")?.getAttribute("aria-label"))
            .toBe("提前确认已做：酪蛋白｜按需 · 仅在全天蛋白质不足或晚上容易饥饿时饮用");
        expect(document.querySelector('.xz-boundary-item.is-done[data-boundary-key="wd-lunch::wd-lunch:1"] .xz-boundary-item__done')?.getAttribute("aria-label"))
            .toBe("撤销确认：午饭 · 随餐鱼油 1 粒");
    });

    it("点「已做」把该条的 key 交回调用方，已确认项显示为可撤销", async () => {
        const onToggle = vi.fn();
        render(attention(), { onToggle });
        const confirm = document.querySelector<HTMLButtonElement>(".xz-boundary-item.is-overdue .xz-boundary-item__done");
        confirm?.click();
        expect(onToggle).toHaveBeenCalledWith("wd-off::wd-off:0", true);

        document.body.replaceChildren();
        component?.$destroy();
        const undo = vi.fn();
        render(attention(), { onToggle: undo });
        const doneButton = document.querySelector<HTMLButtonElement>(".xz-boundary-item.is-done .xz-boundary-item__done");
        expect(doneButton?.getAttribute("aria-pressed")).toBe("true");
        expect(document.querySelector(".xz-boundary-item.is-done")?.textContent).toContain("已完成");
        doneButton?.click();
        expect(undo).toHaveBeenCalledWith("wd-breakfast::wd-breakfast:1", false);
    });

    it("保存中禁用确认，避免连点重复写入", async () => {
        const onToggle = vi.fn();
        render(attention(), { onToggle, saving: true });
        const confirm = document.querySelector<HTMLButtonElement>(".xz-boundary-item__done");
        expect(confirm?.disabled).toBe(true);
        confirm?.click();
        expect(onToggle).not.toHaveBeenCalled();
    });

    it("今天都处理完且没有后续项时才收成一行提示", async () => {
        const done = attention().doneKeys;
        render({ items: [], later: [], doneKeys: done, doneCount: done.length, totalCount: done.length, laterPreviewHeadline: "" });
        expect(document.querySelector(".xz-daily-boundary-panel")?.classList.contains("is-empty")).toBe(true);
        expect(document.body.textContent).toContain("今天的边界提醒都确认完了（3/3）");
        expect(document.querySelector(".xz-boundary-list")).toBeNull();
    });

    it("没有配置边界提醒时说明清楚，而不是显示空面板", async () => {
        render({ items: [], later: [], doneKeys: [], doneCount: 0, totalCount: 0, laterPreviewHeadline: "" });
        expect(document.body.textContent).toContain("今天没有需要单独确认的边界提醒");
    });

    it("还没到点时也要把后续项列出来，而不是只报一个数量（用户实际遇到的场景）", async () => {
        // 09:45 的工作日：没有任何项进入催办窗口，但 12:10／17:00 等后续项必须可见
        const later = attention().later;
        const onToggle = vi.fn();
        render({ items: [], later, doneKeys: [], doneCount: 0, totalCount: later.length, laterPreviewHeadline: "接下来是 12:10 的午饭" }, { onToggle });

        expect(document.querySelector(".xz-daily-boundary-panel")?.classList.contains("is-empty")).toBe(false);
        expect(document.querySelector(".xz-daily-boundary-panel > header strong")?.textContent).toBe("接下来是 12:10 的午饭");
        const rows = [...document.querySelectorAll(".xz-boundary-item.is-later")];
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain("20:00");
        expect(rows[0].textContent).toContain("酪蛋白");
        expect(rows[0].textContent).toContain("还没到点");
        // 没到点的项也能提前确认
        rows[0].querySelector<HTMLButtonElement>(".xz-boundary-item__done")?.click();
        expect(onToggle).toHaveBeenCalledWith("wd-casein::wd-casein:0", true);
    });

    it("后续项超过预览条数时，多出来的用一句话交代清楚", async () => {
        const later = attention().later;
        render({ items: [], later, doneKeys: [], doneCount: 0, totalCount: later.length, laterPreviewHeadline: "接下来是 12:10 的午饭" }, { laterPreviewCount: 1 });
        expect(document.querySelectorAll(".xz-boundary-item.is-later")).toHaveLength(1);
        expect(document.querySelector(".xz-boundary-more")?.textContent).toContain("今天还有 1 项更晚的边界提醒");
    });

    it("不是今天的记录时只列配置过的边界项，不作为催办", async () => {
        render(attention(), { isToday: false });
        expect(document.querySelector(".xz-daily-boundary-panel > header strong")?.textContent).toBe("这一天有 2 项边界提醒");
        expect(document.body.textContent).toContain("不作为催办");
        expect(document.body.textContent).not.toContain("该做了");
    });
});

function item(key: string, entryId: string, entryTitle: string, reminder: string, at: string, minutesFromNow: number, status: ChecklistBoundaryItem["status"]): ChecklistBoundaryItem {
    const [hours, minutes] = at.split(":").map(Number);
    // 与领域层同一套拆句规则：标题＝提醒原文第一分句，阶段名退到补充行
    const { headline, detail } = boundaryHeadlineParts(reminder, entryTitle);
    return { key, entryId, entryTitle, headline, detail, reminder, at, atMinutes: hours * 60 + minutes, minutesFromNow, status };
}

function attention(): ChecklistBoundaryAttention {
    const items = [
        item("wd-off::wd-off:0", "wd-off", "按早晨计划正式下班", "区间内自选现实时间；计划时刻＝收尾完成并关闭工作环境", "17:00", 32, "overdue"),
        item("wd-dinner::wd-dinner:0", "wd-dinner", "晚饭与回家", "随餐鱼油 1 粒", "18:00", -28, "soon"),
    ];
    const later = [
        item("wd-casein::wd-casein:0", "wd-casein", "酪蛋白｜按需", "仅在全天蛋白质不足或晚上容易饥饿时饮用", "20:00", -148, "later"),
        item("wd-prepare::wd-prepare:1", "wd-prepare", "准备明天", "平光镜放进书包；净水器加满水；给蒸锅换水", "20:15", -163, "later"),
    ];
    const doneKeys = [
        item("wd-breakfast::wd-breakfast:1", "wd-breakfast", "返回办公室＋早餐＋日评估", "玉米、红薯、鸡蛋；随餐鱼油 1 粒", "08:45", 527, "later"),
        item("wd-lunch::wd-lunch:1", "wd-lunch", "午饭", "随餐鱼油 1 粒；不边吃边工作", "12:10", 322, "later"),
        // 提醒原文＝条目标题的那类（没有补充分句），用于验证补充行不重复阶段名
        item("wd-wake::wd-wake:0", "wd-wake", "起床", "起床", "06:00", 687, "later"),
    ];
    return {
        items,
        later,
        doneKeys,
        doneCount: doneKeys.length,
        totalCount: items.length + later.length + doneKeys.length,
        laterPreviewHeadline: "接下来是 12:10 的午饭",
    };
}
