import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExecutionSlicePlanner from "../src/ExecutionSlicePlanner.svelte";
import type { WorkItem } from "../src/work-items";

describe("执行切片配置", () => {
    let component: ExecutionSlicePlanner | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("数字输入框会把目标切片数作为数值保存", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: transaction(), save } });
        await tick();

        const input = document.querySelector('[aria-label="目标切片数"]') as HTMLInputElement;
        input.value = "2";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));

        await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ sliceTargetCount: 2 }));
    });

    it("没有截止日期时仍允许点击日历安排切片", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        component = new ExecutionSlicePlanner({
            target: document.body,
            props: { item: transaction({ deadline: null, noDeadline: true, sliceTargetCount: 1 }), save },
        });
        await tick();

        const today = document.querySelector<HTMLButtonElement>(".xz-slice-day.today");
        if (!today) throw new Error("没有找到今天的日历格");
        expect(today.disabled).toBe(false);
        expect(document.body.textContent).toContain("未设置截止日期，可从今天起自由安排");
        today.click();
        await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
        expect(save.mock.calls[0][0].executionSlices).toHaveLength(1);
    });

    it("显示所有事务在同一天的切片数量和预计时间", async () => {
        const date = new Date();
        date.setHours(12, 0, 0, 0);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const current = transaction({
            sliceTargetCount: 1,
            executionSlices: [{ id: "current", scheduledDate: key, status: "scheduled", completedAt: null, updatedAt: 1 }],
        });
        const another = transaction({
            id: "another",
            rowId: "another",
            durationMinutes: 35,
            executionSlices: [{ id: "another-slice", scheduledDate: key, status: "completed", completedAt: 2, updatedAt: 2 }],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: current, items: [current, another] } });
        await tick();

        const today = document.querySelector<HTMLButtonElement>(".xz-slice-day.today");
        expect(loadParts(today, ".xz-slice-day-remaining")).toMatchObject({ prefix: "待做", value: "20", unit: "分" });
        expect(loadParts(today, ".xz-slice-day-total")).toMatchObject({ prefix: "共", value: "55", unit: "分", count: "· 2 片" });
        expect(today?.getAttribute("aria-label")).toContain("当日共 2 片，预计 55 分钟");
        expect(today?.getAttribute("aria-label")).toContain("待做 20 分钟");
        expect(document.querySelector(".xz-slice-card > header .xz-slice-legend")?.textContent).toContain("已安排");
        expect(document.querySelector(".xz-slice-side")).toBeNull();
    });

    it("所有目标切片完成后提示确认事务完成", async () => {
        const complete = vi.fn().mockResolvedValue(undefined);
        const finished = transaction({
            status: "进行中",
            sliceTargetCount: 1,
            executionSlices: [{ id: "done", scheduledDate: "2026-09-04", status: "completed", completedAt: 2, updatedAt: 2 }],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: finished, complete } });
        await tick();

        expect(document.querySelector(".xz-slice-completion-prompt")?.textContent).toContain("事务是否也已完成");
        ([...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "完成事务") as HTMLButtonElement).click();
        await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
    });

    it("右键未来切片可以提前完成并保留原计划日期", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
        const future = transaction({
            sliceTargetCount: 1,
            executionSlices: [{ id: "future", scheduledDate: tomorrowKey, status: "scheduled", completedAt: null, updatedAt: 1 }],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: future, save } });
        await tick();

        const day = [...document.querySelectorAll<HTMLButtonElement>(".xz-slice-day")]
            .find((button) => button.getAttribute("aria-label")?.startsWith(tomorrowKey));
        expect(day?.getAttribute("title")).toBeNull();
        day?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 160 }));
        await tick();
        const completeEarly = document.querySelector<HTMLButtonElement>(".xz-slice-context-menu button");
        expect(completeEarly?.textContent).toBe("提前完成此切片");
        completeEarly?.click();

        await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
        expect(save.mock.calls[0][0].executionSlices).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: "future", status: "completed", scheduledDate: tomorrowKey }),
        ]));
    });

    it("右键今天的切片可以完成，右键过期切片可以补记完成", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const todayKey = localDateKey();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
        const current = transaction({
            sliceTargetCount: 2,
            executionSlices: [
                { id: "past", scheduledDate: yesterdayKey, status: "missed", completedAt: null, updatedAt: 1 },
                { id: "today", scheduledDate: todayKey, status: "scheduled", completedAt: null, updatedAt: 2 },
            ],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: current, save } });
        await tick();

        const today = [...document.querySelectorAll<HTMLButtonElement>(".xz-slice-day")]
            .find((button) => button.getAttribute("aria-label")?.startsWith(todayKey));
        today?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 160 }));
        await tick();
        expect(document.querySelector<HTMLButtonElement>(".xz-slice-context-menu button")?.textContent).toBe("完成此切片");

        document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await tick();
        const past = [...document.querySelectorAll<HTMLButtonElement>(".xz-slice-day")]
            .find((button) => button.getAttribute("aria-label")?.startsWith(yesterdayKey));
        expect(past?.disabled).toBe(false);
        past?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 160 }));
        await tick();
        const completeMissed = document.querySelector<HTMLButtonElement>(".xz-slice-context-menu button");
        expect(completeMissed?.textContent).toBe("补记完成此切片");
        completeMissed?.click();

        await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
        expect(save.mock.calls[0][0].executionSlices).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: "past", status: "completed", scheduledDate: yesterdayKey }),
            expect.objectContaining({ id: "today", status: "scheduled", scheduledDate: todayKey }),
        ]));
    });

    it("点已完成的格子就撤销：今天退回已安排，过去退回未完成", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const saveUndo = vi.fn().mockResolvedValue(undefined);
        const todayKey = localDateKey();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = keyOf(yesterday);
        const current = transaction({
            sliceTargetCount: 2,
            executionSlices: [
                { id: "past-done", scheduledDate: yesterdayKey, status: "completed", completedAt: 1, updatedAt: 1 },
                { id: "today-done", scheduledDate: todayKey, status: "completed", completedAt: 2, updatedAt: 2 },
            ],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: current, save, saveUndo } });
        await tick();

        const past = dayCell(yesterdayKey);
        const today = dayCell(todayKey);
        expect(past.disabled).toBe(false);
        expect(today.disabled).toBe(false);
        expect(today.getAttribute("title")).toBe("点击撤销这次完成");

        past.click();
        await vi.waitFor(() => expect(saveUndo).toHaveBeenCalledOnce());
        expect(saveUndo.mock.calls[0][0].executionSlices).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: "past-done", status: "missed", completedAt: null }),
        ]));
        expect(save).not.toHaveBeenCalled();

        today.click();
        await vi.waitFor(() => expect(saveUndo).toHaveBeenCalledTimes(2));
        expect(saveUndo.mock.calls[1][0].executionSlices).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: "today-done", status: "scheduled", completedAt: null }),
        ]));
    });

    it("右键已完成的切片给出撤销菜单，撤销同样走 saveUndo", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const saveUndo = vi.fn().mockResolvedValue(undefined);
        const todayKey = localDateKey();
        const current = transaction({
            sliceTargetCount: 1,
            executionSlices: [{ id: "done", scheduledDate: todayKey, status: "completed", completedAt: 1, updatedAt: 1 }],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: current, save, saveUndo } });
        await tick();

        dayCell(todayKey).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 160 }));
        await tick();
        const item = document.querySelector<HTMLButtonElement>(".xz-slice-context-menu button");
        expect(item?.textContent).toBe("撤销完成此切片");
        expect(item?.className).toContain("is-undo");
        expect(document.querySelector(".xz-slice-context-menu small")?.textContent).toContain("退回「已安排」");

        item?.click();
        await vi.waitFor(() => expect(saveUndo).toHaveBeenCalledOnce());
        expect(saveUndo.mock.calls[0][0].executionSlices).toEqual([
            expect.objectContaining({ id: "done", status: "scheduled", completedAt: null }),
        ]);
    });

    it("已放弃的切片保持只读：点不动、右键也没有菜单", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const saveUndo = vi.fn().mockResolvedValue(undefined);
        const { past: pastKey } = await monthKeys();
        const abandoned = transaction({
            sliceTargetCount: 1,
            executionSlices: [{ id: "given-up", scheduledDate: pastKey, status: "abandoned", completedAt: null, updatedAt: 1 }],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: abandoned, save, saveUndo } });
        await tick();

        const cell = dayCell(pastKey);
        expect(cell.disabled).toBe(true);
        cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 160 }));
        await tick();
        expect(document.querySelector(".xz-slice-context-menu")).toBeNull();
        cell.click();
        await tick();
        expect(save).not.toHaveBeenCalled();
        expect(saveUndo).not.toHaveBeenCalled();
    });

    it("今天格显示「今」角标，其它格子没有", async () => {
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: transaction({ sliceTargetCount: 1 }) } });
        await tick();

        const today = document.querySelector(".xz-slice-day.today");
        expect(today?.querySelector(".xz-slice-day-today-chip")?.textContent).toBe("今");
        expect(document.querySelectorAll(".xz-slice-day-today-chip")).toHaveLength(1);
    });

    it("切片做满目标后只提示确认事务，不自动改状态", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const complete = vi.fn().mockResolvedValue(undefined);
        const todayKey = localDateKey();
        const finished = transaction({
            sliceTargetCount: 1,
            status: "进行中",
            executionSlices: [{ id: "only", scheduledDate: todayKey, status: "completed", completedAt: 1, updatedAt: 1 }],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: finished, save, complete } });
        await tick();

        const prompt = document.querySelector(".xz-slice-completion-prompt");
        expect(prompt?.textContent).toContain("目标切片已全部完成，事务是否也已完成？");
        prompt?.querySelector("button")?.click();
        await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
        /* 只有点了「完成事务」才改状态，切片动作本身不再提交 status */
        expect(save).not.toHaveBeenCalled();
    });

    it("同一天的全部切片做完后当天待做为 0，但总量保留", async () => {
        const key = localDateKey();
        const finished = transaction({
            sliceTargetCount: 2,
            durationMinutes: 150,
            executionSlices: [
                { id: "first", scheduledDate: key, status: "completed", completedAt: 1, updatedAt: 1 },
                { id: "second", scheduledDate: key, status: "completed", completedAt: 2, updatedAt: 2 },
            ],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: finished } });
        await tick();

        expect(document.querySelector(".xz-slice-arranged")?.textContent).toContain("已完成 2／2");
        const today = document.querySelector(".xz-slice-day.today");
        /* 不再显示“本事务 N 片 · 完成 M”（同一事务同一天只允许一个切片，那行永远不会出现） */
        expect(today?.querySelector(".xz-slice-day-own-count")).toBeNull();
        expect(loadParts(today, ".xz-slice-day-remaining")).toMatchObject({ prefix: "待做", value: "0", unit: "分" });
        expect(loadParts(today, ".xz-slice-day-total")).toMatchObject({ prefix: "共", value: "300", unit: "分", count: "· 2 片" });
        expect(today?.classList.contains("is-clear")).toBe(true);
        expect(today?.getAttribute("aria-label")).toContain("当天没有待做事务");
    });

    it("同一天还有没做完的切片时，待做与共分别显示", async () => {
        const { future: key } = await monthKeys();
        const current = transaction({
            sliceTargetCount: 1,
            durationMinutes: 60,
            executionSlices: [{ id: "mine", scheduledDate: key, status: "scheduled", completedAt: null, updatedAt: 1 }],
        });
        const other = transaction({
            id: "other",
            rowId: "other",
            durationMinutes: 150,
            executionSlices: [
                { id: "done", scheduledDate: key, status: "completed", completedAt: 2, updatedAt: 2 },
                { id: "todo", scheduledDate: key, status: "scheduled", completedAt: null, updatedAt: 3 },
            ],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: current, items: [current, other] } });
        await tick();

        const cell = dayCell(key);
        expect(loadParts(cell, ".xz-slice-day-remaining")).toMatchObject({ prefix: "待做", value: "210", unit: "分" });
        expect(loadParts(cell, ".xz-slice-day-total")).toMatchObject({ prefix: "共", value: "360", unit: "分", count: "· 3 片" });
        expect(cell.classList.contains("is-clear")).toBe(false);
        expect(cell.getAttribute("title")).toBeNull();
        expect(cell.getAttribute("aria-label")).toContain("当日共 3 片，预计 360 分钟，已完成 150 分钟，待做 210 分钟");
    });

    it("过去日期只显示总量，不显示待做", async () => {
        const { past: key } = await monthKeys();
        const current = transaction({
            sliceTargetCount: 1,
            durationMinutes: 60,
            executionSlices: [{ id: "old", scheduledDate: key, status: "completed", completedAt: 1, updatedAt: 1 }],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: current, items: [current] } });
        await tick();

        const cell = dayCell(key);
        expect(cell.querySelector(".xz-slice-day-remaining")).toBeNull();
        expect(loadParts(cell, ".xz-slice-day-total")).toMatchObject({ prefix: "共", value: "60", unit: "分", count: "· 1 片" });
        expect(cell.getAttribute("aria-label")).toContain("当天共 1 片已完成");
    });

    it("切片没有预计时长时待做显示未估时并标记状态", async () => {
        const { future: key } = await monthKeys();
        const current = transaction({
            sliceTargetCount: 1,
            durationMinutes: null,
            executionSlices: [{ id: "unknown", scheduledDate: key, status: "scheduled", completedAt: null, updatedAt: 1 }],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: current, items: [current] } });
        await tick();

        const remaining = loadParts(dayCell(key), ".xz-slice-day-remaining");
        expect(remaining).toMatchObject({ prefix: "待做", value: "未估时" });
        expect(remaining.unit).toBeNull();
        expect(remaining.classes).toContain("has-unestimated");
        const total = loadParts(dayCell(key), ".xz-slice-day-total");
        expect(total).toMatchObject({ prefix: "共", value: "未估时" });
        expect(total.unit).toBeNull();
        /* 未估时仍然显示片数（宽屏「共 未估时 · 1 片」），只省略单位 */
        expect(total.count).toBe("· 1 片");
    });

    it("部分切片未估时时待做与共都标出下限", async () => {
        const { future: key } = await monthKeys();
        const estimated = transaction({
            id: "estimated",
            durationMinutes: 90,
            executionSlices: [{ id: "a", scheduledDate: key, status: "scheduled", completedAt: null, updatedAt: 1 }],
        });
        const unknown = transaction({
            id: "unknown",
            rowId: "unknown",
            durationMinutes: null,
            executionSlices: [{ id: "b", scheduledDate: key, status: "scheduled", completedAt: null, updatedAt: 2 }],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: estimated, items: [estimated, unknown] } });
        await tick();

        const cell = dayCell(key);
        expect(loadParts(cell, ".xz-slice-day-remaining")).toMatchObject({ prefix: "待做", value: "≥90", unit: "分" });
        expect(loadParts(cell, ".xz-slice-day-total")).toMatchObject({ prefix: "共", value: "≥90", unit: "分" });
    });

    it("月历头部汇总今天起的待做与总量", async () => {
        const { future: key } = await monthKeys();
        const current = transaction({
            sliceTargetCount: 1,
            durationMinutes: 45,
            executionSlices: [{ id: "mine", scheduledDate: key, status: "scheduled", completedAt: null, updatedAt: 1 }],
        });
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: current, items: [current] } });
        await tick();

        const summary = document.querySelector(".xz-slice-month-summary");
        expect(summary?.textContent).toContain("今天起待做 45 分");
        expect(summary?.textContent).toContain("共 45 分");
        expect(document.querySelector(".xz-slice-month-legend")?.textContent).toContain("待做＝当天已安排、但还没完成的切片时长");
    });

    it("在“目标切片数”标签后标明输入上限 366", async () => {
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: transaction() } });
        await tick();

        const input = document.querySelector('[aria-label="目标切片数"]') as HTMLInputElement;
        expect(input?.closest("label")?.textContent ?? "").toContain("输入上限 366");
    });

    it("头部说明移入提示图标，进度百分比与标签同行", async () => {
        component = new ExecutionSlicePlanner({ target: document.body, props: { item: transaction() } });
        await tick();

        const info = document.querySelector(".xz-slice-info");
        expect(info?.getAttribute("title")).toContain("切片属于当前事务，不会成为上下层工作项");
        expect(info?.getAttribute("aria-label")).toContain("切片属于当前事务，不会成为上下层工作项");
        const first = document.querySelector<HTMLElement>(".xz-slice-progress-row > div:first-child");
        expect(first?.querySelector("strong")?.textContent).toBe("0%");
        expect(first?.querySelector("span")?.textContent).toBe("事务完成度");
        expect(document.body.textContent).not.toContain("切片属于当前事务，不会成为上下层工作项。");
    });
});

type LoadParts = {
    prefix: string | null;
    value: string | null;
    unit: string | null;
    count: string | null;
    classes: string;
};

/** 按结构断言格子的时间块：标签／数值／单位／片数各自独立，窄屏靠 CSS 让位。 */
function loadParts(root: Element | null | undefined, selector: string): LoadParts {
    const node = root?.querySelector(selector);
    return {
        prefix: node?.querySelector(".xz-slice-day-prefix")?.textContent ?? null,
        value: node?.querySelector(".xz-slice-day-value")?.textContent ?? null,
        unit: node?.querySelector(".xz-slice-day-unit")?.textContent ?? node?.querySelector(".xz-slice-day-total-unit")?.textContent ?? null,
        count: node?.querySelector(".xz-slice-day-total-count")?.textContent ?? null,
        classes: node?.className ?? "",
    };
}

function dayCell(key: string): HTMLButtonElement {
    const cell = document.querySelector<HTMLButtonElement>(`.xz-slice-day[data-date="${key}"]`);
    if (!cell) throw new Error(`没有找到 ${key} 的日历格`);
    return cell;
}

function renderedKeys(): string[] {
    return [...document.querySelectorAll<HTMLElement>(".xz-slice-day")].map((node) => node.dataset.date ?? "");
}

/**
 * 先空跑一次拿到月历里真正渲染出来的日期键，再用真实数据重建组件。
 * 这样测试不依赖“今天是几号／当月怎么排”，跨月跨年都不会假失败。
 */
async function monthKeys(): Promise<{ future: string; past: string }> {
    const probe = new ExecutionSlicePlanner({ target: document.body, props: { item: transaction() } });
    await tick();
    const keys = renderedKeys();
    probe.$destroy();
    document.body.replaceChildren();
    const today = localDateKey();
    const future = keys.filter((candidate) => candidate > today).sort()[0];
    const past = keys.filter((candidate) => candidate < today).sort().reverse()[0];
    if (!future || !past) throw new Error("月历里找不到可用的未来／过去日期");
    return { future, past };
}

/** 把 Date 转成本地日期键，避免每处都手写补齐。 */
function keyOf(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDateKey(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function transaction(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "task", rowId: "task", title: "测试事务", documentId: null, detached: true,
        type: "事务", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        planDate: null, deadline: Date.now() + 2 * 24 * 60 * 60 * 1000, noDeadline: false,
        durationMinutes: 20, energy: "低", updatedAt: null, sliceTargetCount: null, executionSlices: [],
        ...overrides,
    };
}
