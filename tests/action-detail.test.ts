import { describe, expect, it } from "vitest";
import {
    actionDetailMissing,
    actionDetailToLegacyText,
    addCheckpoint,
    addOutcome,
    checkpointsForDisplay,
    createEmptyActionDetail,
    derivedNextAction,
    hasActionDetailContent,
    latestCheckpoint,
    migrateLegacyActionText,
    normalizeActionDetail,
    normalizeCheckpoints,
    outcomesForDisplay,
    removeCheckpoint,
    removeOutcome,
    setActionDetailField,
    toggleCheckpointStar,
    updateCheckpoint,
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

const DAY = 86400000;

describe("断点时间轴", () => {
    it("归一化：空条目丢弃、重复 id 丢弃、入口必须有名称", () => {
        const list = normalizeCheckpoints([
            { id: "cp-1", createdAt: NOW, did: "做到 A" },
            { id: "cp-1", createdAt: NOW, did: "重复 id" },
            { did: "   " },
            { did: "带入口", entry: { type: "vscode", label: "a.ts", target: "~/a.ts" } },
            { did: "入口没名称", entry: { type: "vscode", target: "~/b.ts" } },
        ]);
        /* 5 条里丢两条：重复 id、纯空白 */
        expect(list).toHaveLength(3);
        expect(list[0].did).toBe("做到 A");
        expect(list[1].did).toBe("带入口");
        expect(list[1].entry).toEqual({ type: "vscode", label: "a.ts", target: "~/a.ts" });
        /* 没名称的入口视为没有入口，但断点本身保留 */
        expect(list[2].did).toBe("入口没名称");
        expect(list[2].entry).toBeNull();
    });

    it("旧字段迁移：成果变成带星标的断点，当前状态变成普通断点；重复读取不再多出条目", () => {
        const legacy = normalizeActionDetail({
            currentState: "上次停在切片日历",
            updatedAt: NOW - DAY,
            outcomes: [
                { id: "outcome-1", text: "跑通了切片日历", createdAt: NOW - 2 * DAY },
                { id: "outcome-2", text: "写完文档", createdAt: NOW - 3 * DAY },
            ],
        });
        expect(legacy.checkpoints).toHaveLength(3);
        expect(legacy.checkpoints.filter((item) => item.starred)).toHaveLength(2);
        expect(legacy.checkpoints.some((item) => item.did === "上次停在切片日历")).toBe(true);
        expect(legacy.checkpointMigrationAt).not.toBeNull();

        /* 再读一次：靠 checkpointMigrationAt 幂等，不会翻倍 */
        const again = normalizeActionDetail(legacy);
        expect(again.checkpoints).toHaveLength(3);
    });

    it("把断点删光之后，旧字段不会被「复活」成断点", () => {
        const migrated = normalizeActionDetail({ currentState: "旧状态文字", outcomes: [] });
        expect(migrated.checkpoints).toHaveLength(1);
        const emptied = removeCheckpoint(migrated, migrated.checkpoints[0].id);
        expect(emptied.checkpoints).toHaveLength(0);
        /* 旧字段还在，但迁移标记也在：不得再迁一次 */
        expect(normalizeActionDetail(emptied).checkpoints).toHaveLength(0);
    });

    it("追加 / 修改 / 星标 / 删除都作用在指定条目上", () => {
        let detail = createEmptyActionDetail();
        detail = addCheckpoint(detail, { did: "第一条", next: "接着做" }, NOW);
        detail = addCheckpoint(detail, { did: "第二条" }, NOW + 1);
        expect(checkpointsForDisplay(detail).map((item) => item.did)).toEqual(["第二条", "第一条"]);

        const first = detail.checkpoints[0].id;
        detail = updateCheckpoint(detail, first, { did: "第一条（改）", stuck: "卡在环境" }, NOW + 2);
        expect(detail.checkpoints[0].did).toBe("第一条（改）");
        expect(detail.checkpoints[0].stuck).toBe("卡在环境");

        detail = toggleCheckpointStar(detail, first, NOW + 3);
        expect(detail.checkpoints[0].starred).toBe(true);

        detail = removeCheckpoint(detail, first, NOW + 4);
        expect(detail.checkpoints).toHaveLength(1);
    });

    it("空断点不允许写入（否则时间轴上会多一行空白）", () => {
        expect(() => addCheckpoint(createEmptyActionDetail(), { did: "   " })).toThrow(/不能为空/);
    });

    it("当前状态与下一步都由最新一条断点派生", () => {
        let detail = createEmptyActionDetail();
        detail = addCheckpoint(detail, { did: "做到 A", next: "做 B" }, NOW);
        detail = addCheckpoint(detail, { did: "做到 B", next: "" }, NOW + 1);
        expect(latestCheckpoint(detail)?.did).toBe("做到 B");
        /* 最新一条没写下一步 = 待定，不回落到上一条 */
        expect(derivedNextAction(detail)).toBe("");
    });

    it("兼容文本按时间倒序写入每条断点，旧 currentState 不再重复出现", () => {
        let detail = createEmptyActionDetail();
        detail = addCheckpoint(detail, { did: "做到 A", next: "做 B", payload: "带走这段" }, NOW);
        detail = addCheckpoint(detail, { did: "做到 B", entry: { type: "jupyter", label: "a.ipynb", target: "~/a.ipynb" } }, NOW + 1);
        const text = actionDetailToLegacyText(detail, derivedNextAction(detail));
        expect(text.indexOf("做到 B")).toBeLessThan(text.indexOf("做到 A"));
        expect(text).toContain("带走这段");
        expect(text).toContain("入口：a.ipynb（~/a.ipynb）");
    });

    /**
     * 按用户真实路径跑完整条链：断断续续做三天，每天停手记一条。
     * 每轮的可见结果（最新一条是谁、历史几条、下一步是什么）都必须按预期变化。
     */
    it("端到端：跨三天记三条断点，当前状态与下一步每轮都跟着走", () => {
        let detail = createEmptyActionDetail();
        const rounds = [
            { did: "第一天：搭好骨架", next: "写解析", payload: "先看 internal-store" },
            { did: "第二天：解析写完了", next: "接界面", payload: "" },
            { did: "第三天：界面接了一半", next: "", payload: "" },
        ];

        rounds.forEach((round, index) => {
            detail = addCheckpoint(detail, { did: round.did, next: round.next, payload: round.payload }, NOW + index * DAY);

            const latest = latestCheckpoint(detail)!;
            expect(latest.did).toBe(round.did);
            expect(latest.next).toBe(round.next);
            /* 历史 = 总数 - 1，且按时间倒序 */
            const history = checkpointsForDisplay(detail).slice(1);
            expect(history).toHaveLength(index);
            expect(derivedNextAction(detail)).toBe(round.next);
            expect(actionDetailMissing(detail, derivedNextAction(detail))).toBe(false);
        });

        /* 最后一条没写下一步 → 派生为空（显示为待定），不会退回到上一条 */
        expect(derivedNextAction(detail)).toBe("");
        expect(checkpointsForDisplay(detail)).toHaveLength(3);
    });
});
