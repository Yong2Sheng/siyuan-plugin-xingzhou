import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import DailyRhythm from "../src/DailyRhythm.svelte";
import { createDailyRecord, createEmptyDailyStore, upsertDailyRecord, type DailyRecord } from "../src/daily-records";
import { advanceLanding, confirmSprintDay, createEmptyPhaseStore, endSprint, parsePhaseStore, startSprint, type PhaseStore } from "../src/phases";

function localDateKey(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftKey(date: string, days: number): string {
    const parsed = new Date(`${date}T12:00:00`);
    parsed.setDate(parsed.getDate() + days);
    return localDateKey(parsed);
}

/** 固定"现在"，让紧急期区间与断言与运行时刻无关。 */
const FIXED_NOW = new Date(2026, 8, 21, 14, 0, 0, 0);
const TODAY = localDateKey(new Date(2026, 8, 21));
const YESTERDAY = shiftKey(TODAY, -1);
const TOMORROW = shiftKey(TODAY, 1);

describe("紧急期与归航期的界面", () => {
    let component: { $destroy(): void } | undefined;

    beforeEach(() => {
        vi.setSystemTime(FIXED_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    function mount(phases: PhaseStore, record: DailyRecord) {
        let daily = upsertDailyRecord(createEmptyDailyStore(1000), record, 1000);
        let current = phases;
        const savePhases = vi.fn(async (incoming: PhaseStore) => (current = incoming));
        const saveDaily = vi.fn(async (incoming: DailyRecord) => (daily = upsertDailyRecord(daily, incoming, 2000)));
        component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: vi.fn().mockResolvedValue(daily),
                saveDaily,
                loadPhases: vi.fn(async () => current),
                savePhases,
            },
        });
        return { savePhases, saveDaily, phases: () => current, daily: () => daily };
    }

    it("紧急期内只显示「最小一天」：一次确认 + 四个锚点，六阶段表单收起", async () => {
        const sprint = startSprint(createEmptyPhaseStore(1000), { title: "proposal 起草", startDate: YESTERDAY, endDate: TOMORROW }, 1000);
        mount(sprint, createDailyRecord(TODAY));

        await vi.waitFor(() => expect(document.querySelectorAll(".xz-phase-anchor").length).toBeGreaterThan(0));

        // 四个锚点都在
        const anchors = [...document.querySelectorAll(".xz-phase-anchor")].map((node) => node.textContent ?? "");
        expect(anchors.some((text) => text.includes("今晚熄灯"))).toBe(true);
        expect(anchors.some((text) => text.includes("今早起床"))).toBe(true);
        expect(anchors.some((text) => text.includes("今天吃上饭"))).toBe(true);
        expect(anchors.some((text) => text.includes("今天推进了什么"))).toBe(true);

        // 横幅给出天数与结束日，且不出现连续天数／百分比
        const banner = document.querySelector(".xz-phase-banner")?.textContent ?? "";
        expect(banner).toContain("第 2 天");
        expect(banner).not.toContain("%");

        // 紧急期内不出现六阶段导航、不出现待补清单，也没有"展开完整记录"这种多余入口
        expect(document.querySelector(".xz-daily-stage-nav")).toBeNull();
        expect([...document.querySelectorAll("button")].some((button) => button.textContent?.includes("展开完整记录"))).toBe(false);
        expect(document.querySelector(".xz-daily-missing-panel")).toBeNull();
    });

    /**
     * 紧急期内**不再有"今天仍在紧急期"按钮**（用户反馈它没有产出任何信息）。
     * 现在打开今天就会自动写一条当天记录：这样"确认过但没记锚点"与"整天没打开"事后仍能区分。
     */
    it("进入紧急期后打开今天：自动写入当天记录，不需要任何点击", async () => {
        const sprint = startSprint(createEmptyPhaseStore(1000), { startDate: YESTERDAY, endDate: TOMORROW }, 1000);
        const harness = mount(sprint, createDailyRecord(TODAY));

        await vi.waitFor(() => expect(harness.savePhases).toHaveBeenCalled());
        expect(harness.phases().sprints[0].days.map((entry) => entry.date)).toEqual([TODAY]);
        // 界面上不再有那个按钮
        expect(document.querySelector(".xz-phase-continue")).toBeNull();
    });

    it("紧急期内的记录按 sprint 状态落库：退出统计但保留锚点", async () => {
        const sprint = startSprint(createEmptyPhaseStore(1000), { startDate: YESTERDAY, endDate: TOMORROW }, 1000);
        const harness = mount(sprint, createDailyRecord(TODAY));

        await vi.waitFor(() => expect(document.querySelectorAll(".xz-phase-anchor").length).toBeGreaterThan(0));

        await vi.waitFor(() => expect(harness.saveDaily).toHaveBeenCalled());
        const saved = harness.daily().records.find((record) => record.date === TODAY);
        expect(saved?.dayState).toBe("sprint");
    });

    it("四个锚点里只记熄灯也能保存：当场熄灯写入 live 来源", async () => {
        const sprint = startSprint(createEmptyPhaseStore(1000), { startDate: YESTERDAY, endDate: TOMORROW }, 1000);
        const harness = mount(sprint, createDailyRecord(TODAY));

        await vi.waitFor(() => expect(document.querySelectorAll(".xz-phase-anchor").length).toBeGreaterThan(0));
        const lightsOff = [...document.querySelectorAll<HTMLButtonElement>(".xz-phase-anchor button")]
            .find((button) => button.textContent?.includes("此刻熄灯"));
        expect(lightsOff).toBeDefined();
        lightsOff?.click();

        await vi.waitFor(() => expect(harness.saveDaily).toHaveBeenCalled());
        const saved = harness.daily().records.find((record) => record.date === TODAY);
        expect(saved?.fields.lightsOffTimeSource).toBe("live");
        expect(saved?.fields.lightsOffTime).toMatch(/^\d{2}:\d{2}$/);
    });

    it("今天不在紧急期：没有最小一天，也没有归航横幅，入口按钮可用", async () => {
        const sprint = startSprint(createEmptyPhaseStore(1000), { startDate: shiftKey(TODAY, -20), endDate: shiftKey(TODAY, -10) }, 1000);
        mount(sprint, createDailyRecord(TODAY));

        await new Promise((resolve) => setTimeout(resolve, 600));
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-stage-nav")).not.toBeNull());
        expect(document.querySelector(".xz-phase-continue")).toBeNull();
        expect(document.querySelector(".xz-phase-banner")).toBeNull();
        expect(document.querySelector(".xz-phase-landing")).toBeNull();
        expect([...document.querySelectorAll("button")].some((button) => button.textContent?.includes("进入紧急期…"))).toBe(true);
    });

    it("归航期内显示固定一级与三个动作，做完后当天不再重复推进", async () => {
        const base = startSprint(createEmptyPhaseStore(1000), { startDate: YESTERDAY, endDate: TOMORROW }, 1000);
        const ended = endSprint(base, base.sprints[0].id, { startLanding: true, landingStartDate: TODAY }, 1000);
        const harness = mount(ended, createDailyRecord(TODAY));

        await vi.waitFor(() => expect(document.querySelector(".xz-phase-landing")).not.toBeNull());
        const landing = document.querySelector(".xz-phase-landing")?.textContent ?? "";
        expect(landing).toContain("第 1 级");
        expect(landing).toContain("这次交付完成了吗");

        const done = [...document.querySelectorAll<HTMLButtonElement>(".xz-phase-landing button")]
            .find((button) => button.textContent?.includes("做完了，明天进下一级"));
        expect(done).toBeDefined();
        done?.click();

        await vi.waitFor(() => expect(harness.savePhases).toHaveBeenCalledTimes(1));
        expect(harness.phases().landings[0].cursor).toBe(1);
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-landing")?.textContent).toContain("已记录"));
    });

    it("归航「今天不方便」不推进阶梯：明天还是这一级", async () => {
        const base = startSprint(createEmptyPhaseStore(1000), { startDate: YESTERDAY, endDate: TOMORROW }, 1000);
        const ended = endSprint(base, base.sprints[0].id, { startLanding: true, landingStartDate: TODAY }, 1000);
        const harness = mount(ended, createDailyRecord(TODAY));

        await vi.waitFor(() => expect(document.querySelector(".xz-phase-landing")).not.toBeNull());
        const defer = [...document.querySelectorAll<HTMLButtonElement>(".xz-phase-landing button")]
            .find((button) => button.textContent?.includes("今天不方便，明天再说"));
        defer?.click();

        await vi.waitFor(() => expect(harness.savePhases).toHaveBeenCalledTimes(1));
        expect(harness.phases().landings[0].cursor).toBe(0);
        expect(harness.phases().landings[0].logs[0].status).toBe("deferred");
    });

    /**
     * 弹层必须挂在浮层容器里，而且不能被塞进今日记录的栅格布局。
     *
     * 真实事故：声明弹窗原本直接渲染在 `.xz-daily-layout`（grid 容器）里，
     * 于是它成了一个网格项，被摆到右栏而不是居中浮层——界面看起来像在右下角。
     * 这里锁住结构：以后谁把它挪回布局容器里，测试立刻失败。
     */
    it("声明弹窗是居中浮层：挂在 backdrop 里，且不在今日记录的栅格里", async () => {
        mount(createEmptyPhaseStore(1000), createDailyRecord(TODAY));

        await vi.waitFor(() => expect([...document.querySelectorAll("button")].some((button) => button.textContent?.includes("进入紧急期…"))).toBe(true));
        const entry = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("进入紧急期…"));
        entry?.click();
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-dialog")).not.toBeNull());

        const dialog = document.querySelector(".xz-phase-dialog")!;
        const backdrop = dialog.parentElement;
        expect(backdrop?.classList.contains("xz-dialog-backdrop")).toBe(true);
        // 浮层不能被放进今天的栅格布局里（否则又会变成网格项）
        expect(dialog.closest(".xz-daily-layout")).toBeNull();
        expect(backdrop?.closest(".xz-daily-layout")).toBeNull();
        // 也不能落在折叠区块或记录卡里面
        expect(dialog.closest(".xz-daily-record")).toBeNull();
        expect(dialog.closest(".xz-phase-collapsed")).toBeNull();
        // role/aria：浮层是模态对话框
        expect(dialog.getAttribute("role")).toBe("dialog");
        expect(dialog.getAttribute("aria-modal")).toBe("true");
    });

    it("点浮层背景关闭声明弹窗，不改动任何数据", async () => {
        const harness = mount(createEmptyPhaseStore(1000), createDailyRecord(TODAY));
        await vi.waitFor(() => expect([...document.querySelectorAll("button")].some((button) => button.textContent?.includes("进入紧急期…"))).toBe(true));
        [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("进入紧急期…"))?.click();
        await vi.waitFor(() => expect(document.querySelector(".xz-dialog-backdrop")).not.toBeNull());

        document.querySelector<HTMLElement>(".xz-dialog-backdrop")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-dialog")).toBeNull());
        expect(harness.savePhases).not.toHaveBeenCalled();
    });

    it("确认进入紧急期后浮层关闭，横幅与最小一天同时出现", async () => {
        const harness = mount(createEmptyPhaseStore(1000), createDailyRecord(TODAY));
        await vi.waitFor(() => expect([...document.querySelectorAll("button")].some((button) => button.textContent?.includes("进入紧急期…"))).toBe(true));
        [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("进入紧急期…"))?.click();
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-dialog")).not.toBeNull());

        const confirm = [...document.querySelectorAll<HTMLButtonElement>(".xz-phase-dialog button")].find((button) => button.textContent?.trim() === "进入紧急期");
        confirm?.click();
        // 第一次保存来自"声明紧急期"，随后的自动按天记录会再写一次（都在同一个 store 上）
        await vi.waitFor(() => expect(harness.savePhases).toHaveBeenCalled());
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-dialog")).toBeNull());
        expect(document.querySelector(".xz-phase-banner")).not.toBeNull();
        expect(document.querySelectorAll(".xz-phase-anchor").length).toBeGreaterThan(0);
        // 进入当天即自动记一条，"今天仍在紧急期"按钮不再存在
        expect(harness.phases().sprints[0].days.map((entry) => entry.date)).toContain(TODAY);
        expect(document.querySelector(".xz-phase-continue")).toBeNull();
    });

    /**
     * 跨天之后界面必须照旧（用户实际反馈："第二天找不到结束紧急期的地方"）。
     *
     * 这里刻意走"保存 → 重新解析 → 第二天重新挂载"这条真实路径：
     * 只有 stage 数据能完整往返，第二天才可能同时看到横幅、最小一天与「结束紧急期」。
     */
    it("跨到第二天：横幅、最小一天与「结束紧急期」都在，完整表单仍然收起", async () => {
        const first = startSprint(createEmptyPhaseStore(1000), { title: "proposal 起草", startDate: TODAY, endDate: shiftKey(TODAY, 7) }, 1000);
        const confirmed = confirmSprintDay(first, first.sprints[0].id, TODAY, 2000);
        // 模拟真实存储：序列化后重新解析
        const persisted = parsePhaseStore(JSON.parse(JSON.stringify(confirmed)));
        expect(persisted).not.toBeNull();

        // 把"现在"推到第二天
        vi.setSystemTime(new Date(`${TOMORROW}T09:00:00`));
        const nextDay = localDateKey(new Date(`${TOMORROW}T09:00:00`));
        mount(persisted!, createDailyRecord(nextDay, "research-workday", 1000));

        await vi.waitFor(() => expect(document.querySelector(".xz-phase-banner")).not.toBeNull());
        const banner = document.querySelector(".xz-phase-banner")?.textContent ?? "";
        expect(banner).toContain("第 2 天");
        expect(banner).toContain("结束紧急期");
        expect(banner).toContain("延长到…");

        // 四个锚点照旧（"今天仍在紧急期"按钮已按反馈删除）
        expect(document.querySelectorAll(".xz-phase-anchor").length).toBeGreaterThan(0);

        // 紧急期内完全不显示六阶段完整记录，也不再有任何"展开"入口
        expect(document.querySelector(".xz-daily-stage-nav")).toBeNull();
        expect([...document.querySelectorAll("button")].some((button) => button.textContent?.includes("展开完整记录"))).toBe(false);
    });

    /**
     * 结构契约（真实事故）：紧急期里绝不能出现六阶段表单的容器 `.xz-daily-layout`。
     *
     * 之前有个"展开完整记录"的入口，点开后被挤成一条不到一厘米高、带滚动条的缝隙——
     * 因为 `.xz-daily-layout` 是 `flex: 1 + min-height: 0`，被上方的阶段横幅抢走了纵向空间。
     * 修法不是调高度，而是**让这个入口不存在**：紧急期只显示四个锚点。
     */
    it("紧急期内不渲染六阶段表单容器，也不提供任何展开入口", async () => {
        const sprint = startSprint(createEmptyPhaseStore(1000), { startDate: YESTERDAY, endDate: TOMORROW }, 1000);
        mount(sprint, createDailyRecord(TODAY));

        await vi.waitFor(() => expect(document.querySelectorAll(".xz-phase-anchor").length).toBeGreaterThan(0));
        expect(document.querySelector(".xz-daily-layout")).toBeNull();
        expect(document.querySelector(".xz-daily-record")).toBeNull();
        expect(document.querySelector(".xz-daily-save-bar")).toBeNull();
        const labels = [...document.querySelectorAll("button")].map((button) => button.textContent?.trim() ?? "");
        expect(labels.some((label) => label.includes("展开"))).toBe(false);
        expect(labels.some((label) => label.includes("收起"))).toBe(false);
    });
});

describe("阶段数据丢失后的救援入口", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("记录标为紧急期但阶段数据为空时，给出补声明与改回正常两个出口", async () => {
        vi.setSystemTime(new Date(2026, 8, 21, 14, 0, 0, 0));
        const today = localDateKey(new Date(2026, 8, 21));
        const record = { ...createDailyRecord(today), dayState: "sprint" as const };
        let daily = upsertDailyRecord(createEmptyDailyStore(1000), record, 1000);
        component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: vi.fn().mockResolvedValue(daily),
                saveDaily: vi.fn(async (incoming: DailyRecord) => (daily = upsertDailyRecord(daily, incoming, 2000))),
                loadPhases: vi.fn(async () => createEmptyPhaseStore(1000)),
                savePhases: vi.fn(async (store: PhaseStore) => store),
            },
        });

        await vi.waitFor(() => expect(document.querySelector(".xz-phase-recover")).not.toBeNull());
        const recover = document.querySelector(".xz-phase-recover")?.textContent ?? "";
        expect(recover).toContain("阶段数据里没有对应的区间");
        expect([...document.querySelectorAll(".xz-phase-recover button")].map((button) => button.textContent?.trim()))
            .toEqual(["重新声明紧急期…", "改回正常"]);
        vi.useRealTimers();
    });
});

describe("声明弹窗的快捷日期", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        vi.useRealTimers();
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("点「一周后」后该按钮保持选中态；手动改日期后选中态消失", async () => {
        vi.setSystemTime(new Date(2026, 8, 21, 14, 0, 0, 0));
        const today = localDateKey(new Date(2026, 8, 21));
        let daily = upsertDailyRecord(createEmptyDailyStore(1000), createDailyRecord(today), 1000);
        component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: vi.fn().mockResolvedValue(daily),
                saveDaily: vi.fn(async (incoming: DailyRecord) => (daily = upsertDailyRecord(daily, incoming, 2000))),
                loadPhases: vi.fn(async () => createEmptyPhaseStore(1000)),
                savePhases: vi.fn(async (store: PhaseStore) => store),
            },
        });

        await vi.waitFor(() => expect([...document.querySelectorAll("button")].some((button) => button.textContent?.includes("进入紧急期…"))).toBe(true));
        [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("进入紧急期…"))?.click();
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-dialog")).not.toBeNull());

        const quick = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".xz-phase-quick button")]
            .find((button) => button.textContent?.trim() === label);
        // 默认是"一周后"
        expect(quick("一周后")?.getAttribute("aria-pressed")).toBe("true");
        expect(quick("3 天后")?.getAttribute("aria-pressed")).toBe("false");

        quick("3 天后")?.click();
        await vi.waitFor(() => expect(quick("3 天后")?.getAttribute("aria-pressed")).toBe("true"));
        expect(quick("一周后")?.getAttribute("aria-pressed")).toBe("false");

        // 手动改日期：两个档位都不再高亮
        const input = document.querySelector<HTMLInputElement>(".xz-phase-quick input[type=date]");
        if (input) {
            input.value = shiftKey(today, 30);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await vi.waitFor(() => expect(quick("3 天后")?.getAttribute("aria-pressed")).toBe("false"));
            expect(quick("一周后")?.getAttribute("aria-pressed")).toBe("false");
        }
    });


});

describe("结束紧急期后表单必须立刻回来（真实事故：页面空白）", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        vi.useRealTimers();
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    /**
     * 真实事故：结束紧急期后整张表单消失、页面一片空白。
     * 根因是 Svelte 的响应式——父组件 `$: sprintPhase = phaseStore.sprints.find(...)` 依赖的是
     * `phaseStore.sprints` 这个**引用**；子组件保存后只更新了自己内部的 store，父组件那份没变，
     * 于是 `inSprint` 永远停在 true，表单永远不渲染。
     * 修法：子组件保存后把新快照回传（storeChanged 事件），父组件同步。
     */
    it("结束并开始归航之后：紧急期界面消失，完整表单与归航横幅同时出现", async () => {
        vi.setSystemTime(new Date(2026, 8, 21, 14, 0, 0, 0));
        const today = localDateKey(new Date(2026, 8, 21));
        const sprint = startSprint(createEmptyPhaseStore(1000), { title: "proposal 起草", startDate: today, endDate: shiftKey(today, 6) }, 1000);

        let daily = upsertDailyRecord(createEmptyDailyStore(1000), createDailyRecord(today), 1000);
        let phases = sprint;
        component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: vi.fn().mockResolvedValue(daily),
                saveDaily: vi.fn(async (incoming: DailyRecord) => (daily = upsertDailyRecord(daily, incoming, 2000))),
                loadPhases: vi.fn(async () => phases),
                savePhases: vi.fn(async (incoming: PhaseStore) => (phases = incoming)),
            },
        });

        // 紧急期界面
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-banner")).not.toBeNull());
        expect(document.querySelector(".xz-phase-core")).not.toBeNull();
        expect(document.querySelector(".xz-daily-layout")).toBeNull();

        // 走真实路径结束：点「结束紧急期」→ 确认「结束并开始归航」
        [...document.querySelectorAll<HTMLButtonElement>(".xz-phase-banner button")].find((button) => button.textContent?.includes("结束紧急期"))?.click();
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-dialog")).not.toBeNull());
        [...document.querySelectorAll<HTMLButtonElement>(".xz-phase-dialog button")].find((button) => button.textContent?.includes("结束并开始归航"))?.click();

        // 结束后：紧急期界面必须消失，归航横幅与第 1 级要填的内容必须出现
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-banner")).toBeNull());
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-landing")).not.toBeNull());
        expect(document.querySelector(".xz-phase-core")).toBeNull();
        expect(document.querySelectorAll(".xz-phase-anchor").length).toBe(0);
        // 归航第 1 级只放开"交付结果"这一块：不再一次性把整张表拍回来
        expect(document.querySelector(".xz-phase-delivery")).not.toBeNull();
        expect(document.querySelector(".xz-sleep-wake")).toBeNull();
        expect(document.querySelector(".xz-daily-stage-nav")).toBeNull();
        // 五阶段进度条在归航期内不显示，避免"几十项待补"的压迫感
        expect(document.querySelector(".xz-daily-progress")).toBeNull();
    });
});

describe("归航期按阶梯逐级放开字段（用户要求 A）", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        vi.useRealTimers();
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    function mountLanding(advanceDays: number) {
        vi.setSystemTime(new Date(2026, 8, 21, 14, 0, 0, 0));
        const start = localDateKey(new Date(2026, 8, 21));
        const today = shiftKey(start, advanceDays);
        vi.setSystemTime(new Date(`${today}T14:00:00`));
        const sprint = startSprint(createEmptyPhaseStore(1000), { title: "proposal 起草", startDate: start, endDate: shiftKey(start, 6) }, 1000);
        let phases = endSprint(sprint, sprint.sprints[0].id, { startLanding: true, landingStartDate: start }, 1000);
        // 把归航推进到第 advanceDays + 1 级（每级各记一次「做完」）
        const landingId = phases.landings[0].id;
        for (let index = 0; index < advanceDays; index += 1) {
            phases = advanceLanding(phases, landingId, "done", shiftKey(start, index), 2000 + index);
        }
        let daily = upsertDailyRecord(createEmptyDailyStore(1000), createDailyRecord(today), 1000);
        component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: vi.fn().mockResolvedValue(daily),
                saveDaily: vi.fn(async (incoming: DailyRecord) => (daily = upsertDailyRecord(daily, incoming, 2000))),
                loadPhases: vi.fn(async () => phases),
                savePhases: vi.fn(async (incoming: PhaseStore) => incoming),
            },
        });
        return { today };
    }

    it("第 1 级：只放「交付结果 + 交接记录」，睡眠/今日安排/其他阶段全不出现", async () => {
        mountLanding(0);
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-delivery")).not.toBeNull());
        expect(document.querySelector(".xz-phase-delivery")?.textContent).toContain("这次交付完成了吗");
        // 完整表单的其余部分一律不渲染
        expect(document.querySelector(".xz-sleep-wake")).toBeNull();
        expect(document.querySelector(".xz-daily-flow-primary")).toBeNull();
        const labels = [...document.querySelectorAll(".xz-daily-stage-nav button")].map((button) => button.textContent?.trim());
        expect(labels).toEqual([]);
        expect([...document.querySelectorAll("button")].some((button) => button.textContent?.includes("检查待补"))).toBe(false);
    });

    it("第 2 级：多出「今日起床」；第 3 级再多出工作边界", async () => {
        mountLanding(1);
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-landing")).not.toBeNull());
        // 第 2 级是"起床时间回来"：只有起床字段，没有交付面板（那只属于第 1 级）
        expect(document.querySelector(".xz-phase-delivery")).toBeNull();
        expect(document.querySelector(".xz-sleep-wake")).not.toBeNull();
        // 归航期内用级数控制字段，不显示阶段导航（第 1 级没有阶段可填，空导航条是多余的）
        expect(document.querySelector(".xz-daily-stage-nav")).toBeNull();

        component?.$destroy();
        document.body.replaceChildren();
        mountLanding(2);
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-landing")).not.toBeNull());
        // 第 3 级：睡眠与身体整块打开（含起床、体重、睡眠质量），仍不显示阶段导航
        await vi.waitFor(() => expect(document.querySelector(".xz-sleep-wake")).not.toBeNull(), { timeout: 3000 });
        expect(document.querySelector(".xz-daily-progress")).toBeNull();

        component?.$destroy();
        document.body.replaceChildren();
        mountLanding(3);
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-landing")).not.toBeNull());
        // 第 4 级：工作边界这一组开放
        expect(document.querySelector(".xz-daily-boundary, .xz-daily-field")).not.toBeNull();
    });
});

describe("紧急期跨天：查看非今天的日子也必须渲染（真实事故：12 号一片空白）", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        vi.useRealTimers();
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    /**
     * 真实事故：11 号声明紧急期后翻到 12 号，整页空白。
     * 根因是我给紧急期界面与归航横幅加了 `isToday` 条件，而 `isToday` 是相对"今天"算的，
     * 查看别的日期时直接为假 → 横幅、锚点、表单全都不渲染。
     *
     * 这里刻意"系统时间是 11 号、界面日期是 12 号"：这正是出事的组合。
     */
    it("系统时间停在 10-11、界面打开 10-12 时，紧急期横幅与四个锚点照常渲染", async () => {
        vi.setSystemTime(new Date(2026, 9, 11, 14, 0, 0, 0));
        const start = "2026-10-11";
        const viewing = "2026-10-12";
        const sprint = startSprint(createEmptyPhaseStore(1000), { title: "", startDate: start, endDate: "2026-10-18" }, 1000);
        let daily = upsertDailyRecord(createEmptyDailyStore(1000), createDailyRecord(viewing), 1000);

        component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: vi.fn().mockResolvedValue(daily),
                saveDaily: vi.fn(async (record: DailyRecord) => (daily = upsertDailyRecord(daily, record, 2000))),
                loadPhases: vi.fn(async () => sprint),
                savePhases: vi.fn(async (store: PhaseStore) => store),
            },
        });

        await vi.waitFor(() => expect(document.querySelector(".xz-phase-banner")).not.toBeNull());
        expect(document.querySelectorAll(".xz-phase-anchor").length).toBeGreaterThan(0);
        expect(document.querySelector(".xz-phase-banner")?.textContent).toContain("10 月 18 日");
    });
});

describe("交付面板只属于第 1 级（真实事故：走到第 4 级它还挂着）", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        vi.useRealTimers();
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    function mountAt(rungIndex: number) {
        vi.setSystemTime(new Date(2026, 8, 21, 14, 0, 0, 0));
        const start = "2026-09-21";
        const today = shiftKey(start, rungIndex + 1);
        const sprint = startSprint(createEmptyPhaseStore(1000), { startDate: start, endDate: shiftKey(start, 2) }, 1000);
        let phases = endSprint(sprint, sprint.sprints[0].id, { startLanding: true, landingStartDate: shiftKey(start, 3) }, 1000);
        const landingId = phases.landings[0].id;
        for (let index = 0; index < rungIndex; index += 1) {
            phases = advanceLanding(phases, landingId, "done", shiftKey(start, 3 + index), 3000 + index);
        }
        // 查看的日子在那些动作之后：当天还没有记录，因此显示的级数由光标决定
        const viewing = shiftKey(start, 3 + rungIndex);
        vi.setSystemTime(new Date(`${viewing}T14:00:00`));
        let daily = upsertDailyRecord(createEmptyDailyStore(1000), createDailyRecord(viewing), 1000);
        component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: vi.fn().mockResolvedValue(daily),
                saveDaily: vi.fn(async (record: DailyRecord) => (daily = upsertDailyRecord(daily, record, 2000))),
                loadPhases: vi.fn(async () => phases),
                savePhases: vi.fn(async (store: PhaseStore) => store),
            },
        });
    }

    it("第 1 级显示交付面板", async () => {
        mountAt(0);
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-landing")).not.toBeNull());
        expect(document.querySelector(".xz-phase-delivery")).not.toBeNull();
    });

    it("第 3 级不再显示交付面板（横幅级数与之必须一致）", async () => {
        mountAt(2);
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-landing")).not.toBeNull());
        expect(document.querySelector(".xz-phase-landing")?.textContent).toContain("第 3 级");
        expect(document.querySelector(".xz-phase-delivery")).toBeNull();
    });
});

describe("紧急期到点自动进入归航期（真实缺口：到点后直接回到全量表单）", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        vi.useRealTimers();
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    /**
     * 真实缺口：紧急期最后一天过后第一次打开，之前只是"静默失效"——
     * 界面直接切回完整表单，归航阶梯根本没开始（实测：区间结束次日归航为空）。
     * 到点结束是声明时就约定好的事，必须自动收尾并进入归航。
     */
    it("区间结束次日打开：自动结束紧急期并出现归航横幅（不是全量表单）", async () => {
        const start = "2026-10-11";
        const end = "2026-10-17";
        const nextDay = "2026-10-18";
        vi.setSystemTime(new Date(`${nextDay}T14:00:00`));
        const sprint = startSprint(createEmptyPhaseStore(1000), { title: "", startDate: start, endDate: end }, 1000);
        let phases = sprint;
        let daily = upsertDailyRecord(createEmptyDailyStore(1000), createDailyRecord(nextDay), 1000);

        component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: vi.fn().mockResolvedValue(daily),
                saveDaily: vi.fn(async (record: DailyRecord) => (daily = upsertDailyRecord(daily, record, 2000))),
                loadPhases: vi.fn(async () => phases),
                savePhases: vi.fn(async (store: PhaseStore) => (phases = store)),
            },
        });

        await new Promise((resolve) => setTimeout(resolve, 800));
        console.log("[auto2]", (globalThis as unknown as { __XZ_AUTO2__?: unknown }).__XZ_AUTO2__);
        console.log("[saved]", phases.sprints[0].endedAt, phases.landings.length);
        await vi.waitFor(() => expect(document.querySelector(".xz-phase-landing")).not.toBeNull(), { timeout: 4000 });
        // 紧急期横幅消失、归航从次日开始、交付面板属于第 1 级所以出现
        expect(document.querySelector(".xz-phase-banner")).toBeNull();
        expect(phases.sprints[0].endedBy).toBe("deadline");
        expect(phases.landings.length).toBe(1);
        expect(phases.landings[0].startDate).toBe(nextDay);
    });
});


/**
 * 端到端：完全按用户的真实路径走——
 * 声明紧急期 → 结束并进入归航 → 点「做完了」→ 跨天 → 再点，连走 4 级。
 * 断言每一级的横幅级数必须递增。
 */
describe("归航连续多天的真实路径（端到端，按用户操作顺序）", () => {
    it("点做完了→跨天→再点，级别必须 1→2→3→4 递增", async () => {
        let store: PhaseStore = startSprint(createEmptyPhaseStore(1000), { startDate: "2026-10-11", endDate: "2026-10-17" }, 1000);
        let daily = createEmptyDailyStore(1000);
        let clock = new Date("2026-10-12T14:00:00").getTime();
        vi.setSystemTime(clock);

        const mount = () => {
            const component = new DailyRhythm({
                target: document.body,
                props: {
                    loadDaily: vi.fn(async () => daily),
                    saveDaily: vi.fn(async (record: DailyRecord) => (daily = upsertDailyRecord(daily, record, Date.now()))),
                    loadPhases: vi.fn(async () => store),
                    savePhases: vi.fn(async (next: PhaseStore) => (store = next)),
                },
            });
            return component;
        };

        let component = mount();
        // 等到今天这一天的记录被自动写入（组件挂载后异步完成）
        for (let i = 0; i < 40; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            if (store.sprints[0].endedAt !== null) break;
            if (document.querySelector(".xz-phase-banner")) break;
        }
        // 结束紧急期并进入归航：直接走领域函数（等价于界面按钮触发的同一条路径）
        store = endSprint(store, store.sprints[0].id, { startLanding: true, landingStartDate: "2026-10-11" }, Date.now());

        const levels: number[] = [];
        for (let day = 0; day < 4; day += 1) {
            component.$destroy();
            document.body.replaceChildren();
            const date = `2026-10-${String(12 + day).padStart(2, "0")}`;
            clock = new Date(`${date}T14:00:00`).getTime();
            vi.setSystemTime(clock);
            daily = upsertDailyRecord(daily, createDailyRecord(date), Date.now());
            component = mount();

            await vi.waitFor(() => expect(document.querySelector(".xz-phase-landing")).not.toBeNull(), { timeout: 3000 });
            const banner = document.querySelector(".xz-phase-landing")?.textContent ?? "";
            const matched = /第\s*(\d+)\s*级/.exec(banner);
            levels.push(Number(matched?.[1] ?? 0));

            const done = [...document.querySelectorAll<HTMLButtonElement>(".xz-phase-landing button")]
                .find((button) => button.textContent?.includes("做完了"));
            expect(done, `第 ${day + 1} 天找不到「做完了」按钮`).toBeTruthy();
            done!.click();
            await tick();
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        component?.$destroy();

        // 每一级的横幅级数必须递增
        expect(levels).toEqual([1, 2, 3, 4]);
        expect(store.landings[0].cursor).toBeGreaterThanOrEqual(4);
    }, 30000);
});

describe("归航 7 级逐日真实挂载（不经过沙盒）", () => {
    it("每天重新挂载组件、点「做完了」，横幅级数必须 1..7 且最后自动结束", async () => {
        const notes: string[] = [];
        let store: PhaseStore = startSprint(createEmptyPhaseStore(1000), { startDate: "2026-10-11", endDate: "2026-10-17" }, 1000);
        let daily = createEmptyDailyStore(1000);
        // 真实路径：10-18 那天到点自动结束并进入归航
        store = endSprint(store, store.sprints[0].id, { endedBy: "deadline", startLanding: true, landingStartDate: "2026-10-18" }, 2000);

        const seen: string[] = [];
        for (let day = 0; day < 7; day += 1) {
            const date = `2026-10-${String(18 + day).padStart(2, "0")}`;
            vi.setSystemTime(new Date(`${date}T14:00:00`));
            daily = upsertDailyRecord(daily, createDailyRecord(date), Date.now());
            const component = new DailyRhythm({
                target: document.body,
                props: {
                    loadDaily: vi.fn(async () => daily),
                    saveDaily: vi.fn(async (record: DailyRecord) => (daily = upsertDailyRecord(daily, record, Date.now()))),
                    loadPhases: vi.fn(async () => store),
                    savePhases: vi.fn(async (next: PhaseStore) => (store = next)),
                },
            });
            await vi.waitFor(() => expect(document.querySelector(".xz-phase-landing")).not.toBeNull(), { timeout: 3000 });
            const banner = (document.querySelector(".xz-phase-landing")?.textContent ?? "").replace(/\s+/g, " ");
            const level = /第\s*(\d+)\s*级/.exec(banner)?.[1] ?? "?";
            const wake = document.querySelectorAll(".xz-sleep-wake").length > 0 ? "起床✓" : "起床—";
            const sleep = document.querySelectorAll(".xz-daily-fields.xz-sleep").length > 0 ? "睡眠整块✓" : "睡眠整块—";
            const delivery = document.querySelectorAll(".xz-phase-delivery").length > 0 ? "交付✓" : "交付—";
            seen.push(`${date} 第${level}级 | ${delivery} ${wake} ${sleep}`);
            notes.push(`  ${date} → 横幅「${banner.slice(0, 22)}」`);
            const done = [...document.querySelectorAll<HTMLButtonElement>(".xz-phase-landing button")].find((b) => b.textContent?.includes("做完了"));
            expect(done, `${date} 找不到「做完了」`).toBeTruthy();
            done!.click();
            await tick();
            await new Promise((r) => setTimeout(r, 150));
            component.$destroy();
            document.body.replaceChildren();
        }
        console.log("[7级逐日]\n" + seen.join("\n"));
        expect(seen.map((line) => Number(/第(\d+)级/.exec(line)?.[1]))).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(store.landings[0].endedAt).not.toBeNull();
    }, 40000);
});

describe("全流程自检（当天不跳级 + 次日才进下一级）", () => {
    it("紧急期每天 → 归航 7 级逐日：当天点完不跳级，次日才进下一级", async () => {
        const log: string[] = [];
        let store: PhaseStore = createEmptyPhaseStore(1000);
        let daily = createEmptyDailyStore(1000);
        const mountAt = async (date: string) => {
            vi.setSystemTime(new Date(`${date}T14:00:00`));
            daily = upsertDailyRecord(daily, createDailyRecord(date), Date.now());
            const component = new DailyRhythm({
                target: document.body,
                props: {
                    loadDaily: vi.fn(async () => daily),
                    saveDaily: vi.fn(async (r: DailyRecord) => (daily = upsertDailyRecord(daily, r, Date.now()))),
                    loadPhases: vi.fn(async () => store),
                    savePhases: vi.fn(async (n: PhaseStore) => (store = n)),
                },
            });
            await new Promise((r) => setTimeout(r, 450));
            return component;
        };
        const read = () => {
            const banner = document.querySelector(".xz-phase-landing")?.textContent?.replace(/\s+/g, " ") ?? "";
            return {
                level: /第\s*(\d+)\s*级/.exec(banner)?.[1] ?? "-",
                delivery: document.querySelectorAll(".xz-phase-delivery").length,
                wake: document.querySelectorAll(".xz-sleep-wake").length,
                sleep: document.querySelectorAll(".xz-daily-fields.xz-sleep").length,
                sprint: document.querySelector(".xz-phase-banner") ? "紧急期" : "-",
            };
        };

        store = startSprint(store, { startDate: "2026-10-11", endDate: "2026-10-13" }, 1000);
        for (const date of ["2026-10-11", "2026-10-12", "2026-10-13"]) {
            const component = await mountAt(date);
            const state = read();
            log.push(`${date}  ${state.sprint}  归航=${state.level}`);
            expect(state.sprint).toBe("紧急期");
            component.$destroy();
            document.body.replaceChildren();
        }

        store = endSprint(store, store.sprints[0].id, { endedBy: "deadline", startLanding: true, landingStartDate: "2026-10-14" }, 1000);
        let component = await mountAt("2026-10-14");
        for (let day = 0; day < 7; day += 1) {
            const date = `2026-10-${String(14 + day).padStart(2, "0")}`;
            if (day > 0) {
                component.$destroy();
                document.body.replaceChildren();
                component = await mountAt(date);
            }
            const before = read();
            expect(Number(before.level), `${date} 当天级数`).toBe(day + 1);
            const done = [...document.querySelectorAll<HTMLButtonElement>(".xz-phase-landing button")]
                .find((b) => b.textContent?.includes("做完了"));
            expect(done, `${date} 找不到「做完了」`).toBeTruthy();
            done!.click();
            await tick();
            await new Promise((r) => setTimeout(r, 350));
            const after = read();
            log.push(`${date}  第${before.level}级(交付${before.delivery} 起床${before.wake} 睡眠${before.sleep}) → 点后 第${after.level}级(交付${after.delivery} 起床${after.wake} 睡眠${after.sleep})`);
            if (day < 6) {
                expect(after.level, `${date} 点完后当天级数跳了`).toBe(before.level);
                expect(after.delivery, `${date} 点完后冒出交付面板`).toBe(before.delivery);
                expect(after.wake, `${date} 点完后冒出起床字段`).toBe(before.wake);
                expect(after.sleep, `${date} 点完后冒出睡眠整块`).toBe(before.sleep);
            } else {
                // 第 7 级点完：归航结束，横幅消失
                expect(after.level).toBe("-");
            }
        }
        component.$destroy();
        document.body.replaceChildren();
        console.log("[全流程自检]\n" + log.map((line) => "  " + line).join("\n"));
        expect(store.landings[0].endedAt).not.toBeNull();
    }, 60000);
});
