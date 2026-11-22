import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DailyChecklist from "../src/DailyChecklist.svelte";
import DailyRhythm from "../src/DailyRhythm.svelte";
import { boundaryKeyFor, createDefaultChecklistStore, reminderIdFor, type ChecklistStore } from "../src/checklist";
import { createDailyRecord, createEmptyDailyStore, upsertDailyRecord, type DailyRecord } from "../src/daily-records";

/** 与设计确认稿一致：2026-09-21（周一）15:20。 */
const FIXED_NOW = new Date(2026, 8, 21, 15, 20, 0, 0);

function localDateKey(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * checklist 里仍然留着边界时间。移除前，这组数据在这个时刻一定会渲染出面板：
 * 15:12 那条已逾期 8 分钟，16:30 那条是「接下来是…」的抬头。
 */
function checklistWithBoundaries(): ChecklistStore {
    const store = createDefaultChecklistStore(1000);
    const workday = store.templates.find((template) => template.id === "workday");
    if (!workday) throw new Error("缺少工作日模板");
    const key = (entryId: string, index: number) => boundaryKeyFor(entryId, reminderIdFor(entryId, index));
    const set = (entryId: string, index: number, at: string) => {
        const item = workday.entries.find((candidate) => candidate.id === entryId);
        if (!item) throw new Error(`缺少条目 ${entryId}`);
        item.boundaries = { ...(item.boundaries ?? {}), [key(entryId, index)]: at };
    };
    set("wd-wake", 0, "06:00");
    set("wd-lunch", 1, "15:12");
    set("wd-shutdown", 0, "16:30");
    return store;
}

/** 边界时间数据的可比较快照：只关心「哪条提醒 → 哪个时刻」，顺序无关。 */
function boundariesOf(store: ChecklistStore): string {
    const workday = store.templates.find((template) => template.id === "workday");
    const pairs = (workday?.entries ?? [])
        .flatMap((item) => Object.entries(item.boundaries ?? {}).map(([key, at]) => `${key}=${at}`))
        .sort();
    return pairs.join("\n");
}

describe("边界提醒移除后", () => {
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

    it("今日记录不再出现边界提醒面板（即使 checklist 里仍然留着边界时间）", async () => {
        let checklist = checklistWithBoundaries();
        let daily = upsertDailyRecord(createEmptyDailyStore(1000), createDailyRecord(localDateKey()), 1000);
        component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: async () => daily,
                saveDaily: async (record: DailyRecord) => (daily = upsertDailyRecord(daily, record, 2000)),
                loadChecklist: async () => checklist,
                saveChecklist: async (next: ChecklistStore) => (checklist = next),
            },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-layout")).not.toBeNull());
        await tick();
        expect(document.querySelector(".xz-daily-boundary-panel")).toBeNull();
        expect(document.body.textContent).not.toContain("接下来是");
        expect(document.body.textContent).not.toContain("去 Checklist 看今天");
    });

    it("Checklist 不再有时间入口与边界角标，已有边界时间数据原样保存", async () => {
        let checklist = checklistWithBoundaries();
        const before = boundariesOf(checklist);
        component = new DailyChecklist({
            target: document.body,
            props: {
                date: "2026-09-21",
                loadChecklist: async () => checklist,
                saveChecklist: async (next: ChecklistStore) => (checklist = next),
            },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-checklist-native-list")).not.toBeNull());
        expect(document.querySelector(".xz-checklist-boundary-time")).toBeNull();

        const paperButton = [...document.querySelectorAll<HTMLButtonElement>(".xz-checklist-view-switch button")]
            .find((button) => button.textContent?.trim() === "纸质视图");
        paperButton?.click();
        await vi.waitFor(() => expect(document.querySelector(".xz-checklist-paper")).not.toBeNull());
        expect(document.querySelector(".xz-checklist-boundary-badge")).toBeNull();
        expect(document.querySelector(".xz-checklist-boundary-clear")).toBeNull();

        const stateSelect = document.querySelector<HTMLSelectElement>(".xz-checklist-paper .xz-checklist-state-select");
        expect(stateSelect).not.toBeNull();
        stateSelect!.value = "completed";
        stateSelect!.dispatchEvent(new Event("change", { bubbles: true }));
        await vi.waitFor(() => expect(checklist.dayStates.find((state) => state.date === "2026-09-21")?.reminderStates).toBeTruthy());

        // 数据层没有被移除动作破坏：用户磁盘上的边界时间仍原样保留
        expect(boundariesOf(checklist)).toBe(before);
    });
});
