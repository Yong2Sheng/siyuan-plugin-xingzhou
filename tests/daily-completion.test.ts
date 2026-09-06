import { describe, expect, it } from "vitest";
import { calculateDailyCompletion } from "../src/daily-completion";
import { createDailyRecord } from "../src/daily-records";

describe("生活节律完整度检查", () => {
    it("空白工作日标出各阶段待补项，普通备注不参与检查", () => {
        const record = createDailyRecord("2026-09-04", "research-workday", 1000);
        const empty = calculateDailyCompletion(record);

        expect(empty.completedCount).toBe(0);
        expect(empty.applicableCount).toBe(5);
        expect(empty.stages.map((stage) => stage.state)).toEqual([
            "not-started", "not-started", "not-started", "not-started", "not-started",
        ]);
        expect(empty.missing.map((item) => item.label)).toContain("是否安排专业学习");
        expect(empty.missing.map((item) => item.label)).not.toContain("今晚个人事务补充说明（可选）");
    });

    it("根据条件判断动态加入或移除待补字段", () => {
        const record = createDailyRecord("2026-09-04", "research-workday", 1000);
        record.fields.professionalStudyPlanned = "yes";
        record.fields.studyMaterial = "统计学习方法";
        let result = calculateDailyCompletion(record);
        expect(result.stages.find((stage) => stage.stage === "learning")).toMatchObject({ state: "incomplete" });
        expect(result.missing.map((item) => item.label)).toEqual(expect.arrayContaining(["章节／主题", "学习安排", "完成时长与停点"]));

        record.fields.professionalStudyPlanned = "no";
        result = calculateDailyCompletion(record);
        expect(result.stages.find((stage) => stage.stage === "learning")).toMatchObject({ state: "complete", missing: [] });

        record.fields.bedtimePreparation = "free";
        expect(calculateDailyCompletion(record).missing.map((item) => item.label)).not.toContain("计划熄灯时间");
        record.fields.bedtimePreparation = "yes";
        expect(calculateDailyCompletion(record).missing.map((item) => item.label)).toEqual(expect.arrayContaining(["计划熄灯日期", "计划熄灯时间"]));
    });

    it("周六不复盘时，中午下班和自由时间无需检查", () => {
        const record = createDailyRecord("2026-09-05", "saturday-reset", 1000);
        record.fields.saturdayReviewOccurred = "no";
        const result = calculateDailyCompletion(record);

        expect(result.stages.find((stage) => stage.stage === "learning")?.state).toBe("complete");
        expect(result.stages.find((stage) => stage.stage === "boundary")?.state).toBe("not-applicable");
        expect(result.stages.find((stage) => stage.stage === "after-work")?.state).toBe("not-applicable");
        expect(result.applicableCount).toBe(3);
    });

    it("休假日只检查恢复、生活和晚间关键记录", () => {
        const record = createDailyRecord("2026-09-07", "holiday", 1000);
        const result = calculateDailyCompletion(record);

        expect(result.stages.map((stage) => stage.stage)).toEqual(["morning", "recovery", "evening"]);
        expect(result.missing.map((item) => item.label)).not.toEqual(expect.arrayContaining(["上班时间", "关键工作结果", "是否需要工作闭环"]));
        expect(result.missing.map((item) => item.label)).toEqual(expect.arrayContaining(["休息／个人生活重点", "个人生活或兴趣项目结果"]));
    });
});
