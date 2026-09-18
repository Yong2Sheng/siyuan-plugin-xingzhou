import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRIBUTE_VIEW_ID, DEFAULT_DATABASE_BLOCK_ID, DEFAULT_SETTINGS, normalizeSettings } from "../src/config";

describe("normalizeSettings", () => {
    it("旧设置缺少或留空数据库块 ID 时回退到已核实的默认绑定", () => {
        expect(normalizeSettings(undefined)).toEqual({
            attributeViewId: DEFAULT_ATTRIBUTE_VIEW_ID,
            databaseBlockId: DEFAULT_DATABASE_BLOCK_ID,
            log: DEFAULT_SETTINGS.log,
        });
        expect(normalizeSettings({ attributeViewId: DEFAULT_ATTRIBUTE_VIEW_ID, databaseBlockId: "  " })).toEqual({
            attributeViewId: DEFAULT_ATTRIBUTE_VIEW_ID,
            databaseBlockId: DEFAULT_DATABASE_BLOCK_ID,
            log: DEFAULT_SETTINGS.log,
        });
    });

    it("保留用户明确配置的其他绑定", () => {
        expect(normalizeSettings({ attributeViewId: "custom-av", databaseBlockId: "custom-block" })).toEqual({
            attributeViewId: "custom-av",
            databaseBlockId: "custom-block",
            log: DEFAULT_SETTINGS.log,
        });
    });

    it("日志配置跟随设置持久化，非法值回落默认且不影响数据绑定", () => {
        expect(normalizeSettings({
            attributeViewId: "custom-av",
            databaseBlockId: "custom-block",
            log: { minLevel: "verbose", scopes: { store: "info", nope: "loud" }, bufferSize: 5000, allowTruncatedText: true },
        })).toEqual({
            attributeViewId: "custom-av",
            databaseBlockId: "custom-block",
            log: { minLevel: "verbose", scopes: { store: "info" }, bufferSize: 5000, allowTruncatedText: true },
        });
        expect(normalizeSettings({ log: { minLevel: "loud", bufferSize: 1 } }).log)
            .toEqual({ minLevel: "warn", scopes: {}, bufferSize: 200, allowTruncatedText: false });
    });
});
