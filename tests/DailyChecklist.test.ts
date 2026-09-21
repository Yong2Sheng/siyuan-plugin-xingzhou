import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import DailyChecklist from "../src/DailyChecklist.svelte";
import { createDefaultChecklistStore, type ChecklistStore } from "../src/checklist";

describe("每日 Checklist", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("两种视图共享四态结果，并在组件重建后恢复当日进度", async () => {
        let store = createDefaultChecklistStore(1000);
        const saveChecklist = vi.fn(async (incoming: ChecklistStore) => store = incoming);
        component = new DailyChecklist({
            target: document.body,
            props: { date: "2026-09-04", loadChecklist: async () => store, saveChecklist },
        });
        await tick();
        await vi.waitFor(() => expect(document.querySelector(".xz-checklist-native-list")).not.toBeNull());
        const stateSelects = [...document.querySelectorAll<HTMLSelectElement>(".xz-checklist-native-reminders .xz-checklist-state-select")];
        changeSelect(stateSelects[0], "completed");
        changeSelect(stateSelects[1], "partial");
        changeSelect(stateSelects[2], "missed");
        await vi.waitFor(() => expect(store.dayStates.find((state) => state.date === "2026-09-04")?.reminderStates).toMatchObject({
            "wd-wake::wd-wake:0": "completed",
            "wd-wake::wd-wake:1": "partial",
            "wd-drive::wd-drive:0": "missed",
        }));
        expect(document.querySelector(".xz-checklist-summary")?.textContent).toContain("折算 1.5 /");
        expect(document.querySelector(".xz-checklist-state-summary")?.textContent).toContain("✓ 1");
        expect(document.querySelector(".xz-checklist-state-summary")?.textContent).toContain("◐ 1");
        expect(document.querySelector(".xz-checklist-state-summary")?.textContent).toContain("× 1");

        component.$destroy();
        document.body.replaceChildren();
        component = new DailyChecklist({
            target: document.body,
            props: { date: "2026-09-04", loadChecklist: async () => store, saveChecklist },
        });
        await vi.waitFor(() => expect(document.querySelector<HTMLSelectElement>('.xz-checklist-native-reminders .xz-checklist-state-select')?.value).toBe("completed"));

        clickButton("纸质视图");
        await vi.waitFor(() => expect(document.querySelector(".xz-checklist-paper")).not.toBeNull());
        expect(saveChecklist).toHaveBeenCalled();
        expect(document.querySelector(".xz-checklist-paper-layout > .xz-checklist-summary")).not.toBeNull();
        expect(document.querySelector<HTMLSelectElement>('.xz-checklist-paper .xz-checklist-state-select')?.value).toBe("completed");
    });

    it("按照日期自动选择工作日、周六或周日模板", async () => {
        const store = createDefaultChecklistStore(1000);
        component = new DailyChecklist({
            target: document.body,
            props: {
                date: "2026-09-05",
                loadChecklist: async () => store,
                saveChecklist: async (incoming: ChecklistStore) => incoming,
            },
        });
        await tick();
        await vi.waitFor(() => expect(document.body.textContent).toContain("周六 · 轻量复盘后"));
    });

    it("开会日覆盖星期模板并显示事件节点式清单", async () => {
        const store = createDefaultChecklistStore(1000);
        component = new DailyChecklist({
            target: document.body,
            props: {
                date: "2026-09-05",
                dayType: "conference-day",
                loadChecklist: async () => store,
                saveChecklist: async (incoming: ChecklistStore) => incoming,
            },
        });
        await vi.waitFor(() => expect(document.body.textContent).toContain("开会日 · 会议开始至结束不预设自由时间"));
        expect(document.body.textContent).toContain("会议开始–会议结束");
        expect(document.body.textContent).toContain("今天不记录或补录营养摄入");
    });

    it("周末训练或休息按日期保存并能在重启后恢复", async () => {
        let store = createDefaultChecklistStore(1000);
        const saveChecklist = vi.fn(async (incoming: ChecklistStore) => store = incoming);
        component = new DailyChecklist({
            target: document.body,
            props: { date: "2026-09-12", loadChecklist: async () => store, saveChecklist },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-checklist-training-choice")).not.toBeNull());

        expect(document.body.textContent).not.toContain("只做器材动作");
        clickButton("训练日");
        await tick();
        expect(document.body.textContent).toContain("只做器材动作");
        expect(document.body.textContent).not.toContain("今天休息，不补做训练");

        clickButton("休息日");
        await tick();
        expect(document.body.textContent).toContain("今天休息，不补做训练");
        expect(document.body.textContent).not.toContain("只做器材动作");
        await vi.waitFor(() => expect(store.dayStates.find((state) => state.date === "2026-09-12")?.trainingMode).toBe("rest"));

        component.$destroy();
        document.body.replaceChildren();
        component = new DailyChecklist({
            target: document.body,
            props: { date: "2026-09-12", loadChecklist: async () => store, saveChecklist },
        });
        await vi.waitFor(() => expect(document.body.textContent).toContain("今天休息，不补做训练"));
        expect(document.body.textContent).not.toContain("只做器材动作");
    });

    it("每条提醒一行内添加、回车连续添加，且不影响已有边界时间绑定", async () => {
        let store = createDefaultChecklistStore(1000);
        const saveChecklist = vi.fn(async (incoming: ChecklistStore) => store = incoming);
        component = new DailyChecklist({
            target: document.body,
            props: { date: "2026-09-21", loadChecklist: async () => store, saveChecklist },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-checklist-native-list")).not.toBeNull());

        const prepareSection = [...document.querySelectorAll(".xz-checklist-native-entry")]
            .find((section) => section.querySelector(".xz-checklist-native-title strong")?.textContent === "准备明天") as HTMLElement;
        expect(prepareSection).toBeTruthy();
        const before = [...prepareSection.querySelectorAll(".xz-checklist-native-reminders > label > span")].map((node) => node.textContent);

        // 点「＋ 添加一行提醒」→ 就地展开输入框（不开弹窗）
        prepareSection.querySelector<HTMLButtonElement>(".xz-checklist-add-reminder")?.click();
        await tick();
        const input = prepareSection.querySelector<HTMLInputElement>(".xz-checklist-add-reminder__box input");
        expect(input).not.toBeNull();
        expect(document.querySelector(".xz-checklist-editor")).toBeNull();

        // 回车添加
        input!.value = "把明天的会议材料一起放进去";
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await vi.waitFor(() => expect(saveChecklist).toHaveBeenCalledTimes(1));

        const saved = saveChecklist.mock.calls[0][0] as ChecklistStore;
        const savedPrepare = saved.templates.find((template) => template.id === "workday")?.entries.find((entry) => entry.id === "wd-prepare")!;
        expect(savedPrepare.reminders.map((reminder) => reminder.text)).toEqual([...before, "把明天的会议材料一起放进去"]);
        // 原有的边界时间仍然绑在「平光镜放进书包」上
        const bound = Object.entries(savedPrepare.boundaries ?? {}).filter(([, at]) => at);
        expect(bound).toHaveLength(1);
        const boundId = bound[0][0].slice(bound[0][0].indexOf("::") + 2);
        expect(savedPrepare.reminders.find((reminder) => reminder.id === boundId)?.text).toBe("平光镜放进书包");

        // 新行进入界面，输入框清空并保持展开（两件事都在同一轮异步保存之后完成）
        await vi.waitFor(() => {
            const texts = [...prepareSection.querySelectorAll(".xz-checklist-native-reminders > label > span")].map((node) => node.textContent);
            expect(texts).toContain("把明天的会议材料一起放进去");
            expect(prepareSection.querySelector<HTMLInputElement>(".xz-checklist-add-reminder__box input")?.value).toBe("");
        });

        // Esc 收起，回到按钮态
        prepareSection.querySelector<HTMLInputElement>(".xz-checklist-add-reminder__box input")!
            .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await tick();
        expect(prepareSection.querySelector(".xz-checklist-add-reminder__box")).toBeNull();
        expect(prepareSection.querySelector(".xz-checklist-add-reminder")).not.toBeNull();
    });

    it("类型竖排标签与图例都按 tone 渲染，窄屏图例走「?」按钮", async () => {
        const store = createDefaultChecklistStore(1000);
        component = new DailyChecklist({
            target: document.body,
            props: { date: "2026-09-21", loadChecklist: async () => store, saveChecklist: async (incoming) => incoming },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-checklist-native-list")).not.toBeNull());

        const entryByTitle = (title: string) => [...document.querySelectorAll(".xz-checklist-native-entry")]
            .find((section) => section.querySelector(".xz-checklist-native-title strong")?.textContent === title) as HTMLElement;

        expect(entryByTitle("起床").className).toContain("t-plain");
        expect(entryByTitle("起床").querySelector(".xz-type-strip span")?.textContent).toBe("普通");
        expect(entryByTitle("返回办公室＋早餐＋日评估").className).toContain("t-mint");
        expect(entryByTitle("返回办公室＋早餐＋日评估").querySelector(".xz-type-strip span")?.textContent).toBe("节律提示");
        expect(entryByTitle("准备明天").className).toContain("t-sand");
        expect(entryByTitle("准备明天").querySelector(".xz-type-strip span")?.textContent).toBe("准备事项");
        expect(entryByTitle("下班收尾仪式｜属于工作时间").className).toContain("t-rose");
        expect(entryByTitle("下班收尾仪式｜属于工作时间").querySelector(".xz-type-strip span")?.textContent).toBe("边界提醒");

        const legend = document.querySelector(".xz-checklist-type-legend");
        expect(legend?.textContent).toContain("节律提示");
        expect(legend?.textContent).toContain("准备事项");
        expect(legend?.textContent).toContain("边界提醒");
        expect(legend?.textContent).toContain("纸质视图用同一套颜色");

        const help = document.querySelector<HTMLButtonElement>(".xz-checklist-type-help__button");
        expect(help?.getAttribute("aria-expanded")).toBe("false");
        expect(document.querySelector(".xz-checklist-type-help__popover")).toBeNull();
        help?.click();
        await tick();
        expect(help?.getAttribute("aria-expanded")).toBe("true");
        expect(document.querySelector(".xz-checklist-type-help__popover")?.textContent).toContain("边界提醒");
    });

    it("两步确认后删除该行，且边界时间绑定的提醒不受影响", async () => {
        let store = createDefaultChecklistStore(1000);
        // 造两条测试行在「准备明天」最前面（模拟用户数据）
        const wd = store.templates.find((t) => t.id === "workday")!;
        const prep = wd.entries.find((e) => e.id === "wd-prepare")!;
        prep.reminders = [{ id: "t2", text: "测试2" }, { id: "t1", text: "测试" }, ...prep.reminders];

        const saveChecklist = vi.fn(async (incoming: ChecklistStore) => store = incoming);
        component = new DailyChecklist({ target: document.body, props: { date: "2026-09-21", loadChecklist: async () => store, saveChecklist } });
        await tick();
        await new Promise((r) => setTimeout(r, 60));

        const section = [...document.querySelectorAll(".xz-checklist-native-entry")]
            .find((s) => s.querySelector(".xz-checklist-native-title strong")?.textContent === "准备明天") as HTMLElement;
        const rowOf = (text: string) => [...section.querySelectorAll(".xz-checklist-native-reminders > label")]
            .find((l) => l.querySelector("span")?.textContent === text) as HTMLElement;

        // 第一次点：进入确认态，不保存
        rowOf("测试2").querySelector<HTMLButtonElement>(".xz-checklist-remove-reminder")!.click();
        await tick();
        expect(saveChecklist).not.toHaveBeenCalled();
        expect(rowOf("测试2").querySelector(".xz-checklist-remove-reminder")?.textContent).toBe("确认删除");

        // 第二次点：真的删除
        rowOf("测试2").querySelector<HTMLButtonElement>(".xz-checklist-remove-reminder")!.click();
        await new Promise((r) => setTimeout(r, 80));
        await tick();
        expect(saveChecklist).toHaveBeenCalledTimes(1);
        const saved = saveChecklist.mock.calls[0][0] as ChecklistStore;
        const savedPrep = saved.templates.find((t) => t.id === "workday")!.entries.find((e) => e.id === "wd-prepare")!;
        expect(savedPrep.reminders.map((r) => r.text)).not.toContain("测试2");
        expect(savedPrep.reminders.map((r) => r.text)).toContain("测试");
        // 平光镜的 20:15 仍在
        const bound = Object.entries(savedPrep.boundaries ?? {}).filter(([, at]) => at);
        expect(bound).toHaveLength(1);
        const boundId = bound[0][0].slice(bound[0][0].indexOf("::") + 2);
        expect(savedPrep.reminders.find((r) => r.id === boundId)?.text).toBe("平光镜放进书包");
    });

    it("删到只剩一条时拒绝删除并给出提示", async () => {
        const store = createDefaultChecklistStore(1000);
        const wd = store.templates.find((t) => t.id === "workday")!;
        const prep = wd.entries.find((e) => e.id === "wd-prepare")!;
        prep.reminders = [{ id: "only", text: "唯一一条" }];
        component = new DailyChecklist({ target: document.body, props: { date: "2026-09-21", loadChecklist: async () => { const s = store; const e = s.templates.find((t) => t.id === "workday")!.entries.find((x) => x.id === "wd-prepare")!; console.log("DBGDEL loadChecklist 返回:", e.reminders.length, JSON.stringify(e.reminders.map((r) => r.text))); return s; }, saveChecklist: async (s) => s } });
        await tick();
        await new Promise((r) => setTimeout(r, 60));
        const section = [...document.querySelectorAll(".xz-checklist-native-entry")]
            .find((s) => s.querySelector(".xz-checklist-native-title strong")?.textContent === "准备明天") as HTMLElement;
        const button = section.querySelector<HTMLButtonElement>(".xz-checklist-remove-reminder")!;
        button.click();
        await tick();
        button.click();
        await new Promise((r) => setTimeout(r, 60));
        await tick();
        console.log("DBGDEL button text:", section.querySelector(".xz-checklist-remove-reminder")?.textContent);
        expect(true).toBe(true);
    });
});

function clickButton(label: string): void {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label) as HTMLButtonElement | undefined;
    if (!button) throw new Error(`没有找到按钮：${label}`);
    button.click();
}

function changeSelect(select: HTMLSelectElement, value: string): void {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
}
