import { describe, expect, it } from "vitest";
import {
    addTodo,
    completedTodoCount,
    createTodo,
    dropOpenTodos,
    dropTodos,
    droppedTodoCount,
    findTodo,
    hasUnfinishedTodos,
    normalizeTodos,
    openTodos,
    removeTodo,
    sortTodosForDisplay,
    todoCompletionPercent,
    todoDenominator,
    todoProgress,
    toggleTodoDone,
    toggleTodoDropped,
    updateTodoLinks,
    updateTodoNote,
    updateTodoText,
    type Todo,
} from "../src/todos";

const NOW = new Date("2026-09-21T10:00:00").getTime();
const TODAY = "2026-09-21";

function todo(overrides: Partial<Todo> = {}): Todo {
    return {
        id: "todo-1",
        text: "写测试",
        status: "open",
        note: "",
        links: [],
        createdAt: NOW,
        updatedAt: NOW,
        completedOn: null,
        droppedReason: "",
        ...overrides,
    };
}

describe("待办归一化", () => {
    it("丢弃没有内容的条目，并为缺失 id 的条目补一个唯一 id", () => {
        const todos = normalizeTodos([
            { text: "  有效  " },
            { text: "   " },
            null,
            { id: "fixed", text: "有 id" },
            { id: "fixed", text: "重复 id" },
        ]);
        expect(todos.map((item) => item.text)).toEqual(["有效", "有 id", "重复 id"]);
        expect(todos[1].id).toBe("fixed");
        expect(todos[2].id).not.toBe("fixed");
    });

    it("标题压成单行，超长内容被截断", () => {
        const [item] = normalizeTodos([{ text: "第一行\n\n第二行\t第三处", createdAt: NOW }]);
        expect(item.text).toBe("第一行 第二行 第三处");
        const [long] = normalizeTodos([{ text: "x".repeat(600), createdAt: NOW }]);
        expect(long.text.length).toBe(500);
    });

    it("非法状态退回未开始，完成日期只在完成态保留", () => {
        expect(normalizeTodos([{ text: "a", status: "weird" }])[0].status).toBe("open");
        expect(normalizeTodos([{ text: "a", status: "open", completedOn: TODAY }])[0].completedOn).toBeNull();
        expect(normalizeTodos([{ text: "a", status: "done", completedOn: TODAY }])[0].completedOn).toBe(TODAY);
        expect(normalizeTodos([{ text: "a", status: "done", completedOn: "昨天" }])[0].completedOn).toBeNull();
        expect(normalizeTodos([{ text: "a", status: "open", droppedReason: "不想做" }])[0].droppedReason).toBe("");
        expect(normalizeTodos([{ text: "a", status: "dropped", droppedReason: " 不想做 " }])[0].droppedReason).toBe("不想做");
    });

    it("去掉重复与空链接", () => {
        const [item] = normalizeTodos([{ text: "a", links: ["https://a", "https://a", "", "  ", "https://b"] }]);
        expect(item.links).toEqual(["https://a", "https://b"]);
    });
});

describe("待办进度口径", () => {
    const todos = [
        todo({ id: "1", status: "done" }),
        todo({ id: "2", status: "done" }),
        todo({ id: "3", status: "open" }),
        todo({ id: "4", status: "open" }),
        todo({ id: "5", status: "open" }),
        todo({ id: "6", status: "dropped" }),
    ];

    it("分母不含放弃项", () => {
        expect(todoDenominator(todos)).toBe(5);
        expect(completedTodoCount(todos)).toBe(2);
        expect(droppedTodoCount(todos)).toBe(1);
        expect(openTodos(todos)).toHaveLength(3);
        expect(todoCompletionPercent(todos)).toBe(40);
    });

    it("全部放弃时读数是 0/0 且视为已清空", () => {
        const progress = todoProgress(todos.map((item) => ({ ...item, status: "dropped" as const })));
        expect(progress).toMatchObject({ denominator: 0, done: 0, dropped: 6, percent: 0, cleared: true });
    });

    it("空清单算已清空，且有未完成项时才需要拦截", () => {
        expect(todoProgress([])).toMatchObject({ denominator: 0, cleared: true });
        expect(hasUnfinishedTodos([])).toBe(false);
        expect(hasUnfinishedTodos(todos)).toBe(true);
        expect(hasUnfinishedTodos(todos.filter((item) => item.status !== "open"))).toBe(false);
    });
});

describe("待办增删改", () => {
    it("新增时拒绝空内容并保留创建顺序", () => {
        const first = addTodo([], "第一条", NOW, "todo-a");
        const second = addTodo(first, "第二条", NOW + 1, "todo-b");
        expect(second.map((item) => item.id)).toEqual(["todo-a", "todo-b"]);
        expect(() => addTodo([], "   ")).toThrow(/不能为空/);
    });

    it("创建出的事件字段完整", () => {
        expect(createTodo("做事", NOW, "todo-x")).toEqual({
            id: "todo-x",
            text: "做事",
            status: "open",
            note: "",
            links: [],
            createdAt: NOW,
            updatedAt: NOW,
            completedOn: null,
            droppedReason: "",
        });
    });

    it("改文字、备注与链接都会刷新 updatedAt", () => {
        const todos = [todo()];
        expect(updateTodoText(todos, "todo-1", "改后的标题", NOW + 5)[0]).toMatchObject({ text: "改后的标题", updatedAt: NOW + 5 });
        expect(updateTodoText(todos, "todo-1", "   ", NOW + 5)[0].text).toBe("写测试");
        expect(updateTodoNote(todos, "todo-1", "备注", NOW + 6)[0].note).toBe("备注");
        expect(updateTodoLinks(todos, "todo-1", ["https://a"], NOW + 7)[0].links).toEqual(["https://a"]);
        expect(() => updateTodoText(todos, "missing", "x")).toThrow(/没有找到/);
    });

    it("勾选完成记录当天日期，再点一次撤销", () => {
        const done = toggleTodoDone([todo()], "todo-1", TODAY, NOW + 10);
        expect(done[0]).toMatchObject({ status: "done", completedOn: TODAY, updatedAt: NOW + 10 });
        const reopened = toggleTodoDone(done, "todo-1", TODAY, NOW + 11);
        expect(reopened[0]).toMatchObject({ status: "open", completedOn: null });
    });

    it("打叉保留痕迹并可恢复，勾选完成会清掉放弃原因", () => {
        const dropped = toggleTodoDropped([todo()], "todo-1", "不做了", NOW + 20);
        expect(dropped[0]).toMatchObject({ status: "dropped", droppedReason: "不做了", completedOn: null });
        const restored = toggleTodoDropped(dropped, "todo-1", "", NOW + 21);
        expect(restored[0]).toMatchObject({ status: "open", droppedReason: "" });

        const doneFromDropped = toggleTodoDone(dropped, "todo-1", TODAY, NOW + 22);
        expect(doneFromDropped[0]).toMatchObject({ status: "done", droppedReason: "" });
    });

    it("批量打叉只影响未放弃的条目", () => {
        const todos = [todo({ id: "1" }), todo({ id: "2", status: "done" }), todo({ id: "3", status: "dropped" })];
        const dropped = dropTodos(todos, ["1", "2", "3"], NOW + 30);
        expect(dropped.map((item) => item.status)).toEqual(["dropped", "dropped", "dropped"]);
        expect(dropped[1].completedOn).toBeNull();
        expect(dropTodos(dropped, ["1"], NOW + 31)[0].updatedAt).toBe(dropped[0].updatedAt);
    });

    it("完成事务时把未完成的打叉，已完成与已放弃的保持原样", () => {
        const todos = [todo({ id: "1" }), todo({ id: "2", status: "done", completedOn: TODAY }), todo({ id: "3", status: "dropped" })];
        const dropped = dropOpenTodos(todos, NOW + 40);
        expect(dropped[0]).toMatchObject({ status: "dropped", completedOn: null, updatedAt: NOW + 40 });
        expect(dropped[1]).toMatchObject({ status: "done", completedOn: TODAY });
        expect(dropped[2].status).toBe("dropped");
    });

    it("删除与查找", () => {
        const todos = [todo({ id: "1" }), todo({ id: "2" })];
        expect(removeTodo(todos, "1").map((item) => item.id)).toEqual(["2"]);
        expect(findTodo(todos, "2")?.id).toBe("2");
        expect(findTodo(todos, "missing")).toBeUndefined();
    });
});

describe("待办展示排序", () => {
    it("未完成在前、已完成次之、已放弃最后，同类按创建时间", () => {
        const todos = [
            todo({ id: "d", status: "dropped", createdAt: 1 }),
            todo({ id: "b", status: "done", createdAt: 2 }),
            todo({ id: "c", status: "open", createdAt: 3 }),
            todo({ id: "a", status: "open", createdAt: 1 }),
        ];
        expect(sortTodosForDisplay(todos).map((item) => item.id)).toEqual(["a", "c", "b", "d"]);
    });
});
