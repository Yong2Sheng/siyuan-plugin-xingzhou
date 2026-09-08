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
            "wd-wake:common:0": "completed",
            "wd-wake:common:1": "partial",
            "wd-drive:common:0": "missed",
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
