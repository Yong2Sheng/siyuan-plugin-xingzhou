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

    it("手表评分和晨起体重先确认是否可记录，选择否后不再要求数值", () => {
        const record = createDailyRecord("2026-09-04", "research-workday", 1000);
        let missing = calculateDailyCompletion(record).missing.map((item) => item.label);
        expect(missing).toEqual(expect.arrayContaining(["是否有手表睡眠评分", "是否测量晨起体重"]));

        record.fields.hasWatchSleepScore = "yes";
        record.fields.hasMorningWeight = "yes";
        missing = calculateDailyCompletion(record).missing.map((item) => item.label);
        expect(missing).toEqual(expect.arrayContaining(["手表睡眠评分", "晨起体重"]));

        record.fields.hasWatchSleepScore = "no";
        record.fields.hasMorningWeight = "no";
        missing = calculateDailyCompletion(record).missing.map((item) => item.label);
        expect(missing).not.toEqual(expect.arrayContaining(["是否有手表睡眠评分", "手表睡眠评分", "是否测量晨起体重", "晨起体重"]));
    });

    it("自动同步的执行切片不单独触发阶段待补状态", () => {
        const workday = createDailyRecord("2026-09-07", "research-workday", 1000);
        workday.fields.personalProjectLinks = [{
            workItemId: "action-1",
            titleSnapshot: "整理发布说明",
            pathSnapshot: "完善行舟",
            typeSnapshot: "事务",
        }];
        expect(calculateDailyCompletion(workday).stages.find((stage) => stage.stage === "after-work")?.state).toBe("not-started");

        const holiday = createDailyRecord("2026-09-07", "holiday", 1000);
        holiday.fields.personalProjectLinks = workday.fields.personalProjectLinks.map((link) => ({ ...link }));
        expect(calculateDailyCompletion(holiday).stages.find((stage) => stage.stage === "recovery")?.state).toBe("not-started");

        workday.fields.personalProjectPlan = "晚上整理发布说明";
        expect(calculateDailyCompletion(workday).stages.find((stage) => stage.stage === "after-work")?.state).toBe("incomplete");
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

    it("开会日不要求预计结束时间，会后不安排个人事务时不检查个人结果", () => {
        const record = createDailyRecord("2026-09-07", "conference-day", 1000);
        record.fields.workStartTime = "09:00";
        record.fields.importantWorkPlan = "参加合作会议";
        record.fields.personalAffairsPlanned = "no";
        const result = calculateDailyCompletion(record);
        const missing = result.missing.map((item) => item.label);

        expect(missing).not.toContain("计划下班时间");
        expect(missing).not.toContain("个人生活或兴趣项目结果");
        expect(missing).not.toContain("会后是否安排个人事务");
        expect(result.stages.find((item) => item.stage === "boundary")?.label).toBe("会议结束");
        expect(result.stages.find((item) => item.stage === "after-work")?.label).toBe("会后");

        record.fields.personalAffairsPlanned = "yes";
        expect(calculateDailyCompletion(record).missing.map((item) => item.label)).toContain("会后个人事务");
    });
});
