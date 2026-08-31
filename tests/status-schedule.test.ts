import { describe, expect, it } from "vitest";
import { automaticStatusForPlanDate } from "../src/status-schedule";

describe("计划开始日状态规则", () => {
    const today = "2026-08-31";

    it("未来安排保持待开始，到达开始日后进入进行中", () => {
        expect(automaticStatusForPlanDate("收件箱", "2026-09-01", today)).toBe("待开始");
        expect(automaticStatusForPlanDate("待开始", today, today)).toBe("进行中");
        expect(automaticStatusForPlanDate("待开始", "2026-08-30", today)).toBe("进行中");
    });

    it("兼容旧已计划值，但不覆盖阻塞、暂停和结束状态", () => {
        expect(automaticStatusForPlanDate("已计划", "2026-09-01", today)).toBe("待开始");
        expect(automaticStatusForPlanDate("已计划", today, today)).toBe("进行中");
        expect(automaticStatusForPlanDate("已计划", "", today)).toBe("待开始");
        expect(automaticStatusForPlanDate("阻塞", today, today)).toBeNull();
        expect(automaticStatusForPlanDate("暂停", today, today)).toBeNull();
        expect(automaticStatusForPlanDate("已完成", today, today)).toBeNull();
    });
});
