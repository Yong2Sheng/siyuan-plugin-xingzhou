import { afterEach, describe, expect, it, vi } from "vitest";
import XingzhouApp from "../src/XingzhouApp.svelte";

describe("XingzhouApp", () => {
    let component: XingzhouApp | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    it("挂载后立即显示界面骨架", () => {
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue({
                    attributeViewId: "av-id",
                    attributeViewName: "测试数据库",
                    viewId: "all-view",
                    items: [],
                    missingFields: [],
                }),
                openDocument: vi.fn(),
                openDatabase: vi.fn(),
            },
        });

        expect(document.body.textContent).toContain("行舟");
        expect(document.body.textContent).toContain("正在读取个人项目数据库");
    });
});
