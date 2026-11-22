import { describe, expect, it } from "vitest";
import {
    IDLE_LINES,
    IDLE_POKE_REACTIONS,
    IDLE_STICKER_BASE,
    IDLE_STICKER_FILES,
    idleLineAt,
    idleReactionAt,
    idleStickerFileAt,
} from "../src/daily-idle";

describe("右栏「大肥鱼说」数据", () => {
    it("句子至少 100 条，按顺序循环，负数下标也能取到有效句子", () => {
        expect(IDLE_LINES.length).toBeGreaterThanOrEqual(100);
        expect(new Set(IDLE_LINES).size).toBe(IDLE_LINES.length);
        expect(new Set(Array.from({ length: IDLE_LINES.length }, (_, index) => idleLineAt(index))).size).toBe(IDLE_LINES.length);
        expect(idleLineAt(0)).toBe(IDLE_LINES[0]);
        expect(idleLineAt(IDLE_LINES.length)).toBe(IDLE_LINES[0]);
        expect(idleLineAt(IDLE_LINES.length + 3)).toBe(IDLE_LINES[3]);
        expect(idleLineAt(-1)).toBe(IDLE_LINES[IDLE_LINES.length - 1]);
    });

    it("戳鱼反应至少 100 条，按顺序循环", () => {
        expect(IDLE_POKE_REACTIONS.length).toBeGreaterThanOrEqual(100);
        expect(new Set(IDLE_POKE_REACTIONS).size).toBe(IDLE_POKE_REACTIONS.length);
        expect(new Set(Array.from({ length: IDLE_POKE_REACTIONS.length }, (_, index) => idleReactionAt(index))).size).toBe(IDLE_POKE_REACTIONS.length);
        expect(idleReactionAt(0)).toBe(IDLE_POKE_REACTIONS[0]);
        expect(idleReactionAt(IDLE_POKE_REACTIONS.length)).toBe(IDLE_POKE_REACTIONS[0]);
        expect(idleReactionAt(-1)).toBe(IDLE_POKE_REACTIONS[IDLE_POKE_REACTIONS.length - 1]);
    });

    it("表情包文件与素材目录对应，不超出实际存在的 10 张", () => {
        expect(IDLE_STICKER_BASE).toBe("/plugins/siyuan-plugin-xingzhou/idle-stickers/");
        expect(new Set(IDLE_STICKER_FILES).size).toBe(IDLE_STICKER_FILES.length);
        for (const file of IDLE_STICKER_FILES) expect(file).toMatch(/^\d{3}\.gif$/);
        expect(idleStickerFileAt(0)).toBe(IDLE_STICKER_FILES[0]);
        expect(idleStickerFileAt(-1)).toBe(IDLE_STICKER_FILES[IDLE_STICKER_FILES.length - 1]);
    });

});
