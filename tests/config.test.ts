import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRIBUTE_VIEW_ID, DEFAULT_DATABASE_BLOCK_ID, normalizeSettings } from "../src/config";

describe("normalizeSettings", () => {
    it("旧设置缺少或留空数据库块 ID 时回退到已核实的默认绑定", () => {
        expect(normalizeSettings(undefined)).toEqual({
            attributeViewId: DEFAULT_ATTRIBUTE_VIEW_ID,
            databaseBlockId: DEFAULT_DATABASE_BLOCK_ID,
        });
        expect(normalizeSettings({ attributeViewId: DEFAULT_ATTRIBUTE_VIEW_ID, databaseBlockId: "  " })).toEqual({
            attributeViewId: DEFAULT_ATTRIBUTE_VIEW_ID,
            databaseBlockId: DEFAULT_DATABASE_BLOCK_ID,
        });
    });

    it("保留用户明确配置的其他绑定", () => {
        expect(normalizeSettings({ attributeViewId: "custom-av", databaseBlockId: "custom-block" })).toEqual({
            attributeViewId: "custom-av",
            databaseBlockId: "custom-block",
        });
    });
});
