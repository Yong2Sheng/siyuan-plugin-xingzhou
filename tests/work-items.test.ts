import { describe, expect, it } from "vitest";
import { buildWorkItemTree, collectDescendantIds, hasActiveDescendant } from "../src/tree";
import { parseRenderedAttributeView, type RenderedAttributeView, type WorkItem } from "../src/work-items";

function renderedFixture(): RenderedAttributeView {
    const columns = [
        { id: "title", name: "工作项", type: "block" },
        { id: "type", name: "工作项类型", type: "select" },
        { id: "status", name: "状态", type: "select" },
        { id: "parent", name: "上层工作项", type: "relation" },
        { id: "top", name: "所属顶层项目", type: "relation" },
        { id: "plan", name: "计划日期", type: "date" },
        { id: "next", name: "下一步行动", type: "text" },
    ];
    return {
        id: "av-id",
        name: "改变2026·个人项目与事务",
        viewID: "all-view",
        viewType: "table",
        views: [{ id: "all-view", name: "全部工作项", type: "table" }],
        view: {
            columns,
            rows: [
                {
                    id: "row-domain",
                    cells: [
                        { value: { keyID: "title", blockID: "domain", type: "block", block: { content: "写小说", id: "domain-doc" } } },
                        { value: { keyID: "type", type: "select", mSelect: [{ content: "长期领域" }] } },
                        { value: { keyID: "status", type: "select", mSelect: [{ content: "活跃" }] } },
                    ],
                },
                {
                    id: "row-task",
                    cells: [
                        { value: { keyID: "title", blockID: "task", type: "block", isDetached: true, block: { content: "收集城堡资料" } } },
                        { value: { keyID: "type", type: "select", mSelect: [{ content: "事务" }] } },
                        { value: { keyID: "status", type: "select", mSelect: [{ content: "进行中" }] } },
                        { value: { keyID: "parent", type: "relation", relation: { blockIDs: ["domain"] } } },
                        { value: { keyID: "top", type: "relation", relation: { blockIDs: ["domain"] } } },
                        { value: { keyID: "plan", type: "date", date: { content: 1788048000000, isNotEmpty: true } } },
                        { value: { keyID: "next", type: "text", text: { content: "整理十张参考图" } } },
                    ],
                },
            ],
        },
    };
}

describe("parseRenderedAttributeView", () => {
    it("把属性视图行转换成稳定的工作项模型", () => {
        const result = parseRenderedAttributeView(renderedFixture());
        expect(result.items).toHaveLength(2);
        expect(result.items[0]).toMatchObject({
            id: "domain",
            title: "写小说",
            documentId: "domain-doc",
            type: "长期领域",
        });
        expect(result.items[1]).toMatchObject({
            id: "task",
            parentIds: ["domain"],
            nextAction: "整理十张参考图",
            detached: true,
            documentId: null,
        });
        expect(result.missingFields).toContain("本次行动细则");
    });
});

describe("buildWorkItemTree", () => {
    it("建立直接父子关系并识别活跃路径", () => {
        const items = parseRenderedAttributeView(renderedFixture()).items;
        const tree = buildWorkItemTree(items);
        expect(tree.roots.map((item) => item.id)).toEqual(["domain"]);
        expect(tree.children.get("domain")?.map((item) => item.id)).toEqual(["task"]);
        expect(hasActiveDescendant("domain", tree)).toBe(true);
        expect([...collectDescendantIds("domain", tree)]).toEqual(["domain", "task"]);
    });

    it("只提示循环和多个父项，不自动改写数据", () => {
        const a = item({ id: "a", title: "A", parentIds: ["b", "c"] });
        const b = item({ id: "b", title: "B", parentIds: ["a"] });
        const c = item({ id: "c", title: "C" });
        const tree = buildWorkItemTree([a, b, c]);
        expect(tree.issues.some((issue) => issue.kind === "multiple-parents" && issue.itemId === "a")).toBe(true);
        expect(tree.issues.some((issue) => issue.kind === "cycle")).toBe(true);
        expect(a.parentIds).toEqual(["b", "c"]);
    });
});

function item(overrides: Partial<WorkItem> & Pick<WorkItem, "id" | "title">): WorkItem {
    return {
        rowId: overrides.id,
        documentId: null,
        detached: true,
        type: "项目",
        status: "活跃",
        currentAction: "",
        nextAction: "",
        parentIds: [],
        topProjectIds: [],
        planDate: null,
        deadline: null,
        durationMinutes: null,
        energy: "",
        ...overrides,
    };
}
