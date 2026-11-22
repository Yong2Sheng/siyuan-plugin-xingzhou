import { tick } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import DailyIdleCard from "../src/DailyIdleCard.svelte";
import { IDLE_LINES, IDLE_NOTE, IDLE_STICKER_FILES } from "../src/daily-idle";

describe("右栏「大肥鱼说」卡片", () => {
    let component: { $destroy(): void } | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    function mount() {
        component = new DailyIdleCard({ target: document.body, props: { stickerBase: "./idle-stickers/" } });
        return component;
    }

    it("默认显示第一句台词与第一张表情包，表情包在标题左侧、与文字同处一张卡", async () => {
        mount();
        await tick();
        expect(document.querySelector(".xz-daily-idle-line")?.textContent).toBe(IDLE_LINES[0]);
        expect(document.querySelector(".xz-daily-idle-note")?.textContent).toBe(IDLE_NOTE);
        expect(document.querySelector(".xz-daily-idle-sticker img")?.getAttribute("src")).toBe(`./idle-stickers/${IDLE_STICKER_FILES[0]}`);

        const card = document.querySelector(".xz-daily-idle-card");
        const sticker = document.querySelector(".xz-daily-idle-sticker");
        const title = document.querySelector(".xz-daily-idle-title");
        expect(card?.contains(sticker)).toBe(true);
        expect(card?.contains(title)).toBe(true);
        // 表情包排在标题前面（DOM 顺序），实现「左图右文」
        expect(sticker!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("「再说一条」换台词、换表情包，并把脚注恢复成默认句", async () => {
        mount();
        await tick();
        document.querySelector<HTMLButtonElement>(".xz-daily-idle-more")?.click();
        await tick();
        expect(document.querySelector(".xz-daily-idle-line")?.textContent).toBe(IDLE_LINES[1]);
        expect(document.querySelector(".xz-daily-idle-note")?.textContent).toBe(IDLE_NOTE);
        expect(document.querySelector(".xz-daily-idle-sticker img")?.getAttribute("src")).toBe(`./idle-stickers/${IDLE_STICKER_FILES[1]}`);
    });

    it("戳一下表情包：脚注留下反应、不自动恢复；换一条后才恢复默认句", async () => {
        mount();
        await tick();
        document.querySelector<HTMLButtonElement>(".xz-daily-idle-sticker")?.click();
        await tick();
        const note = document.querySelector(".xz-daily-idle-note")?.textContent ?? "";
        expect(note.startsWith("大肥鱼：")).toBe(true);
        expect(document.querySelector(".xz-daily-idle-note")?.textContent).not.toBe(IDLE_NOTE);
        // 抖动的 class 只负责动画，过一会儿会复位，但脚注里的人话要留着
        await new Promise((resolve) => setTimeout(resolve, 650));
        expect(document.querySelector(".xz-daily-idle-note")?.textContent).toBe(note);
        expect(document.querySelector(".xz-daily-idle-sticker")?.classList.contains("is-poked")).toBe(false);

        document.querySelector<HTMLButtonElement>(".xz-daily-idle-more")?.click();
        await tick();
        expect(document.querySelector(".xz-daily-idle-note")?.textContent).toBe(IDLE_NOTE);
    });

    it("表情包加载失败时隐藏贴纸，不显示破图（发布版没有素材也能降级）", async () => {
        mount();
        await tick();
        const image = document.querySelector<HTMLImageElement>(".xz-daily-idle-sticker img");
        expect(image).not.toBeNull();
        image!.dispatchEvent(new Event("error"));
        await tick();
        expect(document.querySelector(".xz-daily-idle-sticker")).toBeNull();
        expect(document.querySelector(".xz-daily-idle-line")?.textContent).toBe(IDLE_LINES[0]);
    });
});
