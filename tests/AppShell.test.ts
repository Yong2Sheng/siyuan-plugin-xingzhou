import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppShell from "../src/AppShell.svelte";
import DailyRhythm from "../src/DailyRhythm.svelte";
import { createDailyRecord, createEmptyDailyStore, upsertDailyRecord, type DailyRecord } from "../src/daily-records";
import type { WorkItem, WorkItemData, WorkItemViewState } from "../src/work-items";

function researchDailyStore() {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return upsertDailyRecord(createEmptyDailyStore(1000), { ...createDailyRecord(date), dayType: "research-workday" }, 1000);
}

describe("行舟一级模块外壳", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("把项目与事务和生活节律放在不同一级模块", async () => {
        const properties = props();
        component = new AppShell({ target: document.body, props: properties });
        expect(document.querySelector(".xz-shell-header .xz-module-nav")?.textContent).toContain("项目与事务");
        expect(document.querySelector(".xz-module-nav")?.textContent).toContain("生活节律");
        expect(document.querySelector(".xz-app > .xz-header")).toBeNull();
        expect(document.querySelector(".xz-shell-actions")?.textContent).not.toContain("添加");
        expect(document.querySelector(".xz-global-capture-button")).toBeNull();
        expect(document.querySelector(".xz-main-nav")?.textContent).toContain("本周");

        clickButton("生活节律");
        await tick();

        const dailyViewLabels = [...document.querySelectorAll(".xz-daily-view-nav button")].map((button) => button.textContent?.trim());
        expect(dailyViewLabels.slice(0, 2)).toEqual(["每日 Checklist", "今日记录"]);
        expect(document.querySelector(".xz-daily-view-nav")?.textContent).toContain("时间线");
        expect(document.querySelector(".xz-daily-view-nav")?.textContent).toContain("营养摄入");
        expect(document.querySelector(".xz-main-nav")).toBeNull();

        clickButton("营养摄入");
        await vi.waitFor(() => expect(document.querySelector(".xz-nutrition-page")).not.toBeNull());
        expect(document.body.textContent).toContain("不区分餐次，吃了就记");
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

    it("打开时恢复上次保存的视图状态（选中事务与展开）", async () => {
        const workData = sampleWorkItemData(sampleWorkItems());
        const properties = {
            ...props(),
            load: vi.fn().mockResolvedValue(workData),
            loadProjectViewState: vi.fn().mockResolvedValue({
                page: "all",
                filter: "all",
                includeClosed: false,
                scope: "all",
                selectedId: "action-1",
                expandedIds: ["domain-1", "project-1"],
                weekStart: Date.now(),
                sidebarScrollTop: 0,
                treeScrollTop: 0,
                detailScrollTop: 0,
            }),
            saveProjectViewState: vi.fn().mockResolvedValue(undefined),
        };
        component = new AppShell({ target: document.body, props: properties });
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="action-1"] > .xz-tree-row')?.classList.contains("selected")).toBe(true));
        expect(document.querySelector('[data-work-item-id="project-1"]')).not.toBeNull();

        clickButton("生活节律");
        await vi.waitFor(() => expect(properties.saveProjectViewState).toHaveBeenCalled());
    });

    it("上次选中的事务已完成时，回落到当前可见事务", async () => {
        const workData = sampleWorkItemData(sampleWorkItems());
        const properties = {
            ...props(),
            load: vi.fn().mockResolvedValue(workData),
            loadProjectViewState: vi.fn().mockResolvedValue({
                page: "all",
                filter: "all",
                includeClosed: false,
                scope: "all",
                selectedId: "closed-1",
                expandedIds: ["domain-1", "project-1"],
                weekStart: Date.now(),
                sidebarScrollTop: 0,
                treeScrollTop: 0,
                detailScrollTop: 0,
            }),
            saveProjectViewState: vi.fn().mockResolvedValue(undefined),
        };
        component = new AppShell({ target: document.body, props: properties });
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="action-1"] > .xz-tree-row')?.classList.contains("selected")).toBe(true));
        expect(document.querySelector('[data-work-item-id="closed-1"] > .xz-tree-row')?.classList.contains("selected") ?? false).toBe(false);
    });

    it("无历史状态的新会话也会保存视图状态（供下次打开恢复）", async () => {
        const workData = sampleWorkItemData(sampleWorkItems());
        const saveProjectViewState = vi.fn().mockResolvedValue(undefined);
        const properties = {
            ...props(),
            load: vi.fn().mockResolvedValue(workData),
            loadProjectViewState: vi.fn().mockResolvedValue(null),
            saveProjectViewState,
        };
        component = new AppShell({ target: document.body, props: properties });
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="action-1"] > .xz-tree-row')).not.toBeNull());

        (document.querySelector('[data-work-item-id="action-1"] .xz-tree-main') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(saveProjectViewState.mock.calls.map((call) => call[0]?.selectedId)).toContain("action-1"));
    });

    it("点选事务后立即销毁（关闭页签），重开恢复到刚选中的事务", async () => {
        const workData = sampleWorkItemData(sampleWorkItems());
        let saved: WorkItemViewState | null = null;
        const loadProjectViewState = vi.fn(async () => saved);
        const saveProjectViewState = vi.fn(async (state: WorkItemViewState) => {
            saved = state;
        });
        const makeProps = () => ({
            ...props(),
            load: vi.fn().mockResolvedValue(workData),
            loadProjectViewState,
            saveProjectViewState,
        });

        component = new AppShell({ target: document.body, props: makeProps() });
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="action-1"] > .xz-tree-row')).not.toBeNull());
        (document.querySelector('[data-work-item-id="action-1"] .xz-tree-main') as HTMLButtonElement).click();
        component.$destroy();
        await vi.waitFor(() => expect(saved?.selectedId).toBe("action-1"));

        document.body.replaceChildren();
        component = new AppShell({ target: document.body, props: makeProps() });
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="action-1"] > .xz-tree-row')?.classList.contains("selected")).toBe(true));
    });

    it("组件销毁时立即保存当前视图状态（关闭页签路径）", async () => {
        const workData = sampleWorkItemData(sampleWorkItems());
        const saveProjectViewState = vi.fn().mockResolvedValue(undefined);
        const properties = {
            ...props(),
            load: vi.fn().mockResolvedValue(workData),
            loadProjectViewState: vi.fn().mockResolvedValue(null),
            saveProjectViewState,
        };
        component = new AppShell({ target: document.body, props: properties });
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="action-1"] > .xz-tree-row')).not.toBeNull());

        (document.querySelector('[data-work-item-id="action-1"] .xz-tree-main') as HTMLButtonElement).click();
        component.$destroy();
        expect(saveProjectViewState.mock.calls.map((call) => call[0]?.selectedId)).toContain("action-1");
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

    it("早晨展示前晚记录的明天第一个动作（只读提示）", async () => {
        const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const now = new Date();
        const todayKey = key(now);
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);

        let store = createEmptyDailyStore(100);
        const previous = createDailyRecord(key(yesterday));
        previous.fields.tomorrowFirstAction = "先看实验记录，再开始写讨论";
        store = upsertDailyRecord(store, previous, 100);
        store = upsertDailyRecord(store, createDailyRecord(todayKey), 100);

        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-context select")).not.toBeNull());

        expect(document.querySelector(".xz-daily-yesterday-hint")?.textContent ?? "").toContain("昨晚记录");
        expect(document.body.textContent).toContain("先看实验记录，再开始写讨论");
    });

    it("开会日使用会议边界、条件个人事务、专属 Checklist，并停止营养录入", async () => {
        let store = researchDailyStore();
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-context select")).not.toBeNull());

        const type = document.querySelector(".xz-daily-context select") as HTMLSelectElement;
        type.value = "conference-day";
        type.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.body.textContent).toContain("会议开始时间");
        expect(document.body.textContent).toContain("预计会议结束时间（可选）");
        expect(document.body.textContent).toContain("今天最重要的会议／工作内容");

        clickButton("会后");
        await vi.waitFor(() => expect(document.body.textContent).toContain("会后是否安排个人事务"));
        expect(document.querySelector(".xz-daily-project-picker")).toBeNull();
        const decision = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("会后是否安排个人事务"))
            ?.querySelector("select") as HTMLSelectElement;
        decision.value = "yes";
        decision.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.querySelector(".xz-daily-project-picker")).not.toBeNull();

        clickButton("每日 Checklist");
        await vi.waitFor(() => expect(document.body.textContent).toContain("开会日 · 会议开始至结束不预设自由时间"));
        expect(document.body.textContent).toContain("会议与交流优先");

        clickButton("营养摄入");
        await vi.waitFor(() => expect(document.body.textContent).toContain("开会日不记录营养摄入"));
        expect(document.querySelector(".xz-nutrition-page")).toBeNull();
    });

    it("周六使用上午复盘、中午下班和自由时间的独立动线", async () => {
        const properties = props();
        component = new DailyRhythm({ target: document.body, props: { loadDaily: properties.loadDaily, saveDaily: properties.saveDaily } });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-context select")).not.toBeNull());

        const select = document.querySelector(".xz-daily-context select") as HTMLSelectElement;
        select.value = "saturday-reset";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();

        const stages = [...document.querySelectorAll(".xz-daily-stage-nav button")].map((button) => button.textContent?.trim());
        expect(stages).toEqual(["早晨", "上午复盘", "中午下班", "自由时间", "21:00", "全部"]);
        expect(document.querySelector(".xz-daily-progress")?.textContent).toContain("上午轻量复盘");
        expect(document.body.textContent).not.toContain("今天最重要的工作内容");

        clickButton("上午复盘");
        await vi.waitFor(() => expect(document.body.textContent).toContain("今天是否进行上午轻量复盘"));
        expect(document.body.textContent).not.toContain("计划结束时间（中午前）");
        const reviewDecision = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("今天是否进行上午轻量复盘"))
            ?.querySelector("select") as HTMLSelectElement | undefined;
        if (!reviewDecision) throw new Error("没有找到周六轻量复盘判断选择框");
        reviewDecision.value = "no";
        reviewDecision.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.body.textContent).toContain("中午下班记录均按“不适用”保存");

        clickButton("中午下班");
        await vi.waitFor(() => expect(document.body.textContent).toContain("今天未进行轻量复盘，无需填写中午下班时间和工作结果"));

        clickButton("上午复盘");
        await vi.waitFor(() => expect(document.body.textContent).toContain("今天是否进行上午轻量复盘"));
        const changedDecision = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("今天是否进行上午轻量复盘"))
            ?.querySelector("select") as HTMLSelectElement;
        changedDecision.value = "yes";
        changedDecision.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.body.textContent).toContain("计划结束时间（中午前）");
        expect(document.body.textContent).not.toContain("午饭后专业学习安排");

        clickButton("中午下班");
        await vi.waitFor(() => expect(document.body.textContent).toContain("中午工作边界"));

        clickButton("自由时间");
        await vi.waitFor(() => expect(document.body.textContent).toContain("自由时间与个人安排"));
        expect(document.body.textContent).not.toContain("下班后工作闭环（按需）");

        clickButton("21:00");
        await vi.waitFor(() => expect(document.body.textContent).toContain("中午下班后是否接触了工作"));
        expect(document.body.textContent).not.toContain("明天开始工作时的第一个动作");
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
        expect([...document.querySelectorAll("label")].some((label) => label.textContent?.includes("今晚是否有个人事务补充说明"))).toBe(true);
        expect(document.querySelector('[aria-label="个人项目实际时长小时"]')).not.toBeNull();
        expect([...document.querySelectorAll("label")].some((label) => label.textContent?.includes("完成训练"))).toBe(false);
    });

    it("个人事务补充说明先判断是／否，选“否”收起输入框但改回“是”能恢复文字", async () => {
        let store = researchDailyStore();
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());
        clickButton("下班后");
        await vi.waitFor(() => expect(document.body.textContent).toContain("下班后个人安排"));

        const decision = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("今晚是否有个人事务补充说明"))
            ?.querySelector("select") as HTMLSelectElement | undefined;
        if (!decision) throw new Error("没有找到个人事务补充说明判断选择框");
        const noteTextarea = () => [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("今晚个人事务补充说明"))
            ?.querySelector("textarea") as HTMLTextAreaElement | undefined;
        expect(noteTextarea()).toBeUndefined();
        expect(decision.closest(".xz-daily-personal-decision")?.nextElementSibling?.classList.contains("xz-daily-project-picker")).toBe(true);

        decision.value = "yes";
        decision.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        const note = noteTextarea();
        if (!note) throw new Error("选择是后没有显示补充说明输入框");
        note.value = "先散步 30 分钟，再整理家庭账目。";
        note.dispatchEvent(new Event("input", { bubbles: true }));

        decision.value = "no";
        decision.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(noteTextarea()).toBeUndefined();
        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledTimes(1), { timeout: 2000 });
        expect(saveDaily.mock.calls[0][0].fields).toMatchObject({
            hasPersonalProjectNote: "no",
            personalProjectPlan: "",
            personalProjectNoteDraft: "先散步 30 分钟，再整理家庭账目。",
        });

        decision.value = "yes";
        decision.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(noteTextarea()?.value).toBe("先散步 30 分钟，再整理家庭账目。");
        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledTimes(2), { timeout: 2000 });
        expect(saveDaily.mock.calls[1][0].fields).toMatchObject({
            hasPersonalProjectNote: "yes",
            personalProjectPlan: "先散步 30 分钟，再整理家庭账目。",
            personalProjectNoteDraft: "",
        });
    });

    it("先确认午饭后是否安排专业学习，再按需显示输入框", async () => {
        const properties = props();
        component = new DailyRhythm({ target: document.body, props: { loadDaily: properties.loadDaily, saveDaily: properties.saveDaily } });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());

        clickButton("午饭后");
        await vi.waitFor(() => expect(document.body.textContent).toContain("午饭后是否安排专业学习"));
        expect(document.body.textContent).not.toContain("书目／材料");

        const decision = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("午饭后是否安排专业学习"))
            ?.querySelector("select") as HTMLSelectElement;
        decision.value = "yes";
        decision.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.body.textContent).toContain("书目／材料");
        expect(document.body.textContent).toContain("完成时长与页码／停点");

        decision.value = "no";
        decision.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.body.textContent).not.toContain("书目／材料");
        expect(document.body.textContent).toContain("无需填写学习内容");
    });

    it("显示各阶段完整度，并可从待补清单跳到对应阶段", async () => {
        const properties = props();
        component = new DailyRhythm({ target: document.body, props: { loadDaily: properties.loadDaily, saveDaily: properties.saveDaily } });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());

        expect(document.querySelector<HTMLButtonElement>('.xz-daily-stage-nav button[aria-label^="早晨，"]')?.getAttribute("aria-label")).toContain("未开始");
        expect(document.querySelector(".xz-daily-stage-legend")?.textContent).toContain("○未开始");
        expect(document.querySelector(".xz-daily-stage-legend")?.textContent).toContain("数字表示待补项");
        expect(document.querySelector(".xz-daily-stage-legend")?.textContent).toContain("✓已完成");
        clickButton("检查待补");
        await tick();
        expect(document.querySelector(".xz-daily-missing-panel")?.textContent).toContain("只检查关键字段");

        const studyMissing = [...document.querySelectorAll<HTMLButtonElement>(".xz-daily-missing-panel > div > button")]
            .find((button) => button.textContent?.includes("是否安排专业学习"));
        if (!studyMissing) throw new Error("没有找到专业学习待补项目");
        studyMissing.click();
        await vi.waitFor(() => expect(document.body.textContent).toContain("午饭后专业学习安排"));
        expect(document.activeElement?.closest("label")?.textContent).toContain("午饭后是否安排专业学习");
        expect(document.querySelector(".xz-daily-missing-panel")).toBeNull();
    });

    it("切换日期时同步刷新阶段徽标和无障碍状态", async () => {
        const completedDate = "2030-01-07";
        const blankDate = "2030-01-08";
        const completedLearning = createDailyRecord(completedDate, "research-workday", 1000);
        completedLearning.fields.professionalStudyPlanned = "no";
        let store = upsertDailyRecord(createEmptyDailyStore(1000), completedLearning, 1000);
        store = upsertDailyRecord(store, createDailyRecord(blankDate, "research-workday", 1000), 1000);
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('input[aria-label="记录日期"]')).not.toBeNull());

        const openDate = async (date: string) => {
            const input = document.querySelector<HTMLInputElement>('input[aria-label="记录日期"]');
            if (!input) throw new Error("没有找到记录日期输入框");
            input.value = date;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            await vi.waitFor(() => expect(input.value).toBe(date));
        };
        const learningButton = () => document.querySelector<HTMLButtonElement>('.xz-daily-stage-nav button[aria-label^="午饭后，"]');

        await openDate(completedDate);
        await vi.waitFor(() => expect(learningButton()?.getAttribute("aria-label")).toBe("午饭后，已完成"));
        expect(learningButton()?.dataset.completion).toBe("✓");

        await openDate(blankDate);
        await vi.waitFor(() => expect(learningButton()?.getAttribute("aria-label")).toBe("午饭后，未开始"));
        expect(learningButton()?.dataset.completion).toBe("○");

        await openDate(completedDate);
        await vi.waitFor(() => expect(learningButton()?.dataset.completion).toBe("✓"));
    });

    it("先确认训练完成状态，仅在已完成时填写训练内容", async () => {
        let store = researchDailyStore();
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());

        const completion = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("完成训练"))
            ?.querySelector("select") as HTMLSelectElement | undefined;
        if (!completion) throw new Error("没有找到完成训练选择框");
        expect(completion.closest(".xz-daily-flow-column")).not.toBeNull();
        expect(document.body.textContent).not.toContain("今天的训练内容");

        completion.value = "yes";
        completion.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        const plan = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("今天的训练内容"))
            ?.querySelector("textarea") as HTMLTextAreaElement | undefined;
        if (!plan) throw new Error("没有在已完成状态下显示训练内容");
        expect(plan.closest(".xz-daily-decision-column")?.contains(completion)).toBe(true);
        plan.value = "晨跑 30 分钟";
        plan.dispatchEvent(new Event("input", { bubbles: true }));

        completion.value = "no";
        completion.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.body.textContent).not.toContain("今天的训练内容");
        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledOnce(), { timeout: 2000 });
        expect(saveDaily.mock.calls[0][0].fields).toMatchObject({ trainingCompleted: "no", trainingPlan: "" });
    });

    it("先确认是否有手表评分和体重测量，再按需显示数值输入", async () => {
        let store = researchDailyStore();
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());

        const watchDecision = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("今天是否有手表睡眠评分"))
            ?.querySelector("select") as HTMLSelectElement;
        const weightDecision = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("今天是否测量晨起体重"))
            ?.querySelector("select") as HTMLSelectElement;
        expect(document.body.textContent).not.toContain("今天没有手表评分，无需填写");
        expect([...document.querySelectorAll("label")].some((label) => label.textContent?.trim().startsWith("晨起体重"))).toBe(false);

        watchDecision.value = "no";
        watchDecision.dispatchEvent(new Event("change", { bubbles: true }));
        weightDecision.value = "no";
        weightDecision.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.body.textContent).toContain("今天没有手表评分，无需填写");
        expect(document.body.textContent).toContain("今天没有测量条件，无需填写");

        watchDecision.value = "yes";
        watchDecision.dispatchEvent(new Event("change", { bubbles: true }));
        weightDecision.value = "yes";
        weightDecision.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect([...document.querySelectorAll("label")].some((label) => label.textContent?.trim().startsWith("手表睡眠评分"))).toBe(true);
        expect([...document.querySelectorAll("label")].some((label) => label.textContent?.trim().startsWith("晨起体重"))).toBe(true);
    });

    it("先确认是否有临时调整，仅在选择是时显示说明输入框", async () => {
        let store = researchDailyStore();
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());

        const decision = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("今日是否有节奏或临时调整"))
            ?.querySelector("select") as HTMLSelectElement | undefined;
        if (!decision) throw new Error("没有找到临时调整判断选择框");
        const workStartColumn = document.querySelector('[aria-label="上班时间小时"]')?.closest(".xz-daily-flow-column");
        const plannedEndColumn = document.querySelector('[aria-label="计划下班时间小时"]')?.closest(".xz-daily-flow-column");
        expect(plannedEndColumn).toBe(workStartColumn);
        const timePair = document.querySelector('[aria-label="上班时间小时"]')?.closest(".xz-daily-time-pair");
        expect(timePair).not.toBeNull();
        expect(timePair?.contains(document.querySelector('[aria-label="计划下班时间小时"]'))).toBe(true);
        expect(decision.closest(".xz-daily-flow-column")).not.toBe(workStartColumn);
        expect(document.body.textContent).not.toContain("调整内容");

        decision.value = "yes";
        decision.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.body.textContent).toContain("调整内容");

        decision.value = "no";
        decision.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.body.textContent).not.toContain("调整内容");
        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledOnce(), { timeout: 2000 });
        expect(saveDaily.mock.calls[0][0].fields).toMatchObject({ hasDayAdjustments: "no", dayAdjustments: "" });
    });

    it("把小时和分钟组合保存，并自动判断下班是否超时", async () => {
        let store = researchDailyStore();
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

    it("只标记 12 点后熬夜也能保存，填了时间就按时间判定，清空后回到标记状态", async () => {
        let store = researchDailyStore();
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await tick();
        await vi.waitFor(() => expect(document.querySelector('[aria-label="昨晚熄灯时段"]')).not.toBeNull());

        // 选「12 点后（熬夜）」：时间行收起为静态标记，不需要分钟也能算填好
        choose("昨晚熄灯时段", "after-midnight");
        await tick();
        expect(document.querySelector(".xz-daily-lights-off-skip")?.textContent).toContain("不记具体时间");
        expect(document.querySelector('[aria-label="昨晚熄灯小时"]')).toBeNull();
        // 落盘以 upsert 后的记录为准：时段在保存时重新推导
        await vi.waitFor(() => expect(store.records[0].fields).toMatchObject({
            lightsOffTime: "", lightsOffAt: "", lightsOffBand: "after-midnight",
        }), { timeout: 2000 });

        // 展开并填具体时间：时段改由时间判定，同时出现「清空」
        clickButton("填时间");
        await tick();
        choose("昨晚熄灯小时", "00");
        choose("昨晚熄灯分钟", "30");
        await tick();
        expect((document.querySelector('[aria-label="昨晚熄灯时段"]') as HTMLSelectElement).value).toBe("after-midnight");
        expect(document.querySelector(".xz-daily-time-clear")).not.toBeNull();
        await vi.waitFor(() => expect(store.records[0].fields).toMatchObject({
            lightsOffTime: "00:30", lightsOffBand: "after-midnight",
        }), { timeout: 2000 });
        expect(store.records[0].fields.lightsOffAt).toMatch(/T00:30$/);

        // 只有自己点「清空」才会清掉时间，时段标记保持不变
        clickButton("清空");
        await tick();
        expect(document.querySelector(".xz-daily-lights-off-skip")?.textContent).toContain("不记具体时间");
        await vi.waitFor(() => expect(store.records[0].fields).toMatchObject({
            lightsOffTime: "", lightsOffAt: "", lightsOffBand: "after-midnight",
        }), { timeout: 2000 });
    });

    it("填了时间以后时段由时间决定，下拉里冲突的选项置灰", async () => {
        let store = researchDailyStore();
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await tick();
        await vi.waitFor(() => expect(document.querySelector('[aria-label="昨晚熄灯小时"]')).not.toBeNull());

        choose("昨晚熄灯小时", "00");
        choose("昨晚熄灯分钟", "30");
        await tick();

        const select = document.querySelector('[aria-label="昨晚熄灯时段"]') as HTMLSelectElement;
        const optionStates = [...select.options].map((option) => ({ value: option.value, disabled: option.disabled }));
        expect(select.value).toBe("after-midnight");
        expect(optionStates).toEqual([
            { value: "", disabled: true },
            { value: "before-midnight", disabled: true },
            { value: "after-midnight", disabled: false },
        ]);
        await vi.waitFor(() => expect(store.records[0].fields).toMatchObject({ lightsOffTime: "00:30", lightsOffBand: "after-midnight" }), { timeout: 2000 });
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
        let store = researchDailyStore();
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
        let store = researchDailyStore();
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

    it("工作闭环先确认是否有下一步，有时才显示下一步输入框", async () => {
        let store = researchDailyStore();
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());
        clickButton("下班后");
        await tick();

        const closureNeed = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("本次是否需要工作闭环"))
            ?.querySelector("select") as HTMLSelectElement | undefined;
        if (!closureNeed) throw new Error("没有找到工作闭环选择框");
        closureNeed.value = "needed";
        closureNeed.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();

        const hasNextStep = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("是否有下一步安排"))
            ?.querySelector("select") as HTMLSelectElement | undefined;
        if (!hasNextStep) throw new Error("没有找到下一步判断选择框");
        expect(document.body.textContent).not.toContain("下一步内容");

        hasNextStep.value = "yes";
        hasNextStep.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        const nextStep = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("下一步内容"))
            ?.querySelector("textarea") as HTMLTextAreaElement | undefined;
        if (!nextStep) throw new Error("选择有后没有显示下一步输入框");
        nextStep.value = "明天整理图注";
        nextStep.dispatchEvent(new Event("input", { bubbles: true }));

        hasNextStep.value = "no";
        hasNextStep.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.body.textContent).not.toContain("下一步内容");
        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledOnce(), { timeout: 2000 });
        expect(saveDaily.mock.calls[0][0].fields).toMatchObject({ closureHasNextStep: "no", closureNextStep: "" });
    });

    it("先判断下班后工作和异常观察，再按需显示说明字段", async () => {
        let store = researchDailyStore();
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());
        clickButton("21:00");
        await tick();

        const afterHours = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("下班后是否处理了工作"))
            ?.querySelector("select") as HTMLSelectElement | undefined;
        const anomaly = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("是否有其他异常或观察需要记录"))
            ?.querySelector("select") as HTMLSelectElement | undefined;
        if (!afterHours || !anomaly) throw new Error("没有找到条件判断选择框");
        expect(document.body.textContent).not.toContain("处理工作的原因");
        expect(document.body.textContent).not.toContain("异常或观察内容");

        afterHours.value = "yes";
        afterHours.dispatchEvent(new Event("change", { bubbles: true }));
        anomaly.value = "no";
        anomaly.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        const reason = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("处理工作的原因"))
            ?.querySelector("textarea") as HTMLTextAreaElement | undefined;
        if (!reason) throw new Error("选择是后没有显示原因输入框");
        expect(document.body.textContent).not.toContain("异常或观察内容");
        reason.value = "服务器任务需要在晚间确认";
        reason.dispatchEvent(new Event("input", { bubbles: true }));

        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledOnce(), { timeout: 2000 });
        expect(saveDaily.mock.calls[0][0].fields).toMatchObject({
            afterHoursWorkOccurred: "yes",
            afterHoursWorkReason: "服务器任务需要在晚间确认",
            hasAnomalyOrObservation: "no",
            anomalyOrObservation: "",
        });
    });

    it("睡前可选择自由安排，也可明确设置次日熄灯计划", async () => {
        let store = researchDailyStore();
        const loadDaily = vi.fn().mockResolvedValue(store);
        const saveDaily = vi.fn(async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000));
        component = new DailyRhythm({ target: document.body, props: { loadDaily, saveDaily } });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());
        clickButton("21:00");
        await tick();

        const bedtime = [...document.querySelectorAll("label")]
            .find((label) => label.textContent?.includes("今晚的睡前安排"))
            ?.querySelector("select") as HTMLSelectElement | undefined;
        if (!bedtime) throw new Error("没有找到睡前安排选择框");
        bedtime.value = "free";
        bedtime.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(document.body.textContent).toContain("今晚自由安排");
        expect(document.querySelector('[aria-label="计划熄灯时间小时"]')).toBeNull();

        bedtime.value = "yes";
        bedtime.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        const day = document.querySelector('[aria-label="计划熄灯日期"]') as HTMLSelectElement | null;
        if (!day) throw new Error("没有找到计划熄灯日期选择框");
        day.value = "next-day";
        day.dispatchEvent(new Event("change", { bubbles: true }));
        choose("计划熄灯时间小时", "00");
        choose("计划熄灯时间分钟", "45");

        await vi.waitFor(() => expect(saveDaily).toHaveBeenCalledOnce(), { timeout: 2000 });
        expect(saveDaily.mock.calls[0][0].fields).toMatchObject({
            bedtimePreparation: "yes",
            plannedLightsOffDay: "next-day",
            plannedLightsOffTime: "00:45",
        });
        expect(store.records[0].fields.plannedLightsOffAt.slice(11)).toBe("00:45");
    });

    it("连续输入会合并为一次自动保存", async () => {
        let store = researchDailyStore();
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
        let store = researchDailyStore();
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
        let dailyStore = researchDailyStore();
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
        let dailyStore = researchDailyStore();
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
