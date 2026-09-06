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

    it("两种视图共享勾选状态，并保存显示偏好", async () => {
        let store = createDefaultChecklistStore(1000);
        const saveChecklist = vi.fn(async (incoming: ChecklistStore) => store = incoming);
        component = new DailyChecklist({
            target: document.body,
            props: { date: "2026-09-04", loadChecklist: async () => store, saveChecklist },
        });
        await tick();
        await vi.waitFor(() => expect(document.querySelector(".xz-checklist-native-list")).not.toBeNull());
        const firstCheck = document.querySelector('.xz-checklist-native-reminders input[type="checkbox"]') as HTMLInputElement;
        firstCheck.click();
        await tick();
        expect(document.querySelector(".xz-checklist-summary")?.textContent).toContain("1 /");

        clickButton("纸质视图");
        await vi.waitFor(() => expect(document.querySelector(".xz-checklist-paper")).not.toBeNull());
        expect(saveChecklist).toHaveBeenCalled();
        expect(document.querySelector(".xz-checklist-paper-layout > .xz-checklist-summary")).not.toBeNull();
        expect(document.querySelector('.xz-checklist-paper input[type="checkbox"]:checked')).not.toBeNull();
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
});

function clickButton(label: string): void {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label) as HTMLButtonElement | undefined;
    if (!button) throw new Error(`没有找到按钮：${label}`);
    button.click();
}
