import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestSiYuan } from "../src/siyuan-api";
import { captureInboxItem, deleteWorkItem, updateWorkItem, type AttributeViewDefinition, type RenderedAttributeView, type WorkItemData } from "../src/work-items";

vi.mock("../src/siyuan-api", () => ({
    requestSiYuan: vi.fn(),
}));

const requestMock = vi.mocked(requestSiYuan);

describe("captureInboxItem", () => {
    beforeEach(() => requestMock.mockReset());

    it("向快速收件箱视图新增独立行，并在重新读取确认状态后返回数据", async () => {
        const itemId = "20260829200000-abc1234";
        const definition: AttributeViewDefinition = {
            av: {
                id: "av-id",
                name: "测试数据库",
                views: [
                    { id: "all-view", name: "全部工作项", type: "table" },
                    { id: "inbox-view", name: "快速收件箱", type: "table" },
                ],
            },
        };
        const rendered: RenderedAttributeView = {
            id: "av-id",
            name: "测试数据库",
            viewID: "all-view",
            viewType: "table",
            views: definition.av?.views ?? [],
            view: {
                columns: [
                    { id: "title", name: "工作项", type: "block" },
                    { id: "status", name: "状态", type: "select" },
                    { id: "updated", name: "最近更新", type: "updated" },
                ],
                rows: [{
                    id: itemId,
                    cells: [
                        { value: { keyID: "title", blockID: itemId, isDetached: true, block: { content: "整理旧合同" } } },
                        { value: { keyID: "status", mSelect: [{ content: "收件箱", color: "1" }] } },
                        { value: { keyID: "updated", updated: { content: 1788048000000, isNotEmpty: true } } },
                    ],
                }],
            },
        };

        requestMock
            .mockResolvedValueOnce(definition)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(definition)
            .mockResolvedValueOnce(rendered);

        const result = await captureInboxItem("av-id", "database-block", "  整理旧合同  ", () => itemId);

        expect(requestMock).toHaveBeenNthCalledWith(2, "/api/av/addAttributeViewBlocks", expect.objectContaining({
            avID: "av-id",
            blockID: "database-block",
            viewID: "inbox-view",
            ignoreDefaultFill: false,
            srcs: [{ id: itemId, itemID: itemId, isDetached: true, content: "整理旧合同" }],
        }));
        expect(result.items[0]).toMatchObject({ id: itemId, title: "整理旧合同", status: "收件箱", detached: true });
    });

    it("上下文捕获后写入类型、直接父项和推导出的顶层项目", async () => {
        const itemId = "20260830170000-child01";
        const definition: AttributeViewDefinition = {
            av: {
                id: "av-id", name: "测试数据库",
                views: [{ id: "inbox-view", name: "快速收件箱", type: "table" }],
                keyValues: [
                    { key: { id: "title", name: "工作项", type: "block" } },
                    { key: { id: "type", name: "工作项类型", type: "select", options: [{ name: "事务", color: "2" }] } },
                    { key: { id: "status", name: "状态", type: "select", options: [{ name: "收件箱", color: "1" }] } },
                    { key: { id: "parent", name: "上层工作项", type: "relation" } },
                    { key: { id: "top", name: "所属顶层项目", type: "relation" } },
                ],
            },
        };
        const rendered = (withContext: boolean): RenderedAttributeView => ({
            id: "av-id", name: "测试数据库", viewID: "inbox-view", viewType: "table", views: definition.av?.views ?? [],
            view: {
                columns: [
                    { id: "title", name: "工作项", type: "block" },
                    { id: "type", name: "工作项类型", type: "select" },
                    { id: "status", name: "状态", type: "select" },
                    { id: "parent", name: "上层工作项", type: "relation" },
                    { id: "top", name: "所属顶层项目", type: "relation" },
                ],
                rows: [{ id: itemId, cells: [
                    { value: { keyID: "title", blockID: itemId, isDetached: true, block: { content: "整理参考资料" } } },
                    { value: { keyID: "type", mSelect: withContext ? [{ content: "事务", color: "2" }] : [] } },
                    { value: { keyID: "status", mSelect: [{ content: "收件箱", color: "1" }] } },
                    { value: { keyID: "parent", relation: { blockIDs: withContext ? ["project-child"] : [] } } },
                    { value: { keyID: "top", relation: { blockIDs: withContext ? ["project-top"] : [] } } },
                ] }],
            },
        });
        requestMock
            .mockResolvedValueOnce(definition)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(definition)
            .mockResolvedValueOnce(rendered(false))
            .mockResolvedValueOnce({ value: {} })
            .mockResolvedValueOnce({ value: {} })
            .mockResolvedValueOnce({ value: {} })
            .mockResolvedValueOnce(definition)
            .mockResolvedValueOnce(rendered(true));

        const result = await captureInboxItem("av-id", "database-block", "整理参考资料", () => itemId, {
            type: "事务", parentId: "project-child", topProjectId: "project-top",
        });

        expect(requestMock).toHaveBeenNthCalledWith(5, "/api/av/setAttributeViewBlockAttr", expect.objectContaining({ keyID: "type", itemID: itemId }));
        expect(requestMock).toHaveBeenNthCalledWith(6, "/api/av/setAttributeViewBlockAttr", expect.objectContaining({ keyID: "parent", itemID: itemId }));
        expect(requestMock).toHaveBeenNthCalledWith(7, "/api/av/setAttributeViewBlockAttr", expect.objectContaining({ keyID: "top", itemID: itemId }));
        expect(result.items[0]).toMatchObject({ type: "事务", parentIds: ["project-child"], topProjectIds: ["project-top"] });
    });

    it("编辑独立条目后重新读取数据库并复核结果", async () => {
        const data: WorkItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view", missingFields: [],
            fields: {
                status: { id: "status", name: "状态", type: "select", options: [{ name: "待开始", color: "4" }] },
                currentAction: { id: "current", name: "本次行动细则", type: "text", options: [] },
                nextAction: { id: "next", name: "下一步行动", type: "text", options: [] },
                parent: { id: "parent", name: "上层工作项", type: "relation", options: [] },
                noDeadline: { id: "no-deadline", name: "无截止日期", type: "checkbox", options: [] },
            },
            items: [{
                id: "item-1", rowId: "item-1", title: "清理垃圾", documentId: null, detached: true,
                type: "事务", status: "收件箱", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
                planDate: null, deadline: null, noDeadline: false, durationMinutes: null, energy: "", updatedAt: null,
            }, {
                id: "project-1", rowId: "project-1", title: "家庭整理", documentId: null, detached: true,
                type: "项目", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
                planDate: null, deadline: null, noDeadline: false, durationMinutes: null, energy: "", updatedAt: null,
            }],
        };
        const definition: AttributeViewDefinition = {
            av: {
                id: "av-id", name: "测试数据库", views: [{ id: "all-view", name: "全部工作项", type: "table" }],
                keyValues: [
                    { key: { id: "title", name: "工作项", type: "block" } },
                    { key: { id: "status", name: "状态", type: "select", options: [{ name: "待开始", color: "4" }] } },
                    { key: { id: "current", name: "本次行动细则", type: "text" } },
                    { key: { id: "next", name: "下一步行动", type: "text" } },
                    { key: { id: "parent", name: "上层工作项", type: "relation" } },
                    { key: { id: "no-deadline", name: "无截止日期", type: "checkbox" } },
                ],
            },
        };
        const rendered: RenderedAttributeView = {
            id: "av-id", name: "测试数据库", viewID: "all-view", viewType: "table", views: definition.av?.views ?? [],
            view: {
                columns: [
                    { id: "title", name: "工作项", type: "block" },
                    { id: "status", name: "状态", type: "select" },
                    { id: "current", name: "本次行动细则", type: "text" },
                    { id: "next", name: "下一步行动", type: "text" },
                    { id: "parent", name: "上层工作项", type: "relation" },
                    { id: "no-deadline", name: "无截止日期", type: "checkbox" },
                ],
                rows: [{ id: "item-1", cells: [
                    { value: { keyID: "title", blockID: "item-1", isDetached: true, block: { content: "清理垃圾" } } },
                    { value: { keyID: "status", mSelect: [{ content: "待开始", color: "4" }] } },
                    { value: { keyID: "current", text: { content: "收集各房间垃圾并更换垃圾袋" } } },
                    { value: { keyID: "next", text: { content: "拿垃圾袋装好并带下楼" } } },
                    { value: { keyID: "parent", relation: { blockIDs: ["project-1"] } } },
                    { value: { keyID: "no-deadline", checkbox: { checked: true } } },
                ] }, { id: "project-1", cells: [
                    { value: { keyID: "title", blockID: "project-1", isDetached: true, block: { content: "家庭整理" } } },
                    { value: { keyID: "status", mSelect: [{ content: "进行中", color: "5" }] } },
                ] }],
            },
        };
        requestMock
            .mockResolvedValueOnce({ value: {} })
            .mockResolvedValueOnce({ value: {} })
            .mockResolvedValueOnce({ value: {} })
            .mockResolvedValueOnce({ value: {} })
            .mockResolvedValueOnce({ value: {} })
            .mockResolvedValueOnce(definition)
            .mockResolvedValueOnce(rendered);

        const result = await updateWorkItem(data, data.items[0], {
            status: "待开始",
            currentAction: "收集各房间垃圾并更换垃圾袋",
            nextAction: "拿垃圾袋装好并带下楼",
            parent: "project-1",
            noDeadline: true,
        });

        expect(requestMock).toHaveBeenNthCalledWith(1, "/api/av/setAttributeViewBlockAttr", expect.objectContaining({
            keyID: "status", itemID: "item-1", value: { type: "select", mSelect: [{ content: "待开始", color: "4" }] },
        }));
        expect(requestMock).toHaveBeenNthCalledWith(2, "/api/av/setAttributeViewBlockAttr", expect.objectContaining({
            keyID: "current", itemID: "item-1", value: { type: "text", text: { content: "收集各房间垃圾并更换垃圾袋" } },
        }));
        expect(requestMock).toHaveBeenNthCalledWith(3, "/api/av/setAttributeViewBlockAttr", expect.objectContaining({
            keyID: "next", itemID: "item-1", value: { type: "text", text: { content: "拿垃圾袋装好并带下楼" } },
        }));
        expect(requestMock).toHaveBeenNthCalledWith(4, "/api/av/setAttributeViewBlockAttr", expect.objectContaining({
            keyID: "parent", itemID: "item-1", value: { type: "relation", relation: { blockIDs: ["project-1"], contents: [] } },
        }));
        expect(requestMock).toHaveBeenNthCalledWith(5, "/api/av/setAttributeViewBlockAttr", expect.objectContaining({
            keyID: "no-deadline", itemID: "item-1", value: { type: "checkbox", checkbox: { checked: true } },
        }));
        expect(result.items[0]).toMatchObject({ status: "待开始", currentAction: "收集各房间垃圾并更换垃圾袋", nextAction: "拿垃圾袋装好并带下楼", parentIds: ["project-1"], noDeadline: true });
    });

    it("删除工作项时使用属性视图行 ID，并在重新读取后确认条目消失", async () => {
        const item = {
            id: "source-block", rowId: "row-item", title: "一次性事务", documentId: "source-block", detached: false,
            type: "事务", status: "待开始", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
            planDate: null, deadline: null, noDeadline: false, durationMinutes: null, energy: "", updatedAt: null,
        };
        const data: WorkItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view", items: [item], missingFields: [], fields: {},
        };
        const definition: AttributeViewDefinition = {
            av: { id: "av-id", name: "测试数据库", views: [{ id: "all-view", name: "全部工作项", type: "table" }] },
        };
        const rendered: RenderedAttributeView = {
            id: "av-id", name: "测试数据库", viewID: "all-view", viewType: "table", views: definition.av?.views ?? [],
            view: { columns: [{ id: "title", name: "工作项", type: "block" }], rows: [] },
        };
        requestMock
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(definition)
            .mockResolvedValueOnce(rendered);

        const result = await deleteWorkItem(data, item);

        expect(requestMock).toHaveBeenNthCalledWith(1, "/api/av/removeAttributeViewBlocks", {
            avID: "av-id",
            srcIDs: ["row-item"],
        });
        expect(result.items).toEqual([]);
    });
});
