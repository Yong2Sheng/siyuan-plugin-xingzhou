import { tick } from "svelte";
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import DailyRhythm from "../src/DailyRhythm.svelte";
import { createDailyRecord, createEmptyDailyStore, upsertDailyRecord, type DailyRecord } from "../src/daily-records";

/**
 * 界面排版核对用的导出脚本：把「真实组件渲染出来的 DOM」导出，交给 design/check-preview.mjs
 * 在真实视口（1440 / 1100 / 760 / 620）里量几何，用来在部署前拦住「控件文字乱飞」这类排版错误。
 *
 * 默认跳过，不影响 `pnpm test`；需要核对界面时运行：
 *   DUMP_DAILY_DOM=1 CI=true pnpm vitest run tests/zz-dump-daily-dom.test.ts
 *   node design/build-implemented-preview.mjs
 *   node design/check-preview.mjs http://127.0.0.1:8137/design/lights-off-implemented.html
 */
function localDateKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

describe.skipIf(process.env.DUMP_DAILY_DOM !== "1")("导出实现版 DOM", () => {
    it("dump", async () => {
        const date = localDateKey();
        let store = upsertDailyRecord(createEmptyDailyStore(1000), { ...createDailyRecord(date), dayType: "research-workday" }, 1000);
        const component = new DailyRhythm({
            target: document.body,
            props: {
                loadDaily: async () => store,
                saveDaily: async (record: DailyRecord) => store = upsertDailyRecord(store, record, 2000),
            },
        });
        await tick();
        await vi.waitFor(() => expect(document.querySelector('[aria-label="昨晚熄灯时段"]')).not.toBeNull());

        const choose = (ariaLabel: string, value: string) => {
            const select = document.querySelector(`[aria-label="${ariaLabel}"]`) as HTMLSelectElement | null;
            if (!select) throw new Error(`没有找到选择框：${ariaLabel}`);
            select.value = value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
        };
        const clickButton = (label: string) => {
            const button = [...document.querySelectorAll("button")].find((entry) => entry.textContent?.includes(label));
            if (!button) throw new Error(`没有找到按钮：${label}`);
            (button as HTMLButtonElement).click();
        };
        const states: Array<{ key: string; caption: string; html: string }> = [];
        const capture = (key: string, caption: string) => {
            const card = document.querySelector(".xz-daily-record");
            if (!card) throw new Error("没有找到记录卡");
            states.push({ key, caption, html: card.outerHTML });
        };

        capture("s1-empty", "① 未填写：时段「尚未确认」+ 空的时/分");
        choose("昨晚熄灯时段", "after-midnight");
        await tick();
        capture("s2-marker", "② 12 点后（熬夜）· 不记具体时间：控制行变成静态标记 + 填时间");
        clickButton("填时间");
        await tick();
        capture("s3-expanded", "③ 展开了时间输入但还没填（时段仍是 12 点后）");
        choose("昨晚熄灯小时", "00");
        choose("昨晚熄灯分钟", "30");
        await tick();
        capture("s4-after-time", "④ 12 点后 + 00:30：时段由时间判定，右侧出现「清空」，下拉里冲突项置灰");
        clickButton("清空");
        await tick();
        capture("s5-cleared", "⑤ 点「清空」后回到不记具体时间（时段标记保留）");
        clickButton("填时间");
        await tick();
        choose("昨晚熄灯小时", "23");
        choose("昨晚熄灯分钟", "05");
        await tick();
        capture("s6-before-time", "⑥ 12 点前 + 23:05：正常路径，与改动前一致（多一个时段下拉）");
        // 「今日是否有节奏或临时调整 = 是」：右列出现「调整内容」textarea，这一状态才看得见两列输入框贴死
        const adjustLabel = [...document.querySelectorAll("label")].find((entry) => entry.textContent?.includes("今日是否有节奏或临时调整"));
        const adjustSelect = adjustLabel?.querySelector("select") as HTMLSelectElement | null;
        if (!adjustSelect) throw new Error("没有找到节奏调整选择框");
        adjustSelect.value = "yes";
        adjustSelect.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        capture("s7-adjust-yes", "⑦ 今日是否有节奏或临时调整 = 是：右列出现「调整内容」输入框（现状下与左列大输入框贴死）");

        fs.writeFileSync("design/.implemented-dom.json", JSON.stringify({ date, states }, null, 2));
        component.$destroy();
        expect(states).toHaveLength(7);
    }, 60000);
});
