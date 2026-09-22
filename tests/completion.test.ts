import { describe, expect, it } from "vitest";
import { completionBlockers, completionReasonLine, hasUnfinishedWork } from "../src/completion";
import type { ExecutionSlice } from "../src/execution-slices";
import type { Todo } from "../src/todos";

const TODAY = "2026-09-21";
const NOW = new Date("2026-09-21T10:00:00").getTime();

function slice(overrides: Partial<ExecutionSlice> = {}): ExecutionSlice {
    return { id: "slice-1", scheduledDate: "2026-09-24", status: "scheduled", completedAt: null, updatedAt: NOW, ...overrides };
}

function todo(overrides: Partial<Todo> = {}): Todo {
    return {
        id: "todo-1", text: "写测试", status: "open", note: "", links: [],
        createdAt: NOW, updatedAt: NOW, completedOn: null, droppedReason: "", ...overrides,
    };
}

describe("完成事务的拦截项", () => {
    it("没有未完成项时不需要处置", () => {
        const blockers = completionBlockers(
            [slice({ status: "completed" }), slice({ id: "s2", status: "abandoned" })],
            [todo({ status: "done" }), todo({ id: "t2", status: "dropped" })],
            TODAY,
        );
        expect(blockers.needsDisposition).toBe(false);
        expect(blockers.items).toEqual([]);
        expect(blockers.summary).toBe("");
    });

    it("已安排与错过的切片、未完成的待办都算未完成，已放弃的不算", () => {
        const blockers = completionBlockers(
            [slice({ id: "s1", status: "scheduled" }), slice({ id: "s2", status: "missed", scheduledDate: "2026-09-15" }), slice({ id: "s3", status: "abandoned" })],
            [todo({ id: "t1" }), todo({ id: "t2", status: "done" }), todo({ id: "t3", status: "dropped" })],
            TODAY,
        );
        expect(blockers.needsDisposition).toBe(true);
        expect(blockers.slices.map((item) => item.id)).toEqual(["s1", "s2"]);
        expect(blockers.todos.map((item) => item.id)).toEqual(["t1"]);
        expect(blockers.summary).toBe("2 片切片、1 条待办");
        expect(blockers.items.map((item) => item.kind)).toEqual(["slice", "slice", "todo"]);
    });

    it("切片文案区分错过、过期与已安排", () => {
        const blockers = completionBlockers([
            slice({ id: "s1", status: "missed", scheduledDate: "2026-09-15" }),
            slice({ id: "s2", status: "scheduled", scheduledDate: "2026-09-20" }),
            slice({ id: "s3", status: "scheduled", scheduledDate: "2026-09-25" }),
        ], [], TODAY);
        expect(blockers.items.map((item) => item.label)).toEqual([
            "错过的切片 · 2026-09-15",
            "已过期的切片 · 2026-09-20",
            "已安排的切片 · 2026-09-25",
        ]);
    });

    it("hasUnfinishedWork 与拦截项一致", () => {
        expect(hasUnfinishedWork([slice()], [])).toBe(true);
        expect(hasUnfinishedWork([slice({ status: "abandoned" })], [todo()])).toBe(true);
        expect(hasUnfinishedWork([slice({ status: "completed" })], [todo({ status: "dropped" })])).toBe(false);
    });
});

describe("结束原因行", () => {
    it("压成单行并带日期前缀", () => {
        expect(completionReasonLine("  项目取消\n不再推进  ", TODAY)).toBe("（2026-09-21 结束事务：项目取消 不再推进）");
        expect(completionReasonLine("   ", TODAY)).toBe("");
    });
});
