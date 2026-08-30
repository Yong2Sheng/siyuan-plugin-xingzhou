import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestSiYuan } from "../src/siyuan-api";
import { captureInboxItem, updateWorkItem, type AttributeViewDefinition, type RenderedAttributeView, type WorkItemData } from "../src/work-items";

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

    it("编辑独立条目后重新读取数据库并复核结果", async () => {
        const data: WorkItemData = {
            attributeViewId: "av-id", attributeViewName: "测试数据库", viewId: "all-view", missingFields: [],
            fields: {
                status: { id: "status", name: "状态", type: "select", options: [{ name: "待开始", color: "4" }] },
                currentAction: { id: "current", name: "本次行动细则", type: "text", options: [] },
                nextAction: { id: "next", name: "下一步行动", type: "text", options: [] },
            },
            items: [{
                id: "item-1", rowId: "item-1", title: "清理垃圾", documentId: null, detached: true,
                type: "事务", status: "收件箱", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
                planDate: null, deadline: null, durationMinutes: null, energy: "", updatedAt: null,
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
                ],
                rows: [{ id: "item-1", cells: [
                    { value: { keyID: "title", blockID: "item-1", isDetached: true, block: { content: "清理垃圾" } } },
                    { value: { keyID: "status", mSelect: [{ content: "待开始", color: "4" }] } },
                    { value: { keyID: "current", text: { content: "收集各房间垃圾并更换垃圾袋" } } },
                    { value: { keyID: "next", text: { content: "拿垃圾袋装好并带下楼" } } },
                ] }],
            },
        };
        requestMock
            .mockResolvedValueOnce({ value: {} })
            .mockResolvedValueOnce({ value: {} })
            .mockResolvedValueOnce({ value: {} })
            .mockResolvedValueOnce(definition)
            .mockResolvedValueOnce(rendered);

        const result = await updateWorkItem(data, data.items[0], {
            status: "待开始",
            currentAction: "收集各房间垃圾并更换垃圾袋",
            nextAction: "拿垃圾袋装好并带下楼",
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
        expect(result.items[0]).toMatchObject({ status: "待开始", currentAction: "收集各房间垃圾并更换垃圾袋", nextAction: "拿垃圾袋装好并带下楼" });
    });
});
