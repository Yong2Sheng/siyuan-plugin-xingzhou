import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppShell from "../src/AppShell.svelte";
import DailyRhythm from "../src/DailyRhythm.svelte";
import { createEmptyDailyStore, upsertDailyRecord, type DailyRecord } from "../src/daily-records";
import type { WorkItem, WorkItemData } from "../src/work-items";

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

    it("离开项目与事务后再返回时恢复此前聚焦的工作项", async () => {
        const workData = sampleWorkItemData(sampleWorkItems());
        const properties = { ...props(), load: vi.fn().mockResolvedValue(workData) };
        component = new AppShell({ target: document.body, props: properties });
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="action-1"] > .xz-tree-row')).not.toBeNull());

        (document.querySelector('[data-work-item-id="action-1"] .xz-tree-main') as HTMLButtonElement).click();
        await tick();
        expect(document.querySelector('[data-work-item-id="action-1"] > .xz-tree-row')?.classList.contains("selected")).toBe(true);
        expect(document.querySelector('[data-work-item-id="domain-1"]')).not.toBeNull();
        expect(document.querySelector(".xz-scope-button.active")).toBeNull();

        clickButton("生活节律");
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-view-nav")).not.toBeNull());
        clickButton("项目与事务");
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="action-1"] > .xz-tree-row')?.classList.contains("selected")).toBe(true));
        expect(document.querySelector('[data-work-item-id="domain-1"]')).not.toBeNull();
        expect(document.querySelector(".xz-scope-button.active")).toBeNull();
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

    it("把下班判断与下班后个人安排拆成独立阶段", async () => {
        const properties = props();
        component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: properties.loadDaily,
                saveDaily: properties.saveDaily,
                loadWorkItems: vi.fn().mockResolvedValue(sampleWorkItemData(sampleWorkItems())),
            },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());

        expect(document.querySelector(".xz-daily-project-picker")).toBeNull();
        expect(document.querySelector('[aria-label="个人项目实际时长小时"]')).toBeNull();
        expect([...document.querySelectorAll("label")].some((label) => label.textContent?.includes("完成训练"))).toBe(true);

        clickButton("下班");
        await vi.waitFor(() => expect(document.body.textContent).toContain("工作时间边界"));
        expect(document.querySelector(".xz-daily-project-picker")).toBeNull();
        expect(document.body.textContent).not.toContain("下班后工作闭环（按需）");

        clickButton("下班后");
        await vi.waitFor(() => expect(document.body.textContent).toContain("下班后工作闭环（按需）"));
        expect(document.querySelector(".xz-daily-project-picker")).not.toBeNull();
        expect(document.body.textContent).toContain("今晚个人事务补充说明（可选）");
        expect(document.querySelector('[aria-label="个人项目实际时长小时"]')).not.toBeNull();
        expect([...document.querySelectorAll("label")].some((label) => label.textContent?.includes("完成训练"))).toBe(false);
    });

    it("先确认训练完成状态，仅在已完成时填写训练内容", async () => {
        let store = createEmptyDailyStore(1000);
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());

        const completion = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("完成训练"))
            ?.querySelector("select") as HTMLSelectElement | undefined;
        if (!completion) throw new Error("没有找到完成训练选择框");
        expect(document.body.textContent).not.toContain("今天的训练内容");

        completion.value = "yes";
        completion.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        const plan = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("今天的训练内容"))
            ?.querySelector("textarea") as HTMLTextAreaElement | undefined;
        if (!plan) throw new Error("没有在已完成状态下显示训练内容");
        plan.value = "晨跑 30 分钟";
        plan.dispatchEvent(new Event("input", { bubbles: true }));

        completion.value = "no";
        completion.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.body.textContent).not.toContain("今天的训练内容");
        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledOnce(), { timeout: 2000 });
        expect(saveDaily.mock.calls[0][0].fields).toMatchObject({ trainingCompleted: "no", trainingPlan: "" });
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
        await vi.waitFor(() => expect(document.body.textContent).toContain("工作时间边界"));
        choose("实际下班时间小时", "16");
        choose("实际下班时间分钟", "49");
        await tick();

        expect(document.body.textContent).toContain("超出计划 4 分钟");
        expect(document.body.textContent).toContain("等待自动保存");
        expect(document.body.textContent).not.toContain("保存今日记录");
        await vi.waitFor(() => expect(saveDaily.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
        expect(saveDaily.mock.calls.at(-1)?.[0].fields).toMatchObject({
            lightsOffTime: "22:07", sleepDurationMinutes: 346, plannedWorkEndTime: "16:45", actualWorkEndTime: "16:49",
        });
        expect(document.body.textContent).toContain("已自动保存并复核");
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
        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledOnce(), { timeout: 2000 });
        expect(saveDaily.mock.calls[0][0].fields.keyWorkResult).toBe("met");
    });

    it("按是否需要工作闭环切换字段，并把不需要保存为明确状态", async () => {
        let store = createEmptyDailyStore(1000);
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await tick();
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());
        clickButton("下班后");
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

        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledOnce(), { timeout: 2000 });
        expect(saveDaily.mock.calls[0][0].fields.closureNeed).toBe("not-needed");
        expect(store.records[0].fields.closurePlannedMinutes).toBeNull();
    });

    it("连续输入会合并为一次自动保存", async () => {
        let store = createEmptyDailyStore(1000);
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await tick();
        await vi.waitFor(() => expect(document.querySelector("textarea")).not.toBeNull());

        const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
        textarea.value = "第一次输入";
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.value = "最终输入";
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();

        expect(document.body.textContent).toContain("等待自动保存");
        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledOnce(), { timeout: 2000 });
        expect(saveDaily.mock.calls[0][0].fields.importantWorkPlan).toBe("最终输入");
    });

    it("自动保存进行中继续输入时不会被旧结果覆盖", async () => {
        let store = createEmptyDailyStore(1000);
        const pending: Array<() => void> = [];
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn((record: DailyRecord) => new Promise<ReturnType<typeof upsertDailyRecord>>((resolve) => {
            pending.push(() => {
                store = upsertDailyRecord(store, record, 2000 + pending.length);
                resolve(store);
            });
        }));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await tick();
        await vi.waitFor(() => expect(document.querySelector("textarea")).not.toBeNull());

        const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
        textarea.value = "保存中的旧内容";
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledOnce(), { timeout: 2000 });

        textarea.value = "保存期间输入的新内容";
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        pending[0]();
        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledTimes(2));
        expect(saveDaily.mock.calls[1][0].fields.importantWorkPlan).toBe("保存期间输入的新内容");
        pending[1]();
        await vi.waitFor(() => expect(document.body.textContent).toContain("已自动保存并复核"));
        expect(store.records[0].fields.importantWorkPlan).toBe("保存期间输入的新内容");
    });

    it("从进行中事务补充今日执行切片，保存快照并跳回对应工作项", async () => {
        const items = sampleWorkItems();
        let workData = sampleWorkItemData(items);
        let dailyStore = createEmptyDailyStore(1000);
        const properties = {
            ...props(),
            load: vi.fn(async () => workData),
            saveItem: vi.fn(async (data: WorkItemData, item: WorkItem, changes: { executionSlices?: WorkItem["executionSlices"] }) => {
                workData = { ...data, items: data.items.map((candidate) => candidate.id === item.id ? { ...candidate, executionSlices: changes.executionSlices ?? candidate.executionSlices } : candidate) };
                return workData;
            }),
            loadDaily: vi.fn().mockResolvedValue(dailyStore),
            saveDaily: vi.fn(async (record: DailyRecord) => dailyStore = upsertDailyRecord(dailyStore, record, 2000)),
        };
        component = new AppShell({ target: document.body, props: properties });
        await vi.waitFor(() => expect(document.querySelector(".xz-main-nav")).not.toBeNull());

        clickButton("生活节律");
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());
        clickButton("下班后");
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-project-picker")).not.toBeNull());
        clickButton("添加今日执行切片");
        await vi.waitFor(() => expect(document.querySelector('[aria-label="搜索可用执行切片"]')).not.toBeNull());

        const choices = [...document.querySelectorAll<HTMLButtonElement>(".xz-daily-project-picker__groups section > button")];
        expect(document.querySelector(".xz-daily-project-picker__groups")?.textContent).not.toContain("已经结束的项目");
        const actionChoice = choices.find((button) => button.textContent?.includes("整理发布说明"));
        if (!actionChoice) throw new Error("没有找到可关联的个人行动");
        actionChoice.click();
        await vi.waitFor(() => expect(properties.saveItem).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-project-links")).not.toBeNull());

        expect(document.querySelector(".xz-daily-project-links")?.textContent).toContain("完善行舟");
        expect(properties.saveItem.mock.calls[0][2].executionSlices?.[0]).toMatchObject({ status: "scheduled" });

        const linked = document.querySelector(".xz-daily-project-link__main") as HTMLButtonElement;
        linked.click();
        await vi.waitFor(() => expect(document.querySelector(".xz-main-nav")).not.toBeNull());
        await tick();
        await vi.waitFor(() => expect(properties.load.mock.calls.length).toBeGreaterThanOrEqual(3), { timeout: 3000 });
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="action-1"]'), document.body.textContent ?? "").not.toBeNull(), { timeout: 3000 });
        expect(document.querySelector('[data-work-item-id="action-1"] > .xz-tree-row')?.classList.contains("selected")).toBe(true);

        expect(properties.saveDaily).toHaveBeenCalledOnce();
        expect(dailyStore.records[0].fields.personalProjectLinks).toEqual([{
            workItemId: "action-1",
            titleSnapshot: "整理发布说明",
            pathSnapshot: "完善行舟",
            typeSnapshot: "事务",
        }]);
    });

    function props() {
        let dailyStore = createEmptyDailyStore(1000);
        return {
            load: vi.fn(() => new Promise<never>(() => undefined)),
            captureInbox: vi.fn(), saveItem: vi.fn(), deleteItem: vi.fn(), openItemMenu: vi.fn(),
            openCaptureDialog: vi.fn(), openDocument: vi.fn(),
            loadDaily: vi.fn().mockResolvedValue(dailyStore),
            saveDaily: vi.fn(async (record: DailyRecord) => dailyStore = upsertDailyRecord(dailyStore, record, 2000)),
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

    function sampleWorkItems(): WorkItem[] {
        const base: WorkItem = {
            id: "domain-1", rowId: "domain-1", title: "个人系统", documentId: null, detached: true,
            type: "长期领域", status: "持续维持", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            hardPrerequisiteIds: [], softPrerequisiteIds: [], completedDates: [], planDate: null, deadline: null,
            noDeadline: true, durationMinutes: null, energy: "", updatedAt: 1000, sortOrder: null,
        };
        return [
            base,
            { ...base, id: "project-1", rowId: "project-1", title: "完善行舟", type: "项目", status: "进行中", parentIds: [base.id], noDeadline: false },
            { ...base, id: "action-1", rowId: "action-1", title: "整理发布说明", type: "事务", status: "进行中", parentIds: ["project-1"], topProjectIds: ["project-1"], noDeadline: false, deadline: Date.now() + 7 * 24 * 60 * 60 * 1000, durationMinutes: 30, sliceTargetCount: 2, executionSlices: [] },
            { ...base, id: "closed-1", rowId: "closed-1", title: "已经结束的项目", type: "项目", status: "已完成", parentIds: [base.id] },
        ];
    }

    function sampleWorkItemData(items: WorkItem[]): WorkItemData {
        return { attributeViewId: "internal", attributeViewName: "行舟内部数据", viewId: "internal", items, missingFields: [], fields: {} };
    }
});
