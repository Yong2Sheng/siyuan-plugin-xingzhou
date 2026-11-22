import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import DailyRhythm from "../src/DailyRhythm.svelte";
import { createDefaultChecklistStore, type ChecklistStore } from "../src/checklist";
import { createDailyRecord, createEmptyDailyStore, upsertDailyRecord, type DailyRecord } from "../src/daily-records";

function localDateKey(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("今日记录右栏：大肥鱼固定，评分规则按阶段接在下面", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    function mount() {
        let daily = upsertDailyRecord(createEmptyDailyStore(1000), createDailyRecord(localDateKey()), 1000);
        let checklist: ChecklistStore = createDefaultChecklistStore(1000);
        const saveDaily = vi.fn(async (record: DailyRecord) => (daily = upsertDailyRecord(daily, record, 2000)));
        const saveChecklist = vi.fn(async (next: ChecklistStore) => (checklist = next));
        component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: async () => daily,
                saveDaily,
                loadChecklist: async () => checklist,
                saveChecklist,
            },
        });
        return { saveDaily, saveChecklist };
    }

    function stageButton(label: string): HTMLButtonElement | undefined {
        return [...document.querySelectorAll<HTMLButtonElement>(".xz-daily-stage-nav button")]
            .find((button) => button.textContent?.trim() === label);
    }

    async function switchStage(label: string) {
        stageButton(label)?.click();
        await tick();
    }

    it("右栏始终有大肥鱼说；有评分字段的阶段把评分规则接在它下面", async () => {
        mount();
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-layout")).not.toBeNull());
        const right = document.querySelector(".xz-daily-right");
        expect(right).not.toBeNull();
        expect(document.querySelector(".xz-daily-idle-column")).not.toBeNull();
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-rubric-card")).not.toBeNull());

        // 大肥鱼在评分规则前面：同一个右栏、固定顺序
        const idle = document.querySelector(".xz-daily-idle-column");
        const rubric = document.querySelector(".xz-daily-rubric-card");
        expect(right?.contains(idle)).toBe(true);
        expect(right?.contains(rubric)).toBe(true);
        expect(idle!.compareDocumentPosition(rubric!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        await switchStage("午饭后");
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-rubric-card")).toBeNull());
        expect(document.querySelector(".xz-daily-idle-column")).not.toBeNull();
        expect(document.querySelector(".xz-daily-idle-line")?.textContent?.trim().length ?? 0).toBeGreaterThan(0);

        await switchStage("下班");
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-rubric-card")).not.toBeNull());
        expect(document.querySelector(".xz-daily-idle-column")).not.toBeNull();

        await switchStage("下班后");
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-rubric-card")).toBeNull());
        await switchStage("21:00");
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-rubric-card")).toBeNull());

        await switchStage("全部");
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-rubric-card")).not.toBeNull());
        expect(document.querySelector(".xz-daily-idle-column")).not.toBeNull();
    });

    it("「再说一条」和戳表情包不会写每日记录或 Checklist", async () => {
        const spies = mount();
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-layout")).not.toBeNull());
        await switchStage("午饭后");
        await vi.waitFor(() => expect(document.querySelector(".xz-daily-idle-column")).not.toBeNull());

        const savesBefore = spies.saveDaily.mock.calls.length + spies.saveChecklist.mock.calls.length;
        const firstLine = document.querySelector(".xz-daily-idle-line")?.textContent;
        document.querySelector<HTMLButtonElement>(".xz-daily-idle-more")?.click();
        await tick();
        expect(document.querySelector(".xz-daily-idle-line")?.textContent).not.toBe(firstLine);

        document.querySelector<HTMLButtonElement>(".xz-daily-idle-sticker")?.click();
        await tick();
        expect(document.querySelector(".xz-daily-idle-note")?.textContent).toContain("大肥鱼：");

        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(spies.saveDaily.mock.calls.length + spies.saveChecklist.mock.calls.length).toBe(savesBefore);
    });
});
