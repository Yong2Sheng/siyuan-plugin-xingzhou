import { describe, expect, it } from "vitest";
import {
    IMAGE_CLEANUP_GRACE_DAYS,
    buildImageCleanupPlan,
    buildStorageStats,
    cleanupBadgeLabel,
    cleanupCountdownLabel,
    cleanupForStatusChange,
    cleanupImagesOf,
    cleanupParentChain,
    cleanupRemainingDays,
    descendantsOf,
    isCleanupDue,
    keptPathsOf,
    listPendingImageCleanup,
    planCleanupForClosedItem,
    removablePathsOf,
} from "../src/action-image-cleanup";
import type { WorkItem } from "../src/work-items";

const DAY = 24 * 60 * 60 * 1000;

function item(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: "item", rowId: "item", title: "条目", documentId: null, detached: true,
        type: "事务", status: "进行中", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        planDate: null, deadline: null, noDeadline: false, durationMinutes: null, energy: "", updatedAt: 0,
        ...overrides,
    };
}

function withImage(src: string, text = "看这张"): string {
    return `${text}\n![](${src})`;
}

describe("planCleanupForClosedItem", () => {
    it("没有图片时不登记", () => {
        expect(planCleanupForClosedItem(item({ status: "已完成" }), [])).toBeNull();
    });

    it("登记自己与所有下级引用的图片，按出现顺序去重", () => {
        const parent = item({ id: "p", title: "项目", type: "项目", status: "已完成", currentAction: withImage("assets/xz-a.png") });
        const child = item({ id: "c", title: "事务", parentIds: ["p"], currentAction: withImage("assets/xz-b.png") });
        const grandchild = item({ id: "g", title: "子事务", parentIds: ["c"], currentAction: withImage("assets/xz-a.png") });

        const plan = planCleanupForClosedItem(parent, [parent, child, grandchild], 1000);
        expect(plan?.startedAt).toBe(1000);
        expect(plan?.paths).toEqual(["assets/xz-a.png", "assets/xz-b.png"]);
    });

    it("已经登记过的条目不会重复登记", () => {
        const done = item({ id: "p", status: "已完成", currentAction: withImage("assets/xz-a.png"), imageCleanup: { startedAt: 5, paths: ["assets/xz-a.png"] } });
        expect(planCleanupForClosedItem(done, [done])).toBeNull();
    });

    it("下级形成环路时不会死循环", () => {
        const a = item({ id: "a", parentIds: ["b"] });
        const b = item({ id: "b", parentIds: ["a"] });
        expect(descendantsOf("a", [a, b]).map((entry) => entry.id)).toEqual(["b"]);
    });
});

describe("cleanupForStatusChange", () => {
    it("结束状态会生成登记，非结束状态返回 null", () => {
        const running = item({ id: "x", currentAction: withImage("assets/xz-a.png") });
        expect(cleanupForStatusChange(running, "进行中", [running])).toBeNull();
        expect(cleanupForStatusChange(running, "已完成", [running])?.paths).toEqual(["assets/xz-a.png"]);
        expect(cleanupForStatusChange(running, "已放弃", [running])?.paths).toEqual(["assets/xz-a.png"]);
    });

    it("没有图片时不登记，避免写入空字段", () => {
        const running = item({ id: "x" });
        expect(cleanupForStatusChange(running, "已完成", [running])).toBeNull();
    });
});

describe("countdown 与角标", () => {
    const cleanup = { startedAt: 0, paths: ["assets/xz-a.png"] };

    it("按 7 天宽限期计算剩余天数与到期", () => {
        expect(cleanupRemainingDays(cleanup, 0)).toBe(IMAGE_CLEANUP_GRACE_DAYS);
        expect(cleanupRemainingDays(cleanup, DAY)).toBe(IMAGE_CLEANUP_GRACE_DAYS - 1);
        expect(isCleanupDue(cleanup, IMAGE_CLEANUP_GRACE_DAYS * DAY - 1)).toBe(false);
        expect(isCleanupDue(cleanup, IMAGE_CLEANUP_GRACE_DAYS * DAY)).toBe(true);
        expect(cleanupRemainingDays(cleanup, IMAGE_CLEANUP_GRACE_DAYS * DAY + DAY)).toBe(0);
    });

    it("倒计时文案区分未到期与已到期", () => {
        expect(cleanupCountdownLabel(cleanup, DAY)).toBe("还剩 6 天");
        expect(cleanupCountdownLabel(cleanup, IMAGE_CLEANUP_GRACE_DAYS * DAY)).toBe("今天到期，可确认清理");
    });

    it("角标只在登记范围内仍有图片时显示", () => {
        const flagged = item({ currentAction: withImage("assets/xz-a.png"), imageCleanup: cleanup });
        expect(cleanupBadgeLabel(flagged, DAY)).toBe("图片待清理 · 还剩 6 天");

        const stripped = item({ currentAction: "只剩文字", imageCleanup: cleanup });
        expect(cleanupBadgeLabel(stripped, DAY)).toBeNull();

        const extraOnly = item({ currentAction: withImage("assets/xz-new.png"), imageCleanup: cleanup });
        expect(cleanupBadgeLabel(extraOnly, DAY)).toBeNull();
    });
});

describe("buildImageCleanupPlan", () => {
    it("摘掉引用并区分可删除与保留的图片", () => {
        const closed = item({
            id: "closed", title: "已结束", status: "已完成",
            currentAction: withImage("assets/xz-a.png"),
            nextAction: withImage("assets/xz-b.png", "下一步"),
            imageCleanup: { startedAt: 0, paths: ["assets/xz-a.png", "assets/xz-b.png"] },
        });
        const active = item({ id: "active", title: "进行中", currentAction: withImage("assets/xz-b.png") });

        const plan = buildImageCleanupPlan([closed], [closed, active]);
        expect(plan).toHaveLength(1);
        expect(removablePathsOf(plan)).toEqual(["assets/xz-a.png"]);
        expect(keptPathsOf(plan)).toEqual(["assets/xz-b.png"]);
        expect(plan[0].changes.currentAction).toBe("看这张");
        // xz-b 仍被进行中的条目引用：文字保留、引用摘除后仍带图片
        expect(plan[0].changes.nextAction).toBe("下一步\n![](assets/xz-b.png)");
        expect(plan[0].hasImagesAfter).toBe(true);
    });

    it("已结束的其它条目不算引用方", () => {
        const a = item({ id: "a", status: "已完成", currentAction: withImage("assets/xz-a.png"), imageCleanup: { startedAt: 0, paths: ["assets/xz-a.png"] } });
        const b = item({ id: "b", status: "已取消", currentAction: withImage("assets/xz-a.png") });
        const plan = buildImageCleanupPlan([a], [a, b]);
        expect(removablePathsOf(plan)).toEqual(["assets/xz-a.png"]);
        expect(keptPathsOf(plan)).toEqual([]);
    });

    it("登记之后新贴的图片不会被牵连", () => {
        const entry = item({
            id: "a", status: "已完成",
            currentAction: `${withImage("assets/xz-old.png")}\n![](${"assets/xz-new.png"})`,
            imageCleanup: { startedAt: 0, paths: ["assets/xz-old.png"] },
        });
        const plan = buildImageCleanupPlan([entry], [entry]);
        expect(removablePathsOf(plan)).toEqual(["assets/xz-old.png"]);
        expect(plan[0].changes.currentAction).toContain("assets/xz-new.png");
    });

    it("includeDescendants=false 时不触碰下级", () => {
        const parent = item({ id: "p", status: "已完成", currentAction: withImage("assets/xz-p.png"), imageCleanup: { startedAt: 0, paths: ["assets/xz-p.png"] } });
        const child = item({ id: "c", parentIds: ["p"], status: "已完成", currentAction: withImage("assets/xz-c.png"), imageCleanup: { startedAt: 0, paths: ["assets/xz-c.png"] } });
        const plan = buildImageCleanupPlan([parent], [parent, child], { includeDescendants: false });
        expect(plan.map((entry) => entry.itemId)).toEqual(["p"]);
        expect(removablePathsOf(plan)).toEqual(["assets/xz-p.png"]);
    });

    it("包含下级时一并清理，图片去重", () => {
        const parent = item({ id: "p", status: "已完成", currentAction: withImage("assets/xz-shared.png"), imageCleanup: { startedAt: 0, paths: ["assets/xz-shared.png"] } });
        const child = item({ id: "c", parentIds: ["p"], status: "已完成", currentAction: withImage("assets/xz-shared.png"), imageCleanup: { startedAt: 0, paths: ["assets/xz-shared.png"] } });
        const plan = buildImageCleanupPlan([parent], [parent, child]);
        expect(plan.map((entry) => entry.itemId).sort()).toEqual(["c", "p"]);
        expect(removablePathsOf(plan)).toEqual(["assets/xz-shared.png"]);
    });

    it("没有登记的条目不会进入计划", () => {
        const plain = item({ id: "a", status: "已完成", currentAction: withImage("assets/xz-a.png") });
        expect(buildImageCleanupPlan([plain], [plain])).toEqual([]);
    });
});

describe("listPendingImageCleanup", () => {
    it("排除已恢复为进行中的条目与已无图可清的条目", () => {
        const dueSoon = item({ id: "a", status: "已完成", currentAction: withImage("assets/xz-a.png"), imageCleanup: { startedAt: 0, paths: ["assets/xz-a.png"] } });
        const restored = item({ id: "b", status: "进行中", currentAction: withImage("assets/xz-b.png"), imageCleanup: { startedAt: 0, paths: ["assets/xz-b.png"] } });
        const alreadyStripped = item({ id: "c", status: "已完成", currentAction: "只剩文字", imageCleanup: { startedAt: 0, paths: ["assets/xz-c.png"] } });

        const entries = listPendingImageCleanup([dueSoon, restored, alreadyStripped], DAY);
        expect(entries.map((entry) => entry.item.id)).toEqual(["a"]);
        expect(entries[0].images.map((image) => image.src)).toEqual(["assets/xz-a.png"]);
        expect(entries[0].due).toBe(false);
        expect(entries[0].remainingDays).toBe(6);
    });

    it("已到期的排在前面", () => {
        const fresh = item({ id: "fresh", status: "已完成", currentAction: withImage("assets/xz-a.png"), imageCleanup: { startedAt: DAY * 6, paths: ["assets/xz-a.png"] } });
        const due = item({ id: "due", status: "已完成", currentAction: withImage("assets/xz-b.png"), imageCleanup: { startedAt: 0, paths: ["assets/xz-b.png"] } });
        const entries = listPendingImageCleanup([fresh, due], DAY * 7);
        expect(entries.map((entry) => entry.item.id)).toEqual(["due", "fresh"]);
        expect(entries[0].due).toBe(true);
    });
});

describe("cleanupImagesOf 与 parent chain", () => {
    it("只返回登记范围内的图片", () => {
        const entry = item({
            id: "a", status: "已完成",
            currentAction: withImage("assets/xz-in.png"),
            nextAction: withImage("assets/xz-out.png"),
            imageCleanup: { startedAt: 0, paths: ["assets/xz-in.png"] },
        });
        expect(cleanupImagesOf(entry).map((image) => image.src)).toEqual(["assets/xz-in.png"]);
    });

    it("上级标题链用于说明清理来源", () => {
        const area = item({ id: "area", title: "长期领域" });
        const project = item({ id: "project", title: "顶层项目", parentIds: ["area"] });
        const task = item({ id: "task", title: "事务", parentIds: ["project"] });
        expect(cleanupParentChain(task, [area, project, task])).toEqual(["长期领域", "顶层项目"]);
    });
});

describe("buildStorageStats 图库体检", () => {
    it("分别统计未结束与待清理占用，同一张图只算一份", () => {
        const active = item({ id: "a", currentAction: withImage("assets/xz-shared.png") });
        const active2 = item({ id: "a2", currentAction: withImage("assets/xz-shared.png") });
        const done = item({ id: "d", status: "已完成", currentAction: withImage("assets/xz-done.png"), imageCleanup: { startedAt: 0, paths: ["assets/xz-done.png"] } });

        const stats = buildStorageStats([active, active2, done], { "assets/xz-shared.png": 1000, "assets/xz-done.png": 2000 });
        expect(stats.itemCount).toBe(2);
        expect(stats.imageCount).toBe(2);
        expect(stats.bytes).toBe(3000);
        expect(stats.pendingItemCount).toBe(1);
        expect(stats.pendingImageCount).toBe(1);
        expect(stats.missingSize).toBe(0);
        expect(stats.topItems.map((row) => row.item.id).sort()).toEqual(["a", "a2"]);
    });

    it("体积未知时计入 missingSize 而不是当作 0", () => {
        const active = item({ id: "a", currentAction: withImage("assets/xz-a.png") });
        const stats = buildStorageStats([active], {});
        expect(stats.bytes).toBe(0);
        expect(stats.missingSize).toBe(1);
        expect(stats.topItems[0].bytes).toBe(0);
    });

    it("按占用从大到小排序，无图条目不进入排行", () => {
        const big = item({ id: "big", currentAction: withImage("assets/xz-big.png") });
        const small = item({ id: "small", currentAction: withImage("assets/xz-small.png") });
        const none = item({ id: "none", currentAction: "只有文字" });
        const stats = buildStorageStats([small, none, big], { "assets/xz-big.png": 5000, "assets/xz-small.png": 100 });
        expect(stats.topItems.map((row) => row.item.id)).toEqual(["big", "small"]);
        expect(stats.itemCount).toBe(3);
    });

    it("没有行舟图片时给出空排行", () => {
        const stats = buildStorageStats([item({ id: "a" })], {});
        expect(stats.imageCount).toBe(0);
        expect(stats.topItems).toEqual([]);
        expect(stats.bytes).toBe(0);
    });
});
