import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DailyRhythm from "../src/DailyRhythm.svelte";
import { createEmptyDailyStore, createDailyRecord, upsertDailyRecord, type DailyRecord } from "../src/daily-records";
import { boundaryKeyFor, cloneChecklistStore, createDefaultChecklistStore, reminderIdFor, type ChecklistStore } from "../src/checklist";

function localDateKey(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clock(minutesFromNow: number): string {
    const at = new Date(Date.now() + minutesFromNow * 60_000);
    return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** 与「今天」匹配的日期类型：周末会选周六／周日模板，边界提醒只有工作日才有。 */
function todayDayType(): string {
    const weekday = new Date().getDay();
    return weekday === 6 ? "saturday-reset" : weekday === 0 ? "sunday-half-day" : "research-workday";
}

/**
 * 把"现在"钉在本地时间 14:00（见 beforeEach），两条提醒就是固定的 −32 / +28 分钟：
 * 既不会跨午夜，也不会落进「整天开始后 3 小时内的过去时刻算今天」那条兼容分支。
 *
 * 之前直接用真实时钟摆放（`clock(-32)` / `clock(28)`），23:32 之后 +28 会跨到第二天，
 * 而面板按当天判断会正确地排除它——断言于是在午夜窗口必然失败，与产品行为无关。
 */
const FIXED_NOW = new Date(2026, 8, 21, 14, 0, 0, 0);
const OVERDUE_MINUTES = -32;
const SOON_MINUTES = 28;

/**
 * 只保留两条自己造的边界提醒，时间相对「现在」摆放，保证任何时刻、任何星期、任何时区运行都成立：
 * 一条已过（逾期），一条即将到来（同一天内）。用空模板而不是默认模板，
 * 是为了彻底避免与默认边界时间（鱼油 08:45／12:10／18:00 等）在时钟上撞车。
 */
function checklistWithBoundaries(): { store: ChecklistStore; overdueKey: string; soonKey: string } {
    const store = createDefaultChecklistStore(1000);
    const templateId = new Date().getDay() === 6 ? "saturday" : new Date().getDay() === 0 ? "sunday" : "workday";
    const template = store.templates.find((candidate) => candidate.id === templateId);
    if (!template) throw new Error(`缺少模板：${templateId}`);
    const reminder = (id: string, title: string, index: number, minutesFromNow: number, text: string) => {
        const reminders = Array.from({ length: index + 1 }, (_, position) => ({
            id: reminderIdFor(id, position),
            text: position === index ? text : `占位提醒 ${position + 1}`,
        }));
        return {
            id,
            time: "—",
            title,
            reminders,
            tone: "plain" as const,
            boundaries: { [boundaryKeyFor(id, reminderIdFor(id, index))]: clock(minutesFromNow) },
        };
    };
    const overdue = reminder("bd-overdue", "下班收尾仪式", 0, OVERDUE_MINUTES, "提醒响起立即停，不做“最后一点”");
    const soon = reminder("bd-soon", "准备明天", 1, SOON_MINUTES, "平光镜放进书包");
    store.templates = store.templates.map((candidate) => candidate.id === templateId
        ? { ...candidate, subtitle: "仅用于边界提醒测试", entries: [overdue, soon] }
        : { ...candidate, entries: candidate.entries.map(({ boundaries: _boundaries, ...rest }) => rest) });
    return {
        store,
        overdueKey: boundaryKeyFor("bd-overdue", reminderIdFor("bd-overdue", 0)),
        soonKey: boundaryKeyFor("bd-soon", reminderIdFor("bd-soon", 1)),
    };
}

describe("今日记录里的边界提醒", () => {
    let component: { $destroy(): void } | undefined;

    beforeEach(() => {
        // 只改"现在几点"，不接管定时器：Svelte 的 tick 与 waitFor 仍需真实时间
        vi.setSystemTime(FIXED_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    function mount(checklist: ChecklistStore) {
        let daily = upsertDailyRecord(createEmptyDailyStore(1000), { ...createDailyRecord(localDateKey()), dayType: todayDayType() as DailyRecord["dayType"] }, 1000);
        let current = cloneChecklistStore(checklist);
        const saveChecklist = vi.fn(async (incoming: ChecklistStore) => current = incoming);
        component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: vi.fn().mockResolvedValue(daily),
                saveDaily: vi.fn(async (record: DailyRecord) => daily = upsertDailyRecord(daily, record, 2000)),
                loadChecklist: vi.fn(async () => current),
                saveChecklist,
            },
        });
        return { saveChecklist, current: () => current };
    }

    it("按时间浮出逾期与即将到来的边界项，并给出相对时间", async () => {
        mount(checklistWithBoundaries().store);
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-boundary-panel")).not.toBeNull());
        const panel = document.querySelector(".xz-daily-boundary-panel");
        expect(panel?.querySelector("header strong")?.textContent).toBe("现在要确认的 2 件事");
        const items = [...panel!.querySelectorAll(".xz-boundary-item")];
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toContain("下班收尾仪式");
        expect(items[0].textContent).toContain("该做了 · 已过 32 分钟");
        expect(items[0].classList.contains("is-overdue")).toBe(true);
        expect(items[1].textContent).toContain("平光镜放进书包");
        expect(items[1].textContent).toContain("28 分钟后");
        expect(items[1].classList.contains("is-soon")).toBe(true);
    });

    it("点「已做」写入 checklist 当日状态，并立即变成已确认", async () => {
        const fixture = checklistWithBoundaries();
        const harness = mount(fixture.store);
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-boundary-panel")).not.toBeNull());
        const confirm = document.querySelector<HTMLButtonElement>(".xz-boundary-item.is-overdue .xz-boundary-item__done");
        confirm?.click();
        await vi.waitFor(() => expect(harness.saveChecklist).toHaveBeenCalledTimes(1));
        const saved = harness.saveChecklist.mock.calls[0][0] as ChecklistStore;
        expect(saved.dayStates.find((state) => state.date === localDateKey())?.reminderStates).toMatchObject({ [fixture.overdueKey]: "completed" });
        expect(saved.revision).toBeGreaterThan(1);
        await tick();
        // 确认后该项从「待确认」移到「已完成」，标题随之减少一件（此时只剩那条"即将到来"）
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-boundary-panel > header strong")?.textContent).toBe("现在要确认的 1 件事"));
        expect(document.querySelector(".xz-boundary-item.is-done")?.textContent).toContain("下班收尾仪式");
        expect(document.querySelector(".xz-boundary-item.is-done")?.textContent).toContain("✓ 已确认");
    });

    it("再点一次可撤销确认", async () => {
        const fixture = checklistWithBoundaries();
        const harness = mount(fixture.store);
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-boundary-panel")).not.toBeNull());
        document.querySelector<HTMLButtonElement>(".xz-boundary-item.is-overdue .xz-boundary-item__done")?.click();
        await vi.waitFor(() => expect(document.querySelector(".xz-boundary-item.is-done")).not.toBeNull());
        document.querySelector<HTMLButtonElement>(".xz-boundary-item.is-done .xz-boundary-item__done")?.click();
        await vi.waitFor(() => expect(harness.saveChecklist).toHaveBeenCalledTimes(2));
        const saved = harness.saveChecklist.mock.calls[1][0] as ChecklistStore;
        expect(saved.dayStates.find((state) => state.date === localDateKey())?.reminderStates?.[fixture.overdueKey]).toBeUndefined();
        await vi.waitFor(() => expect(document.querySelector(".xz-boundary-item.is-overdue")).not.toBeNull());
    });

    it("点「去 Checklist 看今天」切到 Checklist 视图，并看到同一条勾选状态", async () => {
        const harness = mount(checklistWithBoundaries().store);
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-boundary-panel")).not.toBeNull());
        document.querySelector<HTMLButtonElement>(".xz-boundary-item.is-overdue .xz-boundary-item__done")?.click();
        await vi.waitFor(() => expect(harness.saveChecklist).toHaveBeenCalledTimes(1));

        const link = [...document.querySelectorAll<HTMLButtonElement>(".xz-boundary-link")][0];
        link.click();
        await vi.waitFor(() => expect(document.querySelector(".xz-checklist-page")).not.toBeNull());
        await vi.waitFor(() => {
            const title = [...document.querySelectorAll(".xz-checklist-native-title strong")].find((node) => node.textContent === "下班收尾仪式");
            const row = title?.closest(".xz-checklist-native-entry");
            expect(row?.querySelector<HTMLSelectElement>(".xz-checklist-state-select")?.value).toBe("completed");
        });
    });

    it("没有配置边界提醒时不占用今日记录的版面", async () => {
        const bare = createDefaultChecklistStore(1000);
        for (const template of bare.templates) for (const entry of template.entries) delete entry.boundaries;

        mount(bare);
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-context select")).not.toBeNull());
        await tick();
        expect(document.querySelector(".xz-daily-boundary-panel")).toBeNull();
    });
});
