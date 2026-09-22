import { describe, expect, it } from "vitest";
import {
    actionDetailMissing,
    actionDetailToLegacyText,
    addOutcome,
    createEmptyActionDetail,
    hasActionDetailContent,
    migrateLegacyActionText,
    normalizeActionDetail,
    outcomesForDisplay,
    removeOutcome,
    setActionDetailField,
    updateOutcome,
} from "../src/action-detail";

const NOW = new Date("2026-09-21T10:00:00").getTime();
const TODAY = "2026-09-21";

describe("结构化细则归一化", () => {
    it("缺失或非法值得到空细则", () => {
        expect(normalizeActionDetail(null)).toEqual(createEmptyActionDetail());
        expect(normalizeActionDetail({ currentState: 123, outcomes: "x" })).toEqual(createEmptyActionDetail());
    });

    it("成果条目要求有内容，id 缺失时补齐，重复 id 被丢弃", () => {
        const detail = normalizeActionDetail({
            outcomes: [
                { text: "  第一条  ", createdAt: NOW },
                { text: "   " },
                { id: "fixed", text: "第二条", createdAt: NOW },
                { id: "fixed", text: "重复", createdAt: NOW },
            ],
        });
        expect(detail.outcomes.map((outcome) => outcome.text)).toEqual(["第一条", "第二条"]);
        expect(detail.outcomes[0].id).toMatch(/^outcome-/);
        expect(detail.outcomes[1].id).toBe("fixed");
    });

    it("成果日期取创建当天，显式日期优先", () => {
        const detail = normalizeActionDetail({
            outcomes: [
                { text: "a", createdAt: new Date("2026-09-20T23:00:00").getTime() },
                { text: "b", createdAt: NOW, date: "2026-01-02" },
            ],
        });
        expect(detail.outcomes[0].date).toBe("2026-09-20");
        expect(detail.outcomes[1].date).toBe("2026-01-02");
    });
});

describe("细则字段编辑", () => {
    it("设置字段会刷新 updatedAt，空细则不算有内容", () => {
        const detail = setActionDetailField(createEmptyActionDetail(), "currentState", "上次做到 X", NOW);
        expect(detail.currentState).toBe("上次做到 X");
        expect(detail.updatedAt).toBe(NOW);
        expect(hasActionDetailContent(detail)).toBe(true);
        expect(hasActionDetailContent(createEmptyActionDetail())).toBe(false);
        expect(hasActionDetailContent({ ...createEmptyActionDetail(), outcomes: [{ id: "o", text: "x", createdAt: NOW, fromTodoId: null, date: TODAY }] })).toBe(true);
    });

    it("成果可增改删", () => {
        const added = addOutcome(createEmptyActionDetail(), "  定下字段清单  ", { fromTodoId: "todo-1" }, NOW);
        expect(added.outcomes[0]).toMatchObject({ text: "定下字段清单", fromTodoId: "todo-1", date: TODAY });
        expect(() => addOutcome(createEmptyActionDetail(), "  ")).toThrow(/不能为空/);

        const id = added.outcomes[0].id;
        const updated = updateOutcome(added, id, "定下字段清单 v2", NOW + 1);
        expect(updated.outcomes[0].text).toBe("定下字段清单 v2");
        expect(() => updateOutcome(added, "missing", "x")).toThrow(/没有找到/);

        expect(removeOutcome(added, id).outcomes).toEqual([]);
    });

    it("展示顺序是最新在上", () => {
        const base = addOutcome(createEmptyActionDetail(), "早", {}, NOW);
        const later = addOutcome(base, "晚", {}, NOW + 1000);
        expect(outcomesForDisplay(later).map((outcome) => outcome.text)).toEqual(["晚", "早"]);
    });
});

describe("旧版细则迁移", () => {
    it("老文本进入行动指导与想法，并在当前状态留一行标记", () => {
        const migrated = migrateLegacyActionText(createEmptyActionDetail(), "  旧的一整块细则  ", NOW);
        expect(migrated.guidance).toBe("旧的一整块细则");
        expect(migrated.currentState).toContain("旧版细则已迁移");
        expect(migrated.migratedFromCurrentActionAt).toBe(NOW);
    });

    it("幂等：已有结构化内容时不覆盖，空文本不动", () => {
        const filled = setActionDetailField(createEmptyActionDetail(), "guidance", "我自己写的", NOW);
        const afterMigration = migrateLegacyActionText(filled, "旧文本", NOW + 1);
        expect(afterMigration.guidance).toBe("我自己写的");
        expect(afterMigration.migratedFromCurrentActionAt).toBeNull();
        const untouched = migrateLegacyActionText(createEmptyActionDetail(), "   ", NOW);
        expect(untouched).toEqual(createEmptyActionDetail());
    });
});

describe("兼容文本与缺细则判据", () => {
    it("压出的兼容文本保留各段内容与图片语法", () => {
        let detail = setActionDetailField(createEmptyActionDetail(), "currentState", "上次做到 X", NOW);
        detail = setActionDetailField(detail, "guidance", "先做领域层", NOW);
        detail = setActionDetailField(detail, "background", "背景 ![图](assets/a.png)", NOW);
        detail = addOutcome(detail, "定下字段清单", {}, NOW);
        const text = actionDetailToLegacyText(detail);
        expect(text).toContain("上次做到 X");
        expect(text).toContain("## 阶段性成果");
        expect(text).toContain("- 定下字段清单");
        expect(text).toContain("先做领域层");
        expect(text).toContain("assets/a.png");
    });

    it("空细则压出空串", () => {
        expect(actionDetailToLegacyText(createEmptyActionDetail())).toBe("");
    });

    it("缺细则判据同时看结构化内容与下一步行动", () => {
        const empty = createEmptyActionDetail();
        expect(actionDetailMissing(empty, "")).toBe(true);
        expect(actionDetailMissing(empty, "写测试")).toBe(false);
        expect(actionDetailMissing(setActionDetailField(empty, "currentState", "X", NOW), "")).toBe(false);
    });
});
