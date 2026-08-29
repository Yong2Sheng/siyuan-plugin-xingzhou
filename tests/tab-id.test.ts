import { describe, expect, it } from "vitest";
import { getXingzhouTabId, XINGZHOU_TAB_TYPE } from "../src/tab-id";

describe("行舟自定义页签 ID", () => {
    it("与思源 addTab 的插件名加类型规则完全一致", () => {
        const pluginName = "siyuan-plugin-xingzhou";

        expect(getXingzhouTabId(pluginName)).toBe(pluginName + XINGZHOU_TAB_TYPE);
        expect(getXingzhouTabId(pluginName)).toBe("siyuan-plugin-xingzhouxingzhou-center");
    });
});
