import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import XingzhouApp from "../src/XingzhouApp.svelte";
import type { CaptureDialogRequest } from "../src/capture-dialog";
import type { WorkItem, WorkItemChanges, WorkItemData } from "../src/work-items";

describe("XingzhouApp", () => {
    let component: XingzhouApp | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
        try { localStorage.clear(); } catch { /* jsdom 可能禁用本地存储 */ }
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
            },
        });

        expect(document.body.textContent).toContain("行舟");
        expect(document.body.textContent).toContain("正在读取行舟内部数据");
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
            },
        });

        const inboxTab = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "收件箱");
        inboxTab?.click();
        await tick();

        expect(document.querySelector("#xz-inbox-input")).toBeInstanceOf(HTMLInputElement);
        expect(document.body.textContent).toContain("先记下来，之后再整理");
        expect(document.body.textContent).not.toContain("这个页面仍在规划中");
    });

    it("提供全局快速添加，并能在长期领域下上下文创建顶层项目", async () => {
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
        const captureRequests: CaptureDialogRequest[] = [];
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(() => new Promise<never>(() => undefined)), captureInbox, saveItem: vi.fn(), deleteItem: vi.fn(),
                openDocument: vi.fn(), openCaptureDialog: (request) => captureRequests.push(request),
            },
        });

        (document.querySelector(".xz-global-capture-button") as HTMLButtonElement).click();
        expect(captureRequests[0]?.mode).toBe("global");
        await captureRequests[0].onSubmit({ title: "随手记下的想法" });
        await vi.waitFor(() => expect(captureInbox).toHaveBeenNthCalledWith(1, "随手记下的想法", undefined));
        await vi.waitFor(() => expect(document.querySelector(".xz-add-child-button"), document.body.innerHTML).not.toBeNull());

        (document.querySelector(".xz-add-child-button") as HTMLButtonElement).click();
        expect(captureRequests[1]?.mode).toBe("child");
        expect(captureRequests[1]?.parent).toMatchObject({ id: "domain", title: "写小说", type: "长期领域" });
        await captureRequests[1].onSubmit({ title: "完成第一卷", type: "项目" });
        await vi.waitFor(() => expect(captureInbox).toHaveBeenNthCalledWith(2, "完成第一卷", {
            type: "项目", status: "待开始", parentId: "domain", topProjectId: "",
        }));
        await vi.waitFor(() => expect(document.querySelector(".xz-tree-row.selected")?.textContent).toContain("完成第一卷"));
    });

    it("在当前长期领域内新增下级后保持长期领域视图", async () => {
        const domain = {
            id: "domain", rowId: "domain", title: "写小说", documentId: null, detached: true,
            type: "长期领域", status: "重点投入", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: null, noDeadline: false, durationMinutes: null, energy: "", updatedAt: Date.now(),
        };
        const project = { ...domain, id: "project", rowId: "project", title: "恶魔的尾巴", type: "项目", status: "进行中", parentIds: [domain.id] };
        const child = { ...domain, id: "child", rowId: "child", title: "世界观构建", type: "项目", status: "收件箱", parentIds: [project.id], topProjectIds: [project.id] };
        const baseData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [domain, project], missingFields: [], fields: {},
        };
        const captureRequests: CaptureDialogRequest[] = [];
        const captureInbox = vi.fn()
            .mockResolvedValueOnce(baseData)
            .mockResolvedValueOnce({ ...baseData, items: [domain, project, child] });
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(() => new Promise<never>(() => undefined)), captureInbox,
                saveItem: vi.fn(), deleteItem: vi.fn(), openDocument: vi.fn(),
                openCaptureDialog: (request) => captureRequests.push(request),
            },
        });
        (document.querySelector(".xz-global-capture-button") as HTMLButtonElement).click();
        await captureRequests[0].onSubmit({ title: "初始化长期领域视图" });
        await vi.waitFor(() => expect(
            document.querySelector('.xz-sidebar-group--areas [data-work-item-id="domain"]'),
            document.body.innerHTML,
        ).not.toBeNull());

        (document.querySelector('.xz-sidebar-group--areas [data-work-item-id="domain"]') as HTMLButtonElement).click();
        await tick();
        (document.querySelector('.xz-tree-node[data-work-item-id="project"] .xz-tree-main') as HTMLButtonElement).click();
        await tick();
        (document.querySelector(".xz-add-child-button") as HTMLButtonElement).click();
        expect(captureRequests[1]?.parent).toMatchObject({ id: "project", title: "恶魔的尾巴" });
        await captureRequests[1].onSubmit({ title: "世界观构建", type: "项目" });
        await tick();

        expect(document.querySelector('.xz-sidebar-group--areas [data-work-item-id="domain"]')?.classList.contains("active")).toBe(true);
        expect(document.querySelector(".xz-tree-row.selected")?.textContent).toContain("世界观构建");
        expect(document.querySelector('.xz-tree-row.selected .xz-role-badge[data-role="subproject"]')?.textContent).toBe("子项目");
        expect(document.querySelector('.xz-detail-role-row .xz-role-badge[data-role="subproject"]')?.textContent).toBe("子项目");
        expect(document.querySelectorAll(".xz-role-legend .xz-role-badge")).toHaveLength(6);
        expect(document.querySelector(".xz-type-dot")).toBeNull();
    });

    it("侧栏按领域与想法、顶层项目和独立事务分组，全部筛选完整展开层级", async () => {
        const base = {
            id: "domain", rowId: "domain", title: "写小说", documentId: null, detached: true,
            type: "长期领域", status: "重点投入", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: null, noDeadline: false, durationMinutes: null, energy: "", updatedAt: Date.now(),
        };
        const idea = { ...base, id: "idea", rowId: "idea", title: "尝试短篇叙事", type: "想法", status: "将来" };
        const project = { ...base, id: "project", rowId: "project", title: "完成第一卷", type: "项目", status: "进行中", parentIds: [base.id] };
        const subproject = { ...base, id: "subproject", rowId: "subproject", title: "整理世界观", type: "项目", status: "暂停", parentIds: [project.id], topProjectIds: [project.id] };
        const transaction = { ...base, id: "transaction", rowId: "transaction", title: "绘制贸易路线", type: "事务", status: "待开始", parentIds: [subproject.id], topProjectIds: [project.id] };
        const independent = { ...base, id: "independent", rowId: "independent", title: "签署租房合同", type: "事务", status: "待开始" };
        const completedIndependent = { ...base, id: "completed-independent", rowId: "completed-independent", title: "已经完成的独立事务", type: "事务", status: "已完成" };
        const workItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [base, idea, project, subproject, transaction, independent, completedIndependent], missingFields: [], fields: {},
        };
        const captureInbox = vi.fn().mockResolvedValue(workItemData);
        const captureRequests: CaptureDialogRequest[] = [];
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(() => new Promise<never>(() => undefined)), captureInbox,
                saveItem: vi.fn(), deleteItem: vi.fn(), openDocument: vi.fn(),
                openCaptureDialog: (request) => captureRequests.push(request),
            },
        });
        (document.querySelector(".xz-global-capture-button") as HTMLButtonElement).click();
        await captureRequests[0].onSubmit({ title: "初始化侧栏测试" });
        await vi.waitFor(() => expect(document.querySelector(".xz-sidebar")).not.toBeNull());

        const sidebar = document.querySelector(".xz-sidebar") as HTMLElement;
        expect(sidebar.textContent).toContain("长期领域与想法");
        expect(sidebar.textContent).toContain("顶层项目");
        expect(sidebar.textContent).toContain("独立事务");
        expect(sidebar.textContent).not.toContain("全部领域与工作项");
        expect(sidebar.querySelector(".xz-sidebar-group--areas")?.textContent).toContain("尝试短篇叙事");
        expect(sidebar.querySelector(".xz-sidebar-group--projects")?.textContent).toContain("完成第一卷");
        expect(sidebar.querySelector(".xz-sidebar-group--transactions")?.textContent).toContain("签署租房合同");
        expect(sidebar.textContent).not.toContain("已经完成的独立事务");
        const includeClosed = document.querySelector(".xz-include-closed-toggle") as HTMLButtonElement;
        expect(includeClosed.getAttribute("aria-pressed")).toBe("false");
        includeClosed.click();
        await tick();
        expect(sidebar.textContent).toContain("已经完成的独立事务");
        expect(includeClosed.getAttribute("aria-pressed")).toBe("true");
        expect(sidebar.querySelectorAll(".xz-sidebar-group-actions button")).toHaveLength(3);
        expect(document.querySelector(".xz-tree-scroll")?.textContent).toContain("绘制贸易路线");

        (sidebar.querySelector('button[aria-label="添加顶层项目"]') as HTMLButtonElement).click();
        expect(captureRequests[1]?.mode).toBe("topProject");
        expect(captureRequests[1]?.areas).toEqual([{ id: "domain", title: "写小说", type: "长期领域" }]);
        await captureRequests[1].onSubmit({ title: "准备第二卷", areaId: "domain" });
        await vi.waitFor(() => expect(captureInbox).toHaveBeenNthCalledWith(2, "准备第二卷", {
            type: "项目", status: "待开始", parentId: "domain",
        }));

        (sidebar.querySelector('[data-work-item-id="project"]') as HTMLButtonElement).click();
        await tick();
        expect(document.querySelector(".xz-tree-scroll")?.textContent).toContain("整理世界观");
        expect(document.querySelector(".xz-tree-scroll")?.textContent).not.toContain("签署租房合同");

        [...document.querySelectorAll<HTMLButtonElement>(".xz-segmented button")].find((button) => button.textContent?.trim() === "活跃项目")?.click();
        await tick();
        expect(document.querySelector(".xz-tree-scroll")?.textContent).toContain("绘制贸易路线");
    });

    it("可用每行的上下按钮保存同级顺序", async () => {
        const parent: WorkItem = {
            id: "project", rowId: "project", title: "小说", documentId: null, detached: true,
            type: "项目", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            hardPrerequisiteIds: [], softPrerequisiteIds: [], planDate: null, deadline: null, noDeadline: false,
            durationMinutes: null, energy: "", updatedAt: 1,
        };
        const first: WorkItem = { ...parent, id: "first", rowId: "first", title: "第一章", parentIds: [parent.id], sortOrder: 0 };
        const second: WorkItem = { ...parent, id: "second", rowId: "second", title: "第二章", parentIds: [parent.id], sortOrder: 1 };
        const workItemData = {
            attributeViewId: "xingzhou-internal", attributeViewName: "行舟内部数据", viewId: "all",
            items: [parent, first, second], missingFields: [], fields: {},
        };
        const reorderedData = {
            ...workItemData,
            items: [parent, { ...first, sortOrder: 1 }, { ...second, sortOrder: 0 }],
        };
        const reorderItems = vi.fn().mockResolvedValue(reorderedData);
        const captureRequests: CaptureDialogRequest[] = [];
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(() => new Promise<never>(() => undefined)),
                captureInbox: vi.fn().mockResolvedValue(workItemData), saveItem: vi.fn(),
                deleteItem: vi.fn(), reorderItems, openDocument: vi.fn(),
                openCaptureDialog: (request) => captureRequests.push(request),
            },
        });
        (document.querySelector(".xz-global-capture-button") as HTMLButtonElement).click();
        await captureRequests[0].onSubmit({ title: "载入排序测试" });
        await vi.waitFor(() => expect(document.querySelectorAll(".xz-drag-handle"), document.body.innerHTML).toHaveLength(3));
        const moveUp = document.querySelector<HTMLButtonElement>('[aria-label="上移“第一章”"]');
        const moveDown = document.querySelector<HTMLButtonElement>('[aria-label="下移“第一章”"]');
        expect(moveUp?.disabled).toBe(true);
        expect(moveDown?.disabled).toBe(false);
        moveDown?.click();

        await vi.waitFor(() => expect(reorderItems).toHaveBeenCalledTimes(1));
        expect(reorderItems.mock.calls[0][1]).toBe("project");
        expect(reorderItems.mock.calls[0][2]).toEqual(["second", "first"]);
        await vi.waitFor(() => expect(document.querySelector(".xz-tree-children .xz-tree-title")?.textContent).toBe("第二章"));
    });

    it("从收件箱查看独立条目时精确高亮，并允许直接编辑内部字段", async () => {
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
        const completedData = { ...workItemData, items: [{ ...item, status: "已完成" }] };
        const saveItem = vi.fn()
            .mockResolvedValueOnce(completedData)
            .mockResolvedValueOnce(workItemData)
            .mockImplementation(async (currentData, currentItem, changes) => ({
                ...currentData,
                items: currentData.items.map((candidate: WorkItem) => candidate.rowId === currentItem.rowId ? {
                    ...candidate,
                    ...(changes.status !== undefined ? { status: changes.status ?? "" } : {}),
                    ...(changes.nextAction !== undefined ? { nextAction: changes.nextAction ?? "" } : {}),
                    ...(changes.planDate !== undefined ? { planDate: changes.planDate ? new Date(`${changes.planDate}T00:00:00`).getTime() : null } : {}),
                    ...(changes.deadline !== undefined ? { deadline: changes.deadline ? new Date(`${changes.deadline}T00:00:00`).getTime() : null } : {}),
                    ...(changes.noDeadline !== undefined ? { noDeadline: Boolean(changes.noDeadline) } : {}),
                } : candidate),
            }));
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(() => new Promise<never>(() => undefined)),
                captureInbox: vi.fn().mockResolvedValue(workItemData), saveItem, deleteItem: vi.fn(), openDocument: vi.fn(),
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
        expect(document.querySelector(".xz-tree-row.selected .xz-today-focus")?.textContent).toBe("今日");
        expect(document.querySelector(".xz-tree-row.selected .xz-tag")?.classList.contains("xz-tag--secondary")).toBe(true);
        expect(document.body.textContent).toContain("这是行舟内部工作项，当前没有关联思源文档");
        expect(document.querySelector(".xz-date-hint--today")?.textContent).toBe("今日");
        expect(document.querySelector(".xz-date-hint--overdue")?.textContent).toBe("已逾期");
        expect(document.querySelector(".xz-detail-header-actions .xz-tag--today")).toBeNull();
        expect(document.querySelector(".xz-complete-button")?.textContent?.trim()).toBe("✓ 标记为完成");
        expect(document.querySelector(".xz-detail-role-actions .xz-complete-button")).not.toBeNull();
        expect(document.querySelector(".xz-detail-title-row .xz-complete-button")).toBeNull();
        expect(document.querySelector(".xz-dependency-setup")).toBeNull();
        expect(document.querySelector('select[aria-label="添加完成后开始依赖"]')).toBeInstanceOf(HTMLSelectElement);
        expect(document.querySelector('select[aria-label="添加需先行依赖"]')).toBeInstanceOf(HTMLSelectElement);

        saveItem.mockClear();
        (document.querySelector(".xz-complete-button") as HTMLButtonElement).click();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalled());
        expect(saveItem.mock.calls[0][2]).toEqual({ status: "已完成" });
        await vi.waitFor(() => expect(document.querySelector(".xz-completion-undo")?.textContent).toContain("撤销"));
        (document.querySelector(".xz-completion-undo button") as HTMLButtonElement).click();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledTimes(2));
        expect(saveItem.mock.calls[1][2]).toEqual({ status: "收件箱" });
        await vi.waitFor(() => expect(document.querySelector(".xz-completion-undo")).toBeNull());

        expect((document.querySelector(".xz-inline-title") as HTMLInputElement).value).toBe("清理房间中的垃圾");
        expect(document.querySelectorAll(".xz-meta-grid--editable select")).toHaveLength(5);
        expect(document.querySelector(".xz-detail-header select")).toBeNull();
        const statusSelect = document.querySelector(".xz-meta-status-select") as HTMLSelectElement;
        expect([...statusSelect.options].map((option) => option.value)).not.toContain("已计划");
        expect([...statusSelect.options].map((option) => option.value)).toContain("进行中");
        expect([...statusSelect.options].map((option) => option.value)).not.toContain("规划中");

        expect([...document.querySelectorAll("button")].find((button) => button.textContent?.includes("编辑行动内容"))).toBeUndefined();
        expect(document.body.textContent).toContain("内部字段暂不可用");
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
        const futurePlanDate = new Date();
        futurePlanDate.setDate(futurePlanDate.getDate() + 7);
        const futurePlanDateKey = `${futurePlanDate.getFullYear()}-${String(futurePlanDate.getMonth() + 1).padStart(2, "0")}-${String(futurePlanDate.getDate()).padStart(2, "0")}`;
        planDate.value = futurePlanDateKey;
        planDate.dispatchEvent(new Event("input", { bubbles: true }));
        planDate.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalled());
        expect(saveItem.mock.calls[0][2]).toMatchObject({ planDate: futurePlanDateKey, status: "待开始" });

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
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const scheduled = {
            id: "scheduled", rowId: "scheduled", title: "今天处理合同", documentId: null, detached: true,
            type: "事务", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: today.getTime(), deadline: tomorrow.getTime(), noDeadline: false, durationMinutes: 30, energy: "低", updatedAt: Date.now(),
        };
        const unscheduled = {
            ...scheduled, id: "unscheduled", rowId: "unscheduled", title: "整理书架", status: "待开始", planDate: null, deadline: null, noDeadline: true,
        };
        const beforeVisibleWeek = new Date(today);
        const currentDay = beforeVisibleWeek.getDay();
        beforeVisibleWeek.setDate(beforeVisibleWeek.getDate() - (currentDay === 0 ? 7 : currentDay));
        const activeWindow = {
            ...scheduled, id: "window", rowId: "window", title: "办理有效期内的事务", planDate: beforeVisibleWeek.getTime(), deadline: tomorrow.getTime(),
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
                status: { id: "status", name: "状态", type: "select", options: [{ name: "待开始" }, { name: "进行中" }] },
                planDate: { id: "plan", name: "计划日期", type: "date", options: [] },
            },
        };
        const saveItem = vi.fn(async (currentData: WorkItemData, currentItem: WorkItem, changes: WorkItemChanges): Promise<WorkItemData> => ({
            ...currentData,
            items: currentData.items.map((candidate) => candidate.id === currentItem.id ? {
                ...candidate,
                ...(changes.completedDates !== undefined ? { completedDates: changes.completedDates } : {}),
                ...(changes.planDate !== undefined ? {
                    planDate: typeof changes.planDate === "string" && changes.planDate
                        ? new Date(`${changes.planDate}T00:00:00`).getTime()
                        : null,
                } : {}),
            } : candidate),
        }));
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(() => new Promise<never>(() => undefined)),
                captureInbox: vi.fn().mockResolvedValue(workItemData), saveItem, deleteItem: vi.fn(), openDocument: vi.fn(),
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
        expect(document.querySelector(".xz-week-board")?.textContent).toContain("办理有效期内的事务");
        expect(document.querySelector(".xz-week-header")?.textContent).toContain("已安排 2 项");
        expect(document.querySelector('[data-work-item-id="scheduled"][data-week-phase="start"]')).not.toBeNull();
        expect(document.querySelectorAll('[data-work-item-id="scheduled"]')).toHaveLength(2);
        const startDateSelect = document.querySelector('select[aria-label="修改“今天处理合同”的开始日"]') as HTMLSelectElement;
        expect(startDateSelect.options[0].textContent).toBe("修改开始日…");
        expect(document.querySelector('[data-work-item-id="scheduled"][data-week-phase="deadline"] select')).toBeNull();
        const forbiddenStartDate = [...startDateSelect.options].find((option) => option.disabled);
        expect(forbiddenStartDate).toBeDefined();
        startDateSelect.value = forbiddenStartDate?.value ?? "";
        startDateSelect.dispatchEvent(new Event("change", { bubbles: true }));
        await tick();
        expect(saveItem).not.toHaveBeenCalled();
        expect(document.querySelector(".xz-week-error")?.textContent).toContain("计划开始日不能晚于截止日期");
        expect(document.querySelector(".xz-week-board")?.textContent).not.toContain("本周已完成的事务");
        expect(document.querySelector(".xz-week-backlog")?.textContent).toContain("整理书架");
        expect(document.querySelector(".xz-week-backlog")?.textContent).not.toContain("办理有效期内的事务");
        expect(document.querySelector(".xz-week-backlog")?.textContent).not.toContain("今天处理合同");
        expect(document.querySelector(".xz-week-backlog")?.textContent).not.toContain("不应进入待安排的项目");

        saveItem.mockClear();
        const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const startCard = document.querySelector<HTMLElement>('[data-work-item-id="scheduled"][data-week-phase="start"]');
        startCard?.querySelector<HTMLButtonElement>(".xz-week-item-actions button")?.click();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
        expect(saveItem.mock.calls[0][2]).toEqual({ completedDates: [todayKey] });
        await vi.waitFor(() => expect(document.querySelector(`[data-work-item-id="scheduled"][data-week-date="${todayKey}"]`)?.classList.contains("xz-week-item--date-completed")).toBe(true));
        expect(document.querySelector('[data-work-item-id="scheduled"][data-week-phase="deadline"]')?.classList.contains("xz-week-item--date-completed")).toBe(false);
        expect(document.querySelector(`[data-week-date="${todayKey}"] .xz-week-item-date-done`)?.textContent).toContain("当日已完成");

        saveItem.mockClear();
        const assignment = document.querySelector('select[aria-label="安排“整理书架”"]') as HTMLSelectElement;
        const targetDate = assignment.options[assignment.options.length - 1].value;
        assignment.value = targetDate;
        assignment.dispatchEvent(new Event("change", { bubbles: true }));
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalled());
        expect(saveItem.mock.calls[0][2]).toEqual({ planDate: targetDate });
    });

    it("在任意工作项入口右键可安全删除内部工作项，并提示保留下级与关联文档", async () => {
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
                openDocument: vi.fn(),
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
        expect(detail.querySelector('.xz-role-badge[data-role="domain"]')?.textContent).toBe("长期领域");
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
                captureInbox: vi.fn().mockResolvedValue(workItemData), saveItem: vi.fn(), deleteItem: vi.fn(), openDocument: vi.fn(),
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

    it("编辑跨领域依赖并显示反向支持关系", async () => {
        const base: WorkItem = {
            id: "base", rowId: "base", title: "基础条目", documentId: null, detached: true,
            type: "项目", status: "待开始", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            hardPrerequisiteIds: [], softPrerequisiteIds: [], planDate: null, deadline: null, noDeadline: false,
            durationMinutes: null, energy: "", updatedAt: Date.now(),
        };
        const mapArea = { ...base, id: "map-area", rowId: "map-area", title: "地图制作学习", type: "长期领域", status: "将来" };
        const learning = { ...base, id: "learning", rowId: "learning", title: "Azgaar 使用学习", parentIds: [mapArea.id] };
        const writingArea = { ...base, id: "writing-area", rowId: "writing-area", title: "写小说", type: "长期领域", status: "重点投入" };
        const novel = { ...base, id: "novel", rowId: "novel", title: "恶魔的尾巴第一季", status: "进行中", parentIds: [writingArea.id] };
        const mapDesign = { ...base, id: "map-design", rowId: "map-design", title: "恶魔的尾巴小说地图设计", status: "进行中", parentIds: [novel.id], topProjectIds: [novel.id], softPrerequisiteIds: [learning.id] };
        const reference = { ...base, id: "reference", rowId: "reference", title: "整理地图参考资料", type: "事务" };
        const workItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [mapArea, learning, writingArea, novel, mapDesign, reference], missingFields: [],
            fields: {},
        };
        const saveItem = vi.fn(async (currentData, currentItem, changes) => ({
            ...currentData,
            items: currentData.items.map((item: WorkItem) => item.id === currentItem.id ? {
                ...item,
                ...(changes.hardPrerequisites ? { hardPrerequisiteIds: changes.hardPrerequisites } : {}),
                ...(changes.softPrerequisites ? { softPrerequisiteIds: changes.softPrerequisites } : {}),
            } : item),
        }));
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn(() => new Promise<never>(() => undefined)), captureInbox: vi.fn().mockResolvedValue(workItemData), saveItem, deleteItem: vi.fn(),
                openDocument: vi.fn(),
            },
        });
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "收件箱")?.click();
        await tick();
        const input = document.querySelector("#xz-inbox-input") as HTMLInputElement;
        input.value = "初始化依赖测试";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();
        (document.querySelector(".xz-capture-card") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(document.body.textContent).toContain("已加入收件箱：初始化依赖测试"));
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "全部")?.click();
        await tick();
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="map-design"]'), document.body.innerHTML).not.toBeNull());
        (document.querySelector('[data-work-item-id="map-design"] .xz-tree-main') as HTMLButtonElement).click();
        await tick();

        expect(document.querySelector(".xz-dependency-card")?.textContent).toContain("Azgaar 使用学习");
        expect(document.querySelector(".xz-dependency-indicator")?.textContent).toContain("1");
        const hardSelect = document.querySelector('select[aria-label="添加完成后开始依赖"]') as HTMLSelectElement;
        hardSelect.value = reference.id;
        hardSelect.dispatchEvent(new Event("change", { bubbles: true }));
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: mapDesign.id }), {
            hardPrerequisites: [reference.id],
        }));

        (document.querySelector('[data-work-item-id="learning"] .xz-tree-main') as HTMLButtonElement).click();
        await tick();
        expect(document.querySelector(".xz-dependency-supported")?.textContent).toContain("恶魔的尾巴小说地图设计");
    });
});
