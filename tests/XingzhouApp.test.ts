import { tick } from "svelte";
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
                    fields: {},
                }),
                captureInbox: vi.fn(),
                saveItem: vi.fn(),
                openDocument: vi.fn(),
                openDatabase: vi.fn(),
            },
        });

        expect(document.body.textContent).toContain("行舟");
        expect(document.body.textContent).toContain("正在读取个人项目数据库");
    });

    it("收件箱页显示真实捕获表单而不是占位说明", async () => {
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(),
                captureInbox: vi.fn(),
                saveItem: vi.fn(),
                openDocument: vi.fn(),
                openDatabase: vi.fn(),
            },
        });

        const inboxTab = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "收件箱");
        inboxTab?.click();
        await tick();

        expect(document.querySelector("#xz-inbox-input")).toBeInstanceOf(HTMLInputElement);
        expect(document.body.textContent).toContain("先记下来，之后再整理");
        expect(document.body.textContent).not.toContain("这个页面仍在规划中");
    });

    it("从收件箱查看独立条目时精确高亮，并允许直接编辑数据库字段", async () => {
        const item = {
            id: "item-1", rowId: "item-1", title: "清理房间中的垃圾", documentId: null, detached: true,
            type: "", status: "收件箱", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: Date.now() - 2 * 24 * 60 * 60 * 1000, durationMinutes: null, energy: "", updatedAt: Date.now(),
        };
        const workItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [item], missingFields: ["本次行动细则"],
            fields: {
                title: { id: "title", name: "工作项", type: "block", options: [] },
                type: { id: "type", name: "工作项类型", type: "select", options: [{ name: "事务" }] },
                status: { id: "status", name: "状态", type: "select", options: [{ name: "收件箱" }, { name: "待开始" }] },
                nextAction: { id: "next", name: "下一步行动", type: "text", options: [] },
                energy: { id: "energy", name: "所需精力", type: "select", options: [{ name: "低" }] },
            },
        };
        const saveItem = vi.fn().mockResolvedValue(workItemData);
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(() => new Promise<never>(() => undefined)),
                captureInbox: vi.fn().mockResolvedValue(workItemData), saveItem, openDocument: vi.fn(), openDatabase: vi.fn(),
            },
        });
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "收件箱")?.click();
        await tick();
        const input = document.querySelector("#xz-inbox-input") as HTMLInputElement;
        input.value = "清理房间中的垃圾";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();
        (document.querySelector(".xz-capture-card") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(document.body.textContent).toContain("查看详情"));
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "查看详情")?.click();
        await tick();

        const exactScope = [...document.querySelectorAll(".xz-sidebar .xz-scope-button")]
            .find((button) => button.textContent?.includes("清理房间中的垃圾"));
        expect(exactScope?.classList.contains("active"), document.body.textContent ?? "").toBe(true);
        expect(document.querySelector(".xz-tree-row.selected")?.textContent).toContain("清理房间中的垃圾");
        expect(document.body.textContent).toContain("这是数据库独立条目，不需要建立或关联文档");
        expect(document.querySelector(".xz-tag--overdue")?.textContent).toBe("已逾期");

        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "编辑")?.click();
        await tick();
        expect((document.querySelector(".xz-detail-form input") as HTMLInputElement).value).toBe("清理房间中的垃圾");
        expect(document.querySelector(".xz-detail-form textarea")).toBeInstanceOf(HTMLTextAreaElement);
        expect(document.body.textContent).toContain("代码已经支持，待数据库迁移后即可直接编辑");
        const statusSelect = [...document.querySelectorAll<HTMLSelectElement>(".xz-detail-form select")]
            .find((select) => [...select.options].some((option) => option.value === "已计划"));
        expect(statusSelect).toBeTruthy();
        expect([...statusSelect!.options].map((option) => option.value)).not.toContain("规划中");

        const planDate = document.querySelector('.xz-detail-form input[type="date"]') as HTMLInputElement;
        planDate.value = "2026-09-01";
        planDate.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();
        (document.querySelector(".xz-detail-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalled());
        expect(saveItem.mock.calls[0][2]).toMatchObject({ planDate: "2026-09-01", status: "已计划" });
    });
});
