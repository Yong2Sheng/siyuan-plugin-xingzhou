import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import XingzhouApp from "../src/XingzhouApp.svelte";
import type { CaptureDialogRequest } from "../src/capture-dialog";
import type { WorkItem, WorkItemChanges, WorkItemData } from "../src/work-items";

function localDateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

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

    it("移除收件箱与全局添加入口，并把旧收件箱视图恢复到全部", async () => {
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue({
                    attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view", items: [], missingFields: [], fields: {},
                }),
                captureInbox: vi.fn(),
                saveItem: vi.fn(),
                deleteItem: vi.fn(),
                openDocument: vi.fn(),
                initialViewState: {
                    page: "inbox", filter: "all", includeClosed: false, scope: "all", selectedId: null,
                    expandedIds: [], weekStart: Date.now(), sidebarScrollTop: 0, treeScrollTop: 0, detailScrollTop: 0,
                },
            },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-workspace")).not.toBeNull());
        expect([...document.querySelectorAll(".xz-main-nav button")].map((button) => button.textContent?.trim())).toEqual(["全部", "本周", "整理", "关系图"]);
        expect(document.querySelector(".xz-global-capture-button")).toBeNull();
        expect(document.querySelector("#xz-inbox-input")).toBeNull();
    });

    it("能在长期领域下通过上下文创建顶层项目", async () => {
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
            ...domain, id: "project", rowId: "project", title: "完成第一卷", type: "项目", status: "待开始", parentIds: [domain.id],
        };
        const captureInbox = vi.fn().mockResolvedValueOnce({ ...baseData, items: [domain, project] });
        const openItemMenu = vi.fn();
        const captureRequests: CaptureDialogRequest[] = [];
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue(baseData), captureInbox, saveItem: vi.fn(), deleteItem: vi.fn(),
                openDocument: vi.fn(), openItemMenu, openCaptureDialog: (request) => captureRequests.push(request),
            },
        });

        await vi.waitFor(() => expect(document.querySelector(".xz-add-child-button"), document.body.innerHTML).not.toBeNull());

        (document.querySelector(".xz-tree-menu-button") as HTMLButtonElement).click();
        (document.querySelector(".xz-detail-menu-button") as HTMLButtonElement).click();
        expect(openItemMenu).toHaveBeenCalledTimes(2);
        expect(openItemMenu.mock.calls[0][2]?.label).toBe("添加顶层项目…");

        (document.querySelector(".xz-add-child-button") as HTMLButtonElement).click();
        expect(captureRequests[0]?.mode).toBe("child");
        expect(captureRequests[0]?.parent).toMatchObject({ id: "domain", title: "写小说", type: "长期领域" });
        await captureRequests[0].onSubmit({ title: "完成第一卷", type: "项目" });
        await vi.waitFor(() => expect(captureInbox).toHaveBeenCalledWith("完成第一卷", {
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
        const child = { ...domain, id: "child", rowId: "child", title: "世界观构建", type: "项目", status: "待开始", parentIds: [project.id], topProjectIds: [project.id] };
        const baseData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [domain, project], missingFields: [], fields: {},
        };
        const captureRequests: CaptureDialogRequest[] = [];
        const captureInbox = vi.fn().mockResolvedValueOnce({ ...baseData, items: [domain, project, child] });
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue(baseData), captureInbox,
                saveItem: vi.fn(), deleteItem: vi.fn(), openDocument: vi.fn(),
                openCaptureDialog: (request) => captureRequests.push(request),
            },
        });
        await vi.waitFor(() => expect(
            document.querySelector('.xz-sidebar-group--areas [data-work-item-id="domain"]'),
            document.body.innerHTML,
        ).not.toBeNull());

        (document.querySelector('.xz-sidebar-group--areas [data-work-item-id="domain"]') as HTMLButtonElement).click();
        await tick();
        (document.querySelector('.xz-tree-node[data-work-item-id="project"] .xz-tree-main') as HTMLButtonElement).click();
        await tick();
        (document.querySelector(".xz-add-child-button") as HTMLButtonElement).click();
        expect(captureRequests[0]?.parent).toMatchObject({ id: "project", title: "恶魔的尾巴" });
        await captureRequests[0].onSubmit({ title: "世界观构建", type: "项目" });
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
        const captureInbox = vi.fn().mockResolvedValue({ ...workItemData, items: [...workItemData.items, { ...project, id: "new-project", rowId: "new-project", title: "准备第二卷" }] });
        const captureRequests: CaptureDialogRequest[] = [];
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue(workItemData), captureInbox,
                saveItem: vi.fn(), deleteItem: vi.fn(), openDocument: vi.fn(),
                openCaptureDialog: (request) => captureRequests.push(request),
            },
        });
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
        expect(captureRequests[0]?.mode).toBe("topProject");
        expect(captureRequests[0]?.areas).toEqual([{ id: "domain", title: "写小说", type: "长期领域" }]);
        await captureRequests[0].onSubmit({ title: "准备第二卷", areaId: "domain" });
        await vi.waitFor(() => expect(captureInbox).toHaveBeenCalledWith("准备第二卷", {
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
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue(workItemData),
                captureInbox: vi.fn(), saveItem: vi.fn(),
                deleteItem: vi.fn(), reorderItems, openDocument: vi.fn(),
            },
        });
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

    it("旧收件箱状态条目仍在全部视图精确显示，并允许直接编辑内部字段", async () => {
        const item = {
            id: "item-1", rowId: "item-1", title: "清理房间中的垃圾", documentId: null, detached: true,
            type: "事务", status: "收件箱", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: Date.now(), deadline: Date.now() - 2 * 24 * 60 * 60 * 1000, noDeadline: false, durationMinutes: null, energy: "", updatedAt: Date.now(),
            sliceTargetCount: 1,
            executionSlices: [{ id: "historical-slice", scheduledDate: localDateKey(new Date()), status: "completed" as const, completedAt: Date.now(), updatedAt: Date.now() }],
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
                load: vi.fn().mockResolvedValue(workItemData),
                captureInbox: vi.fn(), saveItem, deleteItem: vi.fn(), openDocument: vi.fn(),
            },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-workspace")).not.toBeNull());

        const exactScope = [...document.querySelectorAll(".xz-sidebar .xz-scope-button")]
            .find((button) => button.textContent?.includes("清理房间中的垃圾"));
        (exactScope as HTMLButtonElement | undefined)?.click();
        await tick();
        expect(exactScope?.classList.contains("active"), document.body.textContent ?? "").toBe(true);
        expect(document.querySelector(".xz-tree-row.selected")?.textContent).toContain("清理房间中的垃圾");
        expect(document.querySelector(".xz-tree-row.selected .xz-today-focus")).toBeNull();
        expect(document.querySelector(".xz-tree-row.selected .xz-slice-plan-indicator.completed")?.textContent).toBe("切片完成 1/1");
        expect(document.querySelector(".xz-tree-row.selected .xz-tag")?.classList.contains("xz-tag--secondary")).toBe(false);
        expect(document.body.textContent).toContain("这是行舟内部工作项，当前没有关联思源文档");
        expect(document.querySelector(".xz-date-hint--today")).toBeNull();
        expect(document.querySelector(".xz-date-hint--overdue")?.textContent).toBe("已逾期");
        expect(document.querySelector(".xz-slice-card")?.textContent).toContain("执行切片");
        expect(document.querySelector(".xz-meta-grid--editable")?.textContent).not.toContain("计划开始日");
        expect(document.querySelector(".xz-meta-grid--editable")?.textContent).not.toContain("每片预计时长");
        expect(document.querySelector('[aria-label="每片预计时长（分钟）"]')).toBeInstanceOf(HTMLInputElement);
        expect(document.querySelector('[aria-label="待安排切片数"]')).toBeNull();
        expect(document.querySelector(".xz-slice-header-meta")?.textContent).toContain("待安排");
        expect(document.querySelector(".xz-detail-header-actions .xz-tag--today")).toBeNull();
        expect(document.querySelector(".xz-complete-button")?.textContent?.trim()).toBe("✓ 标记为完成");
        expect(document.querySelector(".xz-detail-role-actions .xz-complete-button")).not.toBeNull();
        expect(document.querySelector(".xz-detail-title-row .xz-complete-button")).toBeNull();
        expect(document.querySelector(".xz-dependency-setup")).toBeNull();
        expect(document.querySelector('select[aria-label="添加完成后开始依赖"]')).toBeInstanceOf(HTMLSelectElement);
        expect(document.querySelector('select[aria-label="添加需先行依赖"]')).toBeInstanceOf(HTMLSelectElement);

        expect(document.querySelector(".xz-workspace")?.classList.contains("xz-workspace--detail-open")).toBe(true);
        (document.querySelector(".xz-tablet-scope-button") as HTMLButtonElement).click();
        await tick();
        expect(document.querySelector(".xz-workspace")?.classList.contains("xz-workspace--scope-open")).toBe(true);
        (document.querySelector(".xz-scope-backdrop") as HTMLButtonElement).click();
        (document.querySelector(".xz-detail-back-button") as HTMLButtonElement).click();
        await tick();
        expect(document.querySelector(".xz-workspace")?.classList.contains("xz-workspace--scope-open")).toBe(false);
        expect(document.querySelector(".xz-workspace")?.classList.contains("xz-workspace--detail-open")).toBe(false);

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
        const deadlineMode = document.querySelector('select[aria-label="截止日期设置"]') as HTMLSelectElement;
        deadlineMode.value = "none";
        deadlineMode.dispatchEvent(new Event("change", { bubbles: true }));
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalled());
        expect(saveItem.mock.calls[0][2]).toEqual({ deadline: null, noDeadline: true });
        expect(document.body.textContent).not.toContain("已有执行记录时不能清除截止日期");
    });

    it("本周页按实际日期分组，并能把待安排条目分配到某一天", async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const scheduled = {
            id: "scheduled", rowId: "scheduled", title: "今天处理合同", documentId: null, detached: true,
            type: "事务", status: "待开始", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: tomorrow.getTime(), noDeadline: false, durationMinutes: 30, energy: "低", updatedAt: Date.now(),
            sliceTargetCount: 2,
            executionSlices: [{ id: "today-slice", scheduledDate: localDateKey(today), status: "scheduled" as const, completedAt: null, updatedAt: Date.now() }],
        };
        const unscheduled = {
            ...scheduled, id: "unscheduled", rowId: "unscheduled", title: "整理书架", executionSlices: [], sliceTargetCount: 1,
        };
        const unscheduledProject = {
            ...unscheduled, id: "project", rowId: "project", title: "不应进入待安排的项目", type: "项目",
        };
        const later = new Date(today);
        later.setDate(later.getDate() + 40);
        const dayAfterLater = new Date(later);
        dayAfterLater.setDate(dayAfterLater.getDate() + 1);
        const fullyScheduled = {
            ...scheduled, id: "fully-scheduled", rowId: "fully-scheduled", title: "已经排齐的事务", deadline: null, noDeadline: true,
            executionSlices: [
                { id: "later-1", scheduledDate: localDateKey(later), status: "scheduled" as const, completedAt: null, updatedAt: Date.now() },
                { id: "later-2", scheduledDate: localDateKey(dayAfterLater), status: "scheduled" as const, completedAt: null, updatedAt: Date.now() },
            ],
        };
        const completed = {
            ...scheduled, id: "completed-week", rowId: "completed-week", title: "本周已完成的事务", status: "已完成",
            sliceTargetCount: 1,
            executionSlices: [{ id: "done-slice", scheduledDate: localDateKey(today), status: "completed" as const, completedAt: Date.now(), updatedAt: Date.now() }],
        };
        const workItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [scheduled, unscheduled, unscheduledProject, fullyScheduled, completed], missingFields: [],
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
                ...(changes.executionSlices !== undefined ? { executionSlices: changes.executionSlices } : {}),
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
                load: vi.fn().mockResolvedValue(workItemData),
                captureInbox: vi.fn(), saveItem, deleteItem: vi.fn(), openDocument: vi.fn(),
            },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-workspace")).not.toBeNull());
        expect(document.querySelector('[data-work-item-id="scheduled"] .xz-today-focus')?.textContent).toBe("今日");
        expect(document.querySelector('[data-work-item-id="scheduled"] .xz-slice-plan-indicator.needs-planning')?.textContent).toBe("待安排 1");
        expect(document.querySelector('[data-work-item-id="unscheduled"] .xz-slice-plan-indicator.needs-planning')?.textContent).toBe("待安排 1");
        expect(document.querySelector('[data-work-item-id="fully-scheduled"] .xz-slice-plan-indicator.arranged')?.textContent).toBe("已安排 2/2");
        expect(document.querySelector('[data-work-item-id="project"] .xz-slice-plan-indicator')).toBeNull();

        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "本周")?.click();
        await tick();
        expect(document.body.textContent).toContain("周一");
        expect(document.body.textContent).toContain("周日");
        expect(document.querySelector(".xz-week-board")?.textContent).toContain("今天处理合同");
        expect(document.querySelector(".xz-week-board")?.textContent).toContain("本周已完成的事务");
        expect(document.querySelector(".xz-week-header")?.textContent).toContain("已安排 1 项");
        expect(document.querySelector('[data-work-item-id="scheduled"][data-week-phase="slice"]')).not.toBeNull();
        expect(document.querySelectorAll('.xz-week-board [data-work-item-id="scheduled"]')).toHaveLength(1);
        expect(document.querySelector('select[aria-label="移动“今天处理合同”的执行切片"]')).toBeInstanceOf(HTMLSelectElement);
        expect(document.querySelector(".xz-week-backlog")?.textContent).toContain("整理书架");
        expect(document.querySelector(".xz-week-backlog")?.textContent).toContain("今天处理合同");
        expect(document.querySelector(".xz-week-backlog")?.textContent).toContain("待安排 1 片");
        expect(document.querySelector(".xz-week-backlog")?.textContent).not.toContain("不应进入待安排的项目");

        /* 日期行右侧的「待做」chip：今天 2 片共 60 分钟，其中 30 分钟还没做 */
        const todayColumn = document.querySelector(`.xz-week-day[data-week-day="${localDateKey(today)}"]`);
        const chip = todayColumn?.querySelector(".xz-week-day-remaining");
        expect(chip?.textContent).toBe("待做30分");
        expect(chip?.getAttribute("title")).toBeNull();
        /* 三槽位：中间是「今天」，chip 永远在最后一个（右侧） */
        const headerChildren = [...(todayColumn?.querySelector("header")?.children ?? [])];
        expect(headerChildren[headerChildren.length - 1]?.classList.contains("xz-week-day-remaining")).toBe(true);
        expect(headerChildren[headerChildren.length - 2]?.textContent).toBe("今天");

        saveItem.mockClear();
        const todayKey = localDateKey(today);
        const sliceCard = document.querySelector<HTMLElement>('[data-work-item-id="scheduled"][data-week-phase="slice"]');
        [...(sliceCard?.querySelectorAll<HTMLButtonElement>(".xz-week-item-actions button") ?? [])].find((button) => button.textContent === "完成")?.click();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
        expect(saveItem.mock.calls[0][2].executionSlices?.[0]).toMatchObject({ id: "today-slice", status: "completed" });
        expect(saveItem.mock.calls[0][2].status).toBe("进行中");
        await vi.waitFor(() => expect(document.querySelector(`[data-work-item-id="scheduled"][data-week-date="${todayKey}"]`)?.classList.contains("xz-week-item--date-completed")).toBe(true));
        expect(document.querySelector(`[data-work-item-id="scheduled"] .xz-week-slice-status`)?.textContent).toContain("已完成");

        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "全部")?.click();
        await tick();
        expect(document.querySelector('[data-work-item-id="scheduled"] .xz-today-focus')).toBeNull();
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "本周")?.click();
        await tick();

        saveItem.mockClear();
        const assignment = document.querySelector('select[aria-label="安排“整理书架”"]') as HTMLSelectElement;
        const targetDate = localDateKey(today);
        assignment.value = targetDate;
        assignment.dispatchEvent(new Event("change", { bubbles: true }));
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalled());
        expect(saveItem.mock.calls[0][2].executionSlices?.[0]).toMatchObject({ scheduledDate: targetDate, status: "scheduled" });
    });

    it("本周页把当天已全部做完的列标成待做 0 分", async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayKey = localDateKey(today);
        const doneItem = {
            id: "done", rowId: "done", title: "今天全做完的事务", documentId: null, detached: true,
            type: "事务", status: "已完成", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: null, noDeadline: true, durationMinutes: 150, energy: "", updatedAt: null,
            sliceTargetCount: 2,
            executionSlices: [
                { id: "done-1", scheduledDate: todayKey, status: "completed" as const, completedAt: Date.now(), updatedAt: 1 },
                { id: "done-2", scheduledDate: todayKey, status: "completed" as const, completedAt: Date.now(), updatedAt: 2 },
            ],
        };
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue({
                    attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
                    items: [doneItem], missingFields: [],
                    fields: { title: { id: "title", name: "工作项", type: "block", options: [] } },
                }),
                captureInbox: vi.fn(), saveItem: vi.fn(), deleteItem: vi.fn(), openDocument: vi.fn(),
            },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-workspace")).not.toBeNull());
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "本周")?.click();
        await tick();

        const column = document.querySelector(`.xz-week-day[data-week-day="${todayKey}"]`);
        expect(column?.classList.contains("is-clear")).toBe(true);
        const chip = column?.querySelector(".xz-week-day-remaining");
        expect(chip?.textContent).toBe("待做0分");
        expect(chip?.classList.contains("is-clear")).toBe(true);
        expect(chip?.getAttribute("title")).toBeNull();

        /* 过去日期不显示 chip */
        const pastKey = [...document.querySelectorAll<HTMLElement>(".xz-week-day")]
            .map((node) => node.dataset.weekDay ?? "")
            .filter((key) => key && key < todayKey)
            .sort()
            .reverse()[0];
        if (pastKey) {
            expect(document.querySelector(`.xz-week-day[data-week-day="${pastKey}"] .xz-week-day-remaining`)).toBeNull();
        }
    });

    it("本周页对没有预计时长的切片显示待做未估时", async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayKey = localDateKey(today);
        const unknownItem = {
            id: "unknown", rowId: "unknown", title: "未估时事务", documentId: null, detached: true,
            type: "事务", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: null, noDeadline: true, durationMinutes: null, energy: "", updatedAt: null,
            sliceTargetCount: 1,
            executionSlices: [{ id: "unknown-1", scheduledDate: todayKey, status: "scheduled" as const, completedAt: null, updatedAt: 1 }],
        };
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue({
                    attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
                    items: [unknownItem], missingFields: [],
                    fields: { title: { id: "title", name: "工作项", type: "block", options: [] } },
                }),
                captureInbox: vi.fn(), saveItem: vi.fn(), deleteItem: vi.fn(), openDocument: vi.fn(),
            },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-workspace")).not.toBeNull());
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "本周")?.click();
        await tick();

        const chip = document.querySelector(`.xz-week-day[data-week-day="${todayKey}"] .xz-week-day-remaining`);
        expect(chip?.textContent).toBe("待做未估时");
        expect(chip?.querySelector(".xz-week-chip-unit")).toBeNull();
    });

    it("每周页允许提前完成未来切片，并保留在原计划日期", async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const item: WorkItem = {
            id: "future", rowId: "future", title: "提前完成的事务", documentId: null, detached: true,
            type: "事务", status: "待开始", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: tomorrow.getTime(), noDeadline: false, durationMinutes: 30, energy: "低", updatedAt: Date.now(),
            sliceTargetCount: 2,
            executionSlices: [
                { id: "today-slice", scheduledDate: localDateKey(today), status: "scheduled", completedAt: null, updatedAt: Date.now() - 1 },
                { id: "future-slice", scheduledDate: localDateKey(tomorrow), status: "scheduled", completedAt: null, updatedAt: Date.now() },
            ],
        };
        const workItemData: WorkItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [item], missingFields: [], fields: {},
        };
        const saveItem = vi.fn(async (currentData: WorkItemData, currentItem: WorkItem, changes: WorkItemChanges): Promise<WorkItemData> => ({
            ...currentData,
            items: currentData.items.map((candidate) => candidate.id === currentItem.id ? {
                ...candidate,
                ...(changes.executionSlices !== undefined ? { executionSlices: changes.executionSlices } : {}),
                ...(typeof changes.status === "string" ? { status: changes.status } : {}),
            } : candidate),
        }));
        component = new XingzhouApp({
            target: document.body,
            props: { load: vi.fn().mockResolvedValue(workItemData), captureInbox: vi.fn(), saveItem, deleteItem: vi.fn(), openDocument: vi.fn() },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-workspace")).not.toBeNull());
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "本周")?.click();
        await tick();
        if (today.getDay() === 0) {
            [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "下一周")?.click();
            await tick();
        }

        const futureCard = document.querySelector<HTMLElement>(`[data-work-item-id="future"][data-week-date="${localDateKey(tomorrow)}"]`);
        const completeEarly = [...(futureCard?.querySelectorAll<HTMLButtonElement>(".xz-week-item-actions button") ?? [])]
            .find((button) => button.textContent === "提前完成");
        expect(completeEarly).toBeInstanceOf(HTMLButtonElement);
        completeEarly?.click();

        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledOnce());
        expect(saveItem.mock.calls[0][2].executionSlices).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: "today-slice", scheduledDate: localDateKey(today), status: "scheduled" }),
            expect.objectContaining({ id: "future-slice", scheduledDate: localDateKey(tomorrow), status: "completed" }),
        ]));
        expect(saveItem.mock.calls[0][2].status).toBe("进行中");
        await vi.waitFor(() => expect(document.querySelector(`[data-work-item-id="future"][data-week-date="${localDateKey(tomorrow)}"]`)?.classList.contains("xz-week-item--date-completed")).toBe(true));
        expect(document.querySelector(`[data-work-item-id="future"][data-week-date="${localDateKey(tomorrow)}"] .xz-week-slice-status`)?.textContent).toContain("已提前完成");
        expect(document.querySelector(`[data-work-item-id="future"][data-week-date="${localDateKey(tomorrow)}"] .xz-week-item-meta`)?.textContent).toContain("完成于今天");
        if (today.getDay() === 0) {
            [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "上一周")?.click();
            await tick();
        }
        const achievement = document.querySelector(`[data-work-item-id="future"][data-week-date="${localDateKey(today)}"][data-week-phase="early-completion"]`);
        expect(achievement?.textContent).toContain("今日提前完成");
        expect(achievement?.textContent).toContain(`原计划 ${tomorrow.getMonth() + 1}月${tomorrow.getDate()}日`);
        expect(achievement?.textContent).toContain("不计入当日安排");
    });

    it("本周补记完成把目标切片做满也不会自动结束事务，撤销完成只回退切片", async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
        const item: WorkItem = {
            id: "makeup", rowId: "makeup", title: "补记完成的事务", documentId: null, detached: true,
            type: "事务", status: "进行中", currentAction: "看这张\n![](assets/evidence.png)", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: null, noDeadline: true, durationMinutes: 20, energy: "中", updatedAt: Date.now(),
            sliceTargetCount: 1,
            executionSlices: [{ id: "missed-slice", scheduledDate: localDateKey(weekStart), status: "missed", completedAt: null, updatedAt: Date.now() }],
        };
        const workItemData: WorkItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [item], missingFields: [], fields: {},
        };
        const saveItem = vi.fn(async (currentData: WorkItemData, currentItem: WorkItem, changes: WorkItemChanges): Promise<WorkItemData> => ({
            ...currentData,
            items: currentData.items.map((candidate) => candidate.id === currentItem.id ? {
                ...candidate,
                ...(changes.executionSlices !== undefined ? { executionSlices: changes.executionSlices } : {}),
                ...(typeof changes.status === "string" ? { status: changes.status } : {}),
                ...(changes.imageCleanup !== undefined ? { imageCleanup: changes.imageCleanup } : {}),
            } : candidate),
        }));
        component = new XingzhouApp({
            target: document.body,
            props: { load: vi.fn().mockResolvedValue(workItemData), captureInbox: vi.fn(), saveItem, deleteItem: vi.fn(), openDocument: vi.fn() },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-workspace")).not.toBeNull());
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "本周")?.click();
        await tick();

        const card = document.querySelector<HTMLElement>(`[data-work-item-id="makeup"][data-week-date="${localDateKey(weekStart)}"]`);
        const makeup = [...(card?.querySelectorAll<HTMLButtonElement>(".xz-week-item-actions button") ?? [])]
            .find((button) => button.textContent?.trim() === "补记完成");
        expect(makeup).toBeInstanceOf(HTMLButtonElement);
        makeup?.click();

        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledOnce());
        expect(saveItem.mock.calls[0][2].executionSlices).toEqual([expect.objectContaining({ id: "missed-slice", status: "completed" })]);
        /* 切片做满不再顺手结束事务：状态仍由用户点「完成事务」决定 */
        expect(saveItem.mock.calls[0][2].status).toBeUndefined();
        expect(saveItem.mock.calls[0][2].imageCleanup).toBeUndefined();
        await vi.waitFor(() => expect(document.querySelector(`[data-work-item-id="makeup"] .xz-week-item-meta`)?.textContent).toContain("进行中"));

        /* 补记完成后卡片会翻成「撤销完成」，等它渲染出来再点 */
        const weekActions = () => [...(document.querySelector<HTMLElement>(`[data-work-item-id="makeup"][data-week-date="${localDateKey(weekStart)}"]`)
            ?.querySelectorAll<HTMLButtonElement>(".xz-week-item-actions button") ?? [])];
        await vi.waitFor(() => expect(weekActions().some((button) => button.textContent?.trim() === "撤销完成")).toBe(true));
        weekActions().find((button) => button.textContent?.trim() === "撤销完成")?.click();

        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledTimes(2));
        expect(saveItem.mock.calls[1][2].executionSlices).toEqual([expect.objectContaining({
            id: "missed-slice",
            status: localDateKey(weekStart) < localDateKey(today) ? "missed" : "scheduled",
        })]);
        /* 事务本来就没离开「进行中」，撤销只回退切片，不再产生状态写入 */
        expect(saveItem.mock.calls[1][2].status).toBeUndefined();
        expect(saveItem.mock.calls[1][2].imageCleanup).toBeUndefined();
        await vi.waitFor(() => expect(document.querySelector(`[data-work-item-id="makeup"] .xz-week-item-meta`)?.textContent).toContain("进行中"));
    });

    it("事务先前已是已完成的存量数据，撤销切片完成后也会退回进行中", async () => {
        /* 用户实测的存量状态：事务早已手工标记为已完成，切片停在“未完成” */
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const item: WorkItem = {
            id: "legacy", rowId: "legacy", title: "存量已完成的事务", documentId: null, detached: true,
            type: "事务", status: "已完成", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: null, noDeadline: true, durationMinutes: 20, energy: "低", updatedAt: Date.now(),
            sliceTargetCount: 1,
            executionSlices: [{ id: "legacy-slice", scheduledDate: localDateKey(yesterday), status: "missed", completedAt: null, updatedAt: Date.now() }],
        };
        const workItemData: WorkItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [item], missingFields: [], fields: {},
        };
        const saveItem = vi.fn(async (currentData: WorkItemData, currentItem: WorkItem, changes: WorkItemChanges): Promise<WorkItemData> => ({
            ...currentData,
            items: currentData.items.map((candidate) => candidate.id === currentItem.id ? {
                ...candidate,
                ...(changes.executionSlices !== undefined ? { executionSlices: changes.executionSlices } : {}),
                ...(typeof changes.status === "string" ? { status: changes.status } : {}),
                ...(changes.imageCleanup !== undefined ? { imageCleanup: changes.imageCleanup } : {}),
            } : candidate),
        }));
        component = new XingzhouApp({
            target: document.body,
            props: { load: vi.fn().mockResolvedValue(workItemData), captureInbox: vi.fn(), saveItem, deleteItem: vi.fn(), openDocument: vi.fn() },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-workspace")).not.toBeNull());
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "本周")?.click();
        await tick();

        const actions = () => [...(document.querySelector<HTMLElement>(`[data-work-item-id="legacy"][data-week-date="${localDateKey(yesterday)}"]`)
            ?.querySelectorAll<HTMLButtonElement>(".xz-week-item-actions button") ?? [])];
        actions().find((button) => button.textContent?.trim() === "补记完成")?.click();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledOnce());
        /* 已结束的事务不被切片动作改写状态 */
        expect(saveItem.mock.calls[0][2].status).toBeUndefined();

        await vi.waitFor(() => expect(actions().some((button) => button.textContent?.trim() === "撤销完成")).toBe(true));
        actions().find((button) => button.textContent?.trim() === "撤销完成")?.click();
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledTimes(2));
        expect(saveItem.mock.calls[1][2].status).toBe("进行中");
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="legacy"] .xz-week-item-meta')?.textContent).toContain("进行中"));
    });

    it("已取消的事务在本周补记切片时不被改写成已完成", async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const item: WorkItem = {
            id: "cancelled", rowId: "cancelled", title: "已取消的事务", documentId: null, detached: true,
            type: "事务", status: "已取消", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: null, noDeadline: true, durationMinutes: 20, energy: "", updatedAt: Date.now(),
            sliceTargetCount: 1,
            executionSlices: [{ id: "missed-slice", scheduledDate: localDateKey(today), status: "missed", completedAt: null, updatedAt: Date.now() }],
        };
        const workItemData: WorkItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [item], missingFields: [], fields: {},
        };
        const saveItem = vi.fn(async (currentData: WorkItemData, currentItem: WorkItem, changes: WorkItemChanges): Promise<WorkItemData> => ({
            ...currentData,
            items: currentData.items.map((candidate) => candidate.id === currentItem.id ? {
                ...candidate,
                ...(changes.executionSlices !== undefined ? { executionSlices: changes.executionSlices } : {}),
                ...(typeof changes.status === "string" ? { status: changes.status } : {}),
            } : candidate),
        }));
        component = new XingzhouApp({
            target: document.body,
            props: { load: vi.fn().mockResolvedValue(workItemData), captureInbox: vi.fn(), saveItem, deleteItem: vi.fn(), openDocument: vi.fn() },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-workspace")).not.toBeNull());
        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "本周")?.click();
        await tick();

        const card = document.querySelector<HTMLElement>(`[data-work-item-id="cancelled"][data-week-date="${localDateKey(today)}"]`);
        [...(card?.querySelectorAll<HTMLButtonElement>(".xz-week-item-actions button") ?? [])]
            .find((button) => button.textContent?.trim() === "补记完成")?.click();

        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledOnce());
        expect(saveItem.mock.calls[0][2].status).toBeUndefined();
        expect(saveItem.mock.calls[0][2].imageCleanup).toBeUndefined();
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
                load: vi.fn().mockResolvedValue(workItemData), captureInbox: vi.fn(), saveItem: vi.fn(), deleteItem, openItemMenu,
                openDocument: vi.fn(),
            },
        });
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
        const domain = { ...base, id: "domain", rowId: "domain", title: "创作", type: "长期领域", status: "重点投入" };
        const maintainedDomain = { ...base, id: "maintained-domain", rowId: "maintained-domain", title: "家庭", type: "长期领域", status: "持续维持" };
        const projects = [1, 2, 3, 4].map((number) => ({
            ...base, id: `project-${number}`, rowId: `project-${number}`, title: `活跃项目 ${number}`, type: "项目", status: "进行中", parentIds: ["domain"],
        }));
        const inbox = { ...base, id: "inbox", rowId: "inbox", title: "需要归类的想法", type: "想法", status: "收件箱", currentAction: "" };
        const overdue = { ...base, id: "overdue", rowId: "overdue", title: "需要重新安排的事务", status: "已计划", currentAction: "", planDate: now - 3 * day, deadline: now - day };
        const completed = { ...base, id: "completed", rowId: "completed", title: "本周完成的事务", status: "已完成" };
        const workItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [domain, maintainedDomain, ...projects, inbox, overdue, completed], missingFields: [],
            fields: {
                title: { id: "title", name: "工作项", type: "block", options: [] },
                currentAction: { id: "current", name: "本次行动细则", type: "text", options: [] },
                nextAction: { id: "next", name: "下一步行动", type: "text", options: [] },
            },
        };
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue(workItemData),
                captureInbox: vi.fn(), saveItem: vi.fn(), deleteItem: vi.fn(), openDocument: vi.fn(),
            },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-workspace")).not.toBeNull());

        [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "整理")?.click();
        await tick();
        expect(document.body.textContent).toContain("每周整理");
        expect(document.body.textContent).toContain("确认重视什么");
        expect(document.body.textContent).toContain("1 个重点领域");
        expect(document.querySelector(".xz-review-page")?.textContent).toContain("创作");
        expect(document.querySelector(".xz-review-page")?.textContent).not.toContain("家庭");
        expect(document.body.textContent).toContain("确认正在做什么");
        expect(document.body.textContent).toContain("并行项目过多");
        expect(document.querySelector(".xz-review-page")?.textContent).not.toContain("收件箱");
        expect(document.querySelector(".xz-review-page")?.textContent).not.toContain("需要归类的想法");
        expect(document.body.textContent).toContain("需要重新安排的事务");
        expect(document.body.textContent).toContain("本周完成的事务");
        expect(document.querySelector(".xz-review-item-overdue")?.textContent).toContain("截止日期已过");
        expect([...document.querySelectorAll<HTMLButtonElement>(".xz-review-item-list button")].filter((button) => button.textContent?.includes("需要重新安排的事务"))).toHaveLength(1);
        const actionStep = [...document.querySelectorAll<HTMLElement>(".xz-review-step")].find((step) => step.querySelector("h3")?.textContent === "让执行项可以直接开始");
        expect(actionStep?.classList.contains("xz-review-step--ready")).toBe(true);

        expect(document.querySelector(".xz-review-step-number")?.textContent).toBe("1");
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
        const completedReference = { ...base, id: "completed-reference", rowId: "completed-reference", title: "已整理的参考资料", type: "事务", status: "已完成" };
        const futureReference = { ...base, id: "future-reference", rowId: "future-reference", title: "将来再整理的资料", type: "事务", status: "将来" };
        const workItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
            items: [mapArea, learning, writingArea, novel, mapDesign, reference, completedReference, futureReference], missingFields: [],
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
                load: vi.fn().mockResolvedValue(workItemData), captureInbox: vi.fn(), saveItem, deleteItem: vi.fn(),
                openDocument: vi.fn(),
            },
        });
        await vi.waitFor(() => expect(document.querySelector('[data-work-item-id="map-design"]'), document.body.innerHTML).not.toBeNull());
        (document.querySelector('[data-work-item-id="map-design"] .xz-tree-main') as HTMLButtonElement).click();
        await tick();

        expect(document.querySelector(".xz-dependency-card")?.textContent).toContain("Azgaar 使用学习");
        expect(document.querySelector(".xz-dependency-indicator")?.textContent).toContain("1");
        const hardSelect = document.querySelector('select[aria-label="添加完成后开始依赖"]') as HTMLSelectElement;
        const softSelect = document.querySelector('select[aria-label="添加需先行依赖"]') as HTMLSelectElement;
        expect([...hardSelect.options].map((option) => option.value)).toContain(reference.id);
        expect([...softSelect.options].map((option) => option.value)).toContain(reference.id);
        expect([...hardSelect.options].map((option) => option.value)).not.toContain(completedReference.id);
        expect([...softSelect.options].map((option) => option.value)).not.toContain(completedReference.id);
        expect([...hardSelect.options].map((option) => option.value)).not.toContain(futureReference.id);
        expect([...softSelect.options].map((option) => option.value)).not.toContain(futureReference.id);
        hardSelect.value = reference.id;
        hardSelect.dispatchEvent(new Event("change", { bubbles: true }));
        await vi.waitFor(() => expect(saveItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: mapDesign.id }), {
            hardPrerequisites: [reference.id],
        }));

        (document.querySelector('[data-work-item-id="learning"] .xz-tree-main') as HTMLButtonElement).click();
        await tick();
        expect(document.querySelector(".xz-dependency-supported")?.textContent).toContain("恶魔的尾巴小说地图设计");
    });

    it("自动生成未完成工作关系图，并从图中进入现有详情", async () => {
        const base: WorkItem = {
            id: "base", rowId: "base", title: "基础条目", documentId: null, detached: true,
            type: "项目", status: "待开始", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            hardPrerequisiteIds: [], softPrerequisiteIds: [], planDate: null, deadline: null, noDeadline: false,
            durationMinutes: null, energy: "", updatedAt: Date.now(),
        };
        const domain = { ...base, id: "domain", rowId: "domain", title: "写小说", type: "长期领域", status: "重点投入" };
        const project = { ...base, id: "project", rowId: "project", title: "恶魔的尾巴第一季", status: "进行中", parentIds: [domain.id] };
        const prerequisite = { ...base, id: "prerequisite", rowId: "prerequisite", title: "完成世界观设定", type: "事务", status: "进行中", parentIds: [project.id] };
        const transaction = { ...base, id: "transaction", rowId: "transaction", title: "完成第二章", type: "事务", status: "待开始", parentIds: [project.id], hardPrerequisiteIds: [prerequisite.id] };
        const completed = { ...base, id: "completed", rowId: "completed", title: "已完成章节", type: "事务", status: "已完成", parentIds: [project.id] };
        component = new XingzhouApp({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue({
                    attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view",
                    items: [domain, project, prerequisite, transaction, completed], missingFields: [], fields: {},
                }),
                captureInbox: vi.fn(), saveItem: vi.fn(), deleteItem: vi.fn(), openDocument: vi.fn(),
            },
        });
        await vi.waitFor(() => expect(document.querySelector(".xz-workspace")).not.toBeNull());
        [...document.querySelectorAll<HTMLButtonElement>(".xz-main-nav button")].find((button) => button.textContent?.trim() === "关系图")?.click();
        await vi.waitFor(() => expect(document.querySelector(".xz-relationship-page")).not.toBeNull());

        expect(document.querySelector('[data-work-item-id="domain"].xz-relationship-node')).not.toBeNull();
        expect(document.querySelector('[data-work-item-id="project"].xz-relationship-node')).not.toBeNull();
        expect(document.querySelector('[data-work-item-id="transaction"].xz-relationship-node')).not.toBeNull();
        expect(document.querySelector('[data-work-item-id="completed"].xz-relationship-node')).toBeNull();
        expect(document.querySelector(".xz-relationship-node.dimmed")).toBeNull();
        const graphSvg = document.querySelector<SVGSVGElement>(".xz-relationship-canvas > svg");
        expect(graphSvg?.style.width).toMatch(/^\d+(?:\.\d+)?px$/);
        expect(graphSvg?.style.height).toMatch(/^\d+(?:\.\d+)?px$/);
        const ongoingPill = document.querySelector<SVGRectElement>('[data-work-item-id="project"] .xz-relationship-status-pill.ongoing');
        expect(ongoingPill?.getAttribute("rx")).toBe("9");
        expect(ongoingPill?.getAttribute("height")).toBe("18");
        expect(document.querySelectorAll(".xz-relationship-edge.hierarchy").length).toBeGreaterThan(0);
        expect(document.querySelectorAll(".xz-relationship-edge.hard")).toHaveLength(1);
        expect(document.querySelector(".xz-relationship-edge-label.hard")?.textContent).toContain("“完成世界观…”完成 → “完成第二章”开始");
        expect(document.querySelector('.xz-relationship-edge.hard.direct[data-from-id="prerequisite"][data-to-id="transaction"]')).not.toBeNull();

        const transactionToggle = [...document.querySelectorAll<HTMLButtonElement>(".xz-relationship-toggle")].find((button) => button.textContent?.includes("事务"))!;
        transactionToggle.click();
        await tick();
        expect(document.querySelector('[data-work-item-id="transaction"].xz-relationship-node')).toBeNull();
        expect(document.querySelector('[data-work-item-id="project"].xz-relationship-node')).not.toBeNull();
        transactionToggle.click();
        await tick();
        expect(document.querySelector('[data-work-item-id="transaction"].xz-relationship-node')).not.toBeNull();

        const hardToggle = [...document.querySelectorAll<HTMLButtonElement>(".xz-relationship-toggle")].find((button) => button.textContent?.includes("完成后开始"))!;
        hardToggle.click();
        await tick();
        expect(document.querySelector(".xz-relationship-edge.hard")).toBeNull();
        hardToggle.click();
        await tick();

        (document.querySelector('[data-work-item-id="transaction"].xz-relationship-node') as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await tick();
        expect(document.querySelector(".xz-relationship-inspector")?.textContent).toContain("完成世界观设定");
        expect(document.querySelector(".xz-relationship-inspector")?.textContent).toContain("开始本项前必须完成");
        expect(document.querySelector(".xz-relationship-node.dimmed")).not.toBeNull();
        (document.querySelector(".xz-relationship-canvas") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await tick();
        expect(document.querySelector(".xz-relationship-node.dimmed")).toBeNull();
        expect(document.querySelector(".xz-relationship-inspector")?.textContent).toContain("完成第二章");
        (document.querySelector(".xz-relationship-open") as HTMLButtonElement).click();
        await vi.waitFor(() => expect((document.querySelector('.xz-detail input[aria-label="名称"]') as HTMLInputElement)?.value).toBe("完成第二章"));
    });
});
