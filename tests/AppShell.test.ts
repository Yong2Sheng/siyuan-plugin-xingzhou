import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppShell from "../src/AppShell.svelte";
import DailyRhythm from "../src/DailyRhythm.svelte";
import { createEmptyDailyStore, upsertDailyRecord, type DailyRecord } from "../src/daily-records";

describe("行舟一级模块外壳", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("把项目与事务和生活节律放在不同一级模块", async () => {
        component = new AppShell({ target: document.body, props: props() });
        expect(document.querySelector(".xz-module-nav")?.textContent).toContain("项目与事务");
        expect(document.querySelector(".xz-module-nav")?.textContent).toContain("生活节律");
        expect(document.querySelector(".xz-main-nav")?.textContent).toContain("本周");

        clickButton("生活节律");
        await tick();

        expect(document.querySelector(".xz-daily-view-nav")?.textContent).toContain("今日记录");
        expect(document.querySelector(".xz-daily-view-nav")?.textContent).toContain("时间线");
        expect(document.querySelector(".xz-main-nav")).toBeNull();
    });

    it("休假模式隐藏科研字段，并保留生活与恢复输入", async () => {
        const properties = props();
        component = new DailyRhythm({ target: document.body, props: { loadDaily: properties.loadDaily, saveDaily: properties.saveDaily } });
        await tick();
        await vi.waitFor(() => expect(properties.loadDaily).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-context select"), document.body.innerHTML).not.toBeNull());

        const select = document.querySelector(".xz-daily-context select") as HTMLSelectElement;
        select.value = "holiday";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();

        expect(document.body.textContent).not.toContain("今天最重要的工作内容");
        expect(document.body.textContent).toContain("今天如何休息／个人生活重点");
        expect(document.body.textContent).toContain("科研字段不适用");
    });

    it("把小时和分钟组合保存，并自动判断下班是否超时", async () => {
        let store = createEmptyDailyStore(1000);
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await tick();
        await vi.waitFor(() => expect(document.querySelector('[aria-label="昨晚熄灯小时"]')).not.toBeNull());

        choose("昨晚熄灯小时", "22");
        choose("昨晚熄灯分钟", "07");
        choose("睡眠时长小时", "5");
        choose("睡眠时长分钟", "46");
        choose("计划下班时间小时", "16");
        choose("计划下班时间分钟", "45");
        clickButton("下班");
        await tick();
        choose("实际下班时间小时", "16");
        choose("实际下班时间分钟", "49");
        await tick();

        expect(document.body.textContent).toContain("超出计划 4 分钟");
        clickButton("保存今日记录");
        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledOnce());
        expect(saveDaily.mock.calls[0][0].fields).toMatchObject({
            lightsOffTime: "22:07", sleepDurationMinutes: 346, plannedWorkEndTime: "16:45", actualWorkEndTime: "16:49",
        });
    });

    it("再次点击已选评分即可清除，并且不增加会造成跳动的按钮", async () => {
        const properties = props();
        component = new DailyRhythm({ target: document.body, props: { loadDaily: properties.loadDaily, saveDaily: properties.saveDaily } });
        await tick();
        await vi.waitFor(() => expect(document.querySelector('[aria-label="主观睡眠质量 2 分"]')).not.toBeNull());

        const score = document.querySelector('[aria-label="主观睡眠质量 2 分"]') as HTMLButtonElement;
        score.click();
        await tick();
        expect(score.getAttribute("aria-pressed")).toBe("true");
        expect(document.querySelectorAll(".xz-daily-score-buttons button")).toHaveLength(5);

        score.click();
        await tick();
        expect(score.getAttribute("aria-pressed")).toBe("false");
        expect(document.querySelectorAll(".xz-daily-score-buttons button")).toHaveLength(5);
    });

    it("关键工作结果选择后立即保持所选值", async () => {
        let store = createEmptyDailyStore(1000);
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await tick();
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());
        clickButton("下班");
        await tick();

        const select = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("关键工作结果"))
            ?.querySelector("select") as HTMLSelectElement | undefined;
        if (!select) throw new Error("没有找到关键工作结果选择框");
        select.value = "met";
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();

        expect(select.value).toBe("met");
        expect(select.selectedOptions[0]?.textContent).toContain("达标");
        clickButton("保存今日记录");
        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledOnce());
        expect(saveDaily.mock.calls[0][0].fields.keyWorkResult).toBe("met");
    });

    it("按是否需要工作闭环切换字段，并把不需要保存为明确状态", async () => {
        let store = createEmptyDailyStore(1000);
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await tick();
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());
        clickButton("下班");
        await tick();

        const select = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("本次是否需要工作闭环"))
            ?.querySelector("select") as HTMLSelectElement | undefined;
        if (!select) throw new Error("没有找到工作闭环选择框");

        select.value = "not-needed";
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(select.value).toBe("not-needed");
        expect(document.body.textContent).toContain("不计为 0 分钟");
        expect(document.querySelector('[aria-label="工作闭环预计时间小时"]')).toBeNull();

        clickButton("保存今日记录");
        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledOnce());
        expect(saveDaily.mock.calls[0][0].fields.closureNeed).toBe("not-needed");
        expect(store.records[0].fields.closurePlannedMinutes).toBeNull();
    });

    function props() {
        return {
            load: vi.fn(() => new Promise<never>(() => undefined)),
            captureInbox: vi.fn(), saveItem: vi.fn(), deleteItem: vi.fn(), openItemMenu: vi.fn(),
            openCaptureDialog: vi.fn(), openDocument: vi.fn(),
            loadDaily: vi.fn().mockResolvedValue(createEmptyDailyStore(1000)), saveDaily: vi.fn(),
        };
    }

    function clickButton(label: string) {
        const button = [...document.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
        if (!button) throw new Error(`没有找到按钮：${label}`);
        button.click();
    }

    function choose(ariaLabel: string, value: string) {
        const select = document.querySelector(`[aria-label="${ariaLabel}"]`) as HTMLSelectElement | null;
        if (!select) throw new Error(`没有找到选择框：${ariaLabel}`);
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    }
});
