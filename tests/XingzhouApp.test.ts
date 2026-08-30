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
                deleteItem: vi.fn(),
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
                deleteItem: vi.fn(),
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

    it("提供全局快速记录，并能在长期领域下上下文创建顶层项目", async () => {
        const domain = {
            id: "domain", rowId: "domain", title: "写小说", documentId: null, detached: true,
            type: "长期领域", status: "重点投入", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: null, noDeadline: false, durationMinutes: null, energy: "", updatedAt: Date.now(),
        };
        const baseData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [domain], missingFields: [], fields: {},
        };
        const project = {
            ...domain, id: "project", rowId: "project", title: "完成第一卷", type: "项目", status: "收件箱", parentIds: [domain.id],
        };
        const captureInbox = vi.fn()
            .mockResolvedValueOnce(baseData)
            .mockResolvedValueOnce({ ...baseData, items: [domain, project] });
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(() => new Promise<never>(() => undefined)), captureInbox, saveItem: vi.fn(), deleteItem: vi.fn(),
                openDocument: vi.fn(), openDatabase: vi.fn(),
            },
        });

        (document.querySelector(".xz-global-capture-button") as HTMLButtonElement).click();
        await tick();
        let input = document.querySelector("#xz-quick-capture-input") as HTMLInputElement;
        input.value = "随手记下的想法";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        (document.querySelector(".xz-quick-capture-dialog form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(captureInbox).toHaveBeenNthCalledWith(1, "随手记下的想法", undefined));
        await vi.waitFor(() => expect(document.querySelector(".xz-add-child-button"), document.body.innerHTML).not.toBeNull());

        (document.querySelector(".xz-add-child-button") as HTMLButtonElement).click();
        await tick();
        expect(document.querySelector(".xz-quick-capture-dialog")?.textContent).toContain("添加到“写小说”");
        input = document.querySelector("#xz-quick-capture-input") as HTMLInputElement;
        input.value = "完成第一卷";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        (document.querySelector(".xz-quick-capture-dialog form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(captureInbox).toHaveBeenNthCalledWith(2, "完成第一卷", {
            type: "项目", parentId: "domain", topProjectId: "",
        }));
        await vi.waitFor(() => expect(document.querySelector(".xz-tree-row.selected")?.textContent).toContain("完成第一卷"));
    });

    it("从收件箱查看独立条目时精确高亮，并允许直接编辑数据库字段", async () => {
        const item = {
            id: "item-1", rowId: "item-1", title: "清理房间中的垃圾", documentId: null, detached: true,
            type: "事务", status: "收件箱", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: Date.now(), deadline: Date.now() - 2 * 24 * 60 * 60 * 1000, noDeadline: false, durationMinutes: null, energy: "", updatedAt: Date.now(),
        };
        const workItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [item], missingFields: ["本次行动细则"],
            fields: {
                title: { id: "title", name: "工作项", type: "block", options: [] },
                type: { id: "type", name: "工作项类型", type: "select", options: [{ name: "事务" }] },
                status: { id: "status", name: "状态", type: "select", options: [{ name: "收件箱" }, { name: "待开始" }] },
                nextAction: { id: "next", name: "下一步行动", type: "text", options: [] },
                parent: { id: "parent", name: "上层工作项", type: "relation", options: [] },
                topProject: { id: "top", name: "所属顶层项目", type: "relation", options: [] },
                planDate: { id: "plan", name: "计划日期", type: "date", options: [] },
                deadline: { id: "deadline", name: "截止日期", type: "date", options: [] },
                noDeadline: { id: "no-deadline", name: "无截止日期", type: "checkbox", options: [] },
                duration: { id: "duration", name: "预计时长（分钟）", type: "number", options: [] },
                energy: { id: "energy", name: "所需精力", type: "select", options: [{ name: "低" }] },
            },
        };
        const saveItem = vi.fn().mockResolvedValue(workItemData);
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(() => new Promise<never>(() => undefined)),
                captureInbox: vi.fn().mockResolvedValue(workItemData), saveItem, deleteItem: vi.fn(), openDocument: vi.fn(), openDatabase: vi.fn(),
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
        expect(document.querySelector(".xz-date-hint--today")?.textContent).toBe("今日");
        expect(document.querySelector(".xz-date-hint--overdue")?.textContent).toBe("已逾期");
        expect(document.querySelector(".xz-detail-header-actions .xz-tag--today")).toBeNull();

        saveItem.mockClear();
        (document.querySelector(".xz-complete-button") as HTMLButtonElement).click();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalled());
        expect(saveItem.mock.calls[0][2]).toEqual({ status: "已完成" });

        expect((document.querySelector(".xz-inline-title") as HTMLInputElement).value).toBe("清理房间中的垃圾");
        expect(document.querySelectorAll(".xz-meta-grid--editable select")).toHaveLength(5);
        expect(document.querySelector(".xz-detail-header select")).toBeNull();
        const statusSelect = document.querySelector(".xz-meta-status-select") as HTMLSelectElement;
        expect([...statusSelect.options].map((option) => option.value)).toContain("已计划");
        expect([...statusSelect.options].map((option) => option.value)).not.toContain("规划中");

        expect([...document.querySelectorAll("button")].find((button) => button.textContent?.includes("编辑行动内容"))).toBeUndefined();
        expect(document.body.textContent).toContain("当前数据库尚无此字段");
        const nextActionCard = [...document.querySelectorAll<HTMLElement>(".xz-action-card")]
            .find((card) => card.querySelector("h3")?.textContent === "下一步行动") as HTMLElement;
        nextActionCard.click();
        await tick();
        let actionEditor = document.querySelector('textarea[aria-label="下一步行动"]') as HTMLTextAreaElement;
        expect(actionEditor).toBeInstanceOf(HTMLTextAreaElement);
        expect(document.activeElement).toBe(actionEditor);

        saveItem.mockClear();
        actionEditor.value = "这次输入需要取消";
        actionEditor.dispatchEvent(new Event("input", { bubbles: true }));
        actionEditor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await tick();
        expect(document.querySelector('textarea[aria-label="下一步行动"]')).toBeNull();
        expect(saveItem).not.toHaveBeenCalled();

        nextActionCard.click();
        await tick();
        actionEditor = document.querySelector('textarea[aria-label="下一步行动"]') as HTMLTextAreaElement;
        actionEditor.value = "把垃圾装袋并带到楼下";
        actionEditor.dispatchEvent(new Event("input", { bubbles: true }));
        actionEditor.blur();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalled());
        expect(saveItem.mock.calls[0][2]).toEqual({ nextAction: "把垃圾装袋并带到楼下" });

        saveItem.mockClear();
        ([...document.querySelectorAll<HTMLElement>(".xz-action-card")].find((card) => card.querySelector("h3")?.textContent === "下一步行动") as HTMLElement).click();
        await tick();
        actionEditor = document.querySelector('textarea[aria-label="下一步行动"]') as HTMLTextAreaElement;
        actionEditor.value = "快捷键保存的下一步";
        actionEditor.dispatchEvent(new Event("input", { bubbles: true }));
        actionEditor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalled());
        expect(saveItem.mock.calls[0][2]).toEqual({ nextAction: "快捷键保存的下一步" });

        saveItem.mockClear();
        const planDate = document.querySelector('.xz-meta-grid--editable input[type="date"]') as HTMLInputElement;
        planDate.value = "2026-09-01";
        planDate.dispatchEvent(new Event("input", { bubbles: true }));
        planDate.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalled());
        expect(saveItem.mock.calls[0][2]).toMatchObject({ planDate: "2026-09-01", status: "已计划" });

        saveItem.mockClear();
        const deadlineMode = document.querySelector('select[aria-label="截止日期设置"]') as HTMLSelectElement;
        deadlineMode.value = "none";
        deadlineMode.dispatchEvent(new Event("change", { bubbles: true }));
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalled());
        expect(saveItem.mock.calls[0][2]).toEqual({ deadline: null, noDeadline: true });
    });

    it("本周页按实际日期分组，并能把待安排条目分配到某一天", async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const scheduled = {
            id: "scheduled", rowId: "scheduled", title: "今天处理合同", documentId: null, detached: true,
            type: "事务", status: "已计划", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: today.getTime(), deadline: null, noDeadline: true, durationMinutes: 30, energy: "低", updatedAt: Date.now(),
        };
        const unscheduled = {
            ...scheduled, id: "unscheduled", rowId: "unscheduled", title: "整理书架", status: "待开始", planDate: null,
        };
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const activeWindow = {
            ...scheduled, id: "window", rowId: "window", title: "办理有效期内的事务", planDate: yesterday.getTime(), deadline: tomorrow.getTime(),
        };
        const unscheduledProject = {
            ...unscheduled, id: "project", rowId: "project", title: "不应进入待安排的项目", type: "项目",
        };
        const completed = {
            ...scheduled, id: "completed-week", rowId: "completed-week", title: "本周已完成的事务", status: "已完成",
        };
        const workItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [scheduled, unscheduled, activeWindow, unscheduledProject, completed], missingFields: [],
            fields: {
                title: { id: "title", name: "工作项", type: "block", options: [] },
                status: { id: "status", name: "状态", type: "select", options: [{ name: "已计划" }] },
                planDate: { id: "plan", name: "计划日期", type: "date", options: [] },
            },
        };
        const saveItem = vi.fn().mockResolvedValue(workItemData);
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(() => new Promise<never>(() => undefined)),
                captureInbox: vi.fn().mockResolvedValue(workItemData), saveItem, deleteItem: vi.fn(), openDocument: vi.fn(), openDatabase: vi.fn(),
            },
        });
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "收件箱")?.click();
        await tick();
        const input = document.querySelector("#xz-inbox-input") as HTMLInputElement;
        input.value = "初始化测试数据";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();
        (document.querySelector(".xz-capture-card") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(document.body.textContent).toContain("已加入收件箱：初始化测试数据"));

        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "本周")?.click();
        await tick();
        expect(document.body.textContent).toContain("周一");
        expect(document.body.textContent).toContain("周日");
        expect(document.querySelector(".xz-week-board")?.textContent).toContain("今天处理合同");
        expect(document.querySelector(".xz-week-board")?.textContent).not.toContain("本周已完成的事务");
        expect(document.querySelector(".xz-week-backlog")?.textContent).toContain("整理书架");
        expect(document.querySelector(".xz-week-backlog")?.textContent).toContain("办理有效期内的事务");
        expect(document.querySelector(".xz-week-backlog")?.textContent).not.toContain("不应进入待安排的项目");

        const assignment = document.querySelector('select[aria-label="安排“整理书架”"]') as HTMLSelectElement;
        const targetDate = assignment.options[1].value;
        assignment.value = targetDate;
        assignment.dispatchEvent(new Event("change", { bubbles: true }));
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalled());
        expect(saveItem.mock.calls[0][2]).toEqual({ planDate: targetDate, status: "已计划" });
    });

    it("在任意工作项入口右键可安全删除数据库行，并提示保留下级与关联文档", async () => {
        const domain = {
            id: "domain", rowId: "row-domain", title: "写小说", documentId: "domain-doc", detached: false,
            type: "长期领域", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: null, noDeadline: false, durationMinutes: null, energy: "", updatedAt: Date.now(),
        };
        const child = {
            ...domain, id: "child", rowId: "row-child", title: "世界观构建", documentId: null, detached: true,
            type: "项目", parentIds: [domain.id], topProjectIds: [domain.id],
        };
        const workItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [domain, child], missingFields: [], fields: {},
        };
        const deleteItem = vi.fn().mockResolvedValue({ ...workItemData, items: [child] });
        const openItemMenu = vi.fn((_event: MouseEvent, onDelete: () => void) => onDelete());
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(() => new Promise<never>(() => undefined)), captureInbox: vi.fn().mockResolvedValue(workItemData), saveItem: vi.fn(), deleteItem, openItemMenu,
                openDocument: vi.fn(), openDatabase: vi.fn(),
            },
        });

        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "收件箱")?.click();
        await tick();
        const input = document.querySelector("#xz-inbox-input") as HTMLInputElement;
        input.value = "初始化删除测试";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();
        (document.querySelector(".xz-capture-card") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(document.body.textContent).toContain("已加入收件箱：初始化删除测试"));
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "全部")?.click();
        await tick();
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="domain"]'), document.body.innerHTML).not.toBeNull());
        const detail = document.querySelector(".xz-detail") as HTMLElement;
        expect(detail.querySelector(".xz-detail-role")?.textContent).toBe("长期领域");
        expect(detail.textContent).toContain("投入状态");
        expect(detail.textContent).toContain("领域说明／当前关注方向");
        expect(detail.textContent).not.toContain("计划日期");
        expect(detail.textContent).not.toContain("预计时长");
        expect(detail.querySelector(".xz-complete-button")).toBeNull();
        (document.querySelector('[data-work-item-id="domain"]') as HTMLElement).dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true, cancelable: true, clientX: 120, clientY: 160,
        }));
        await tick();
        expect(openItemMenu).toHaveBeenCalledOnce();
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain("关联的思源文档不会被删除");
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain("1 个下级工作项");
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain("1 个工作项把它设为所属顶层项目");

        ([...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "确认删除") as HTMLButtonElement).click();
        await vi.waitFor(() => expect(deleteItem).toHaveBeenCalledWith(workItemData, domain));
        await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    });

    it("整理页根据真实数据生成周度检查，并能跳转到问题条目", async () => {
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        const base = {
            id: "base", rowId: "base", title: "基础条目", documentId: null, detached: true,
            type: "事务", status: "待开始", currentAction: "已有行动", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: null, noDeadline: true, durationMinutes: 30, energy: "低", updatedAt: now,
        };
        const domain = { ...base, id: "domain", rowId: "domain", title: "创作", type: "长期领域", status: "进行中" };
        const projects = [1, 2, 3, 4].map((number) => ({
            ...base, id: `project-${number}`, rowId: `project-${number}`, title: `活跃项目 ${number}`, type: "项目", status: "进行中", parentIds: ["domain"],
        }));
        const inbox = { ...base, id: "inbox", rowId: "inbox", title: "需要归类的想法", type: "想法", status: "收件箱", currentAction: "" };
        const overdue = { ...base, id: "overdue", rowId: "overdue", title: "需要重新安排的事务", status: "已计划", currentAction: "", planDate: now - 3 * day, deadline: now - day };
        const completed = { ...base, id: "completed", rowId: "completed", title: "本周完成的事务", status: "已完成" };
        const workItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [domain, ...projects, inbox, overdue, completed], missingFields: [],
            fields: {
                title: { id: "title", name: "工作项", type: "block", options: [] },
                currentAction: { id: "current", name: "本次行动细则", type: "text", options: [] },
                nextAction: { id: "next", name: "下一步行动", type: "text", options: [] },
            },
        };
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(() => new Promise<never>(() => undefined)),
                captureInbox: vi.fn().mockResolvedValue(workItemData), saveItem: vi.fn(), deleteItem: vi.fn(), openDocument: vi.fn(), openDatabase: vi.fn(),
            },
        });
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "收件箱")?.click();
        await tick();
        const input = document.querySelector("#xz-inbox-input") as HTMLInputElement;
        input.value = "初始化整理数据";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();
        (document.querySelector(".xz-capture-card") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(document.body.textContent).toContain("已加入收件箱：初始化整理数据"));

        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "整理")?.click();
        await tick();
        expect(document.body.textContent).toContain("每周整理");
        expect(document.body.textContent).toContain("需要收敛");
        expect(document.body.textContent).toContain("需要归类的想法");
        expect(document.body.textContent).toContain("需要重新安排的事务");
        expect(document.body.textContent).toContain("本周完成的事务");
        expect(document.querySelector(".xz-review-item-overdue")?.textContent).toContain("截止日期已过");
        expect([...document.querySelectorAll<HTMLButtonElement>(".xz-review-item-list button")].filter((button) => button.textContent?.includes("需要重新安排的事务"))).toHaveLength(1);
        const actionStep = [...document.querySelectorAll<HTMLElement>(".xz-review-step")].find((step) => step.querySelector("h3")?.textContent === "让执行项可以直接开始");
        expect(actionStep?.classList.contains("xz-review-step--ready")).toBe(true);

        [...document.querySelectorAll<HTMLButtonElement>(".xz-review-item-list button")].find((button) => button.textContent?.includes("需要归类的想法"))?.click();
        await tick();
        expect(document.querySelector(".xz-tree-row.selected")?.textContent).toContain("需要归类的想法");
    });
});
