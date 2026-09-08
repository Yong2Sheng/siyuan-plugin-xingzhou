import type { DailyRecord, DailyRecordFields } from "./daily-records";

export type DailyCompletionStage = "morning" | "learning" | "boundary" | "after-work" | "recovery" | "evening";
export type DailyCompletionState = "not-started" | "incomplete" | "complete" | "not-applicable";

export type DailyMissingItem = {
    id: string;
    stage: DailyCompletionStage;
    label: string;
    focusLabel: string;
};

export type DailyStageCompletion = {
    stage: DailyCompletionStage;
    label: string;
    state: DailyCompletionState;
    missing: DailyMissingItem[];
};

export type DailyCompletion = {
    stages: DailyStageCompletion[];
    missing: DailyMissingItem[];
    completedCount: number;
    applicableCount: number;
};

type Check = Omit<DailyMissingItem, "stage"> & { filled: boolean };

export function calculateDailyCompletion(record: DailyRecord): DailyCompletion {
    const fields = record.fields;
    const saturday = record.dayType === "saturday-reset";
    const holiday = record.dayType === "holiday";
    const stages: DailyStageCompletion[] = [];

    stages.push(stageResult("morning", "早晨", morningChecks(record), morningTouched(fields, holiday, saturday)));

    if (holiday) {
        stages.push(stageResult("recovery", "恢复", recoveryChecks(fields), touched(fields, [
            "daytimeEnergy", "personalLifeResult", "personalProjectPlan", "personalProjectDurationMinutes",
        ])));
    } else {
        stages.push(stageResult("learning", saturday ? "上午复盘" : "午饭后", learningChecks(fields, saturday), touched(fields, saturday
            ? ["saturdayReviewOccurred", "workStartTime", "plannedWorkEndTime", "importantWorkPlan"]
            : ["professionalStudyPlanned", "studyMaterial", "studyTopic", "studyPlan", "studyResult"])));

        if (saturday && fields.saturdayReviewOccurred === "no") {
            stages.push(notApplicable("boundary", "中午下班"));
        } else if (saturday && fields.saturdayReviewOccurred === "") {
            stages.push(stageResult("boundary", "中午下班", [], false));
        } else {
            stages.push(stageResult("boundary", saturday ? "中午下班" : "下班", boundaryChecks(fields), touched(fields, [
                "actualWorkEndTime", "keyWorkResult", "importantWorkResult", "daytimeEnergy", "workEfficiency", "promotingStress", "depletingStress",
            ])));
        }

        if (saturday) {
            stages.push(notApplicable("after-work", "自由时间"));
        } else {
            stages.push(stageResult("after-work", "下班后", afterWorkChecks(fields), touched(fields, [
                "closureNeed", "closureObject", "closurePlannedMinutes", "closureHasNextStep", "closureNextStep", "closureActualMinutes",
                "personalProjectPlan", "personalProjectDurationMinutes",
            ])));
        }
    }

    stages.push(stageResult("evening", "21:00", eveningChecks(record), eveningTouched(fields, holiday, saturday)));

    const applicable = stages.filter((entry) => entry.state !== "not-applicable");
    return {
        stages,
        missing: stages.flatMap((entry) => entry.missing),
        completedCount: applicable.filter((entry) => entry.state === "complete").length,
        applicableCount: applicable.length,
    };
}

function morningChecks(record: DailyRecord): Check[] {
    const fields = record.fields;
    const checks = [
        check("lights-off", "昨晚熄灯", "昨晚熄灯", text(fields.lightsOffTime)),
        check("wake-time", "今日起床", "今日起床", text(fields.wakeTime)),
        check("sleep-duration", "睡眠时长", "睡眠时长", number(fields.sleepDurationMinutes)),
        check("watch-sleep-score-decision", "是否有手表睡眠评分", "今天是否有手表睡眠评分", text(fields.hasWatchSleepScore)),
    ];
    if (fields.hasWatchSleepScore === "yes") checks.push(check("watch-sleep-score", "手表睡眠评分", "手表睡眠评分", number(fields.watchSleepScore)));
    checks.push(
        check("subjective-sleep", "主观睡眠质量", "主观睡眠质量", number(fields.subjectiveSleepQuality)),
        check("morning-weight-decision", "是否测量晨起体重", "今天是否测量晨起体重", text(fields.hasMorningWeight)),
    );
    if (fields.hasMorningWeight === "yes") checks.push(check("morning-weight", "晨起体重", "晨起体重", number(fields.morningWeight)));
    checks.push(
        check("day-adjustment-decision", "是否有节奏或临时调整", "今日是否有节奏或临时调整", text(fields.hasDayAdjustments)),
        check("training-decision", "训练完成状态", "完成训练", text(fields.trainingCompleted)),
    );
    if (record.dayType === "holiday") {
        checks.push(check("rest-plan", "休息／个人生活重点", "今天如何休息／个人生活重点", text(fields.restAndLifePlan)));
    } else if (record.dayType !== "saturday-reset") {
        checks.push(
            check("work-start", "上班时间", "上班时间", text(fields.workStartTime)),
            check("planned-work-end", "计划下班时间", "计划下班时间", text(fields.plannedWorkEndTime)),
            check("important-work-plan", "最重要的工作内容", "今天最重要的工作内容", text(fields.importantWorkPlan)),
        );
    }
    if (fields.hasDayAdjustments === "yes") checks.push(check("day-adjustment", "调整内容", "调整内容", text(fields.dayAdjustments)));
    if (fields.trainingCompleted === "yes") checks.push(check("training-plan", "训练内容", "今天的训练内容", text(fields.trainingPlan)));
    return checks;
}

function learningChecks(fields: DailyRecordFields, saturday: boolean): Check[] {
    if (saturday) {
        const checks = [check("saturday-review-decision", "是否进行上午轻量复盘", "今天是否进行上午轻量复盘", text(fields.saturdayReviewOccurred))];
        if (fields.saturdayReviewOccurred === "yes") checks.push(
            check("review-start", "轻量复盘开始时间", "轻量复盘开始时间", text(fields.workStartTime)),
            check("review-end", "计划结束时间", "计划结束时间（中午前）", text(fields.plannedWorkEndTime)),
            check("review-plan", "回顾／整理内容", "今天准备回顾／整理什么", text(fields.importantWorkPlan)),
        );
        return checks;
    }
    const checks = [check("study-decision", "是否安排专业学习", "午饭后是否安排专业学习", text(fields.professionalStudyPlanned))];
    if (fields.professionalStudyPlanned === "yes") checks.push(
        check("study-material", "书目／材料", "书目／材料", text(fields.studyMaterial)),
        check("study-topic", "章节／主题", "章节／主题", text(fields.studyTopic)),
        check("study-plan", "学习安排", "学习安排", text(fields.studyPlan)),
        check("study-result", "完成时长与停点", "完成时长与页码／停点", text(fields.studyResult)),
    );
    return checks;
}

function boundaryChecks(fields: DailyRecordFields): Check[] {
    return [
        check("actual-work-end", "实际下班时间", "实际下班时间", text(fields.actualWorkEndTime)),
        check("key-work-result", "关键工作结果", "关键工作结果", text(fields.keyWorkResult)),
        check("important-work-result", "最重要的工作结果", "今天最重要的工作结果", text(fields.importantWorkResult)),
        check("daytime-energy", "白天精力", "白天精力", number(fields.daytimeEnergy)),
        check("work-efficiency", "工作效率", "工作效率", number(fields.workEfficiency)),
        check("promoting-stress", "促进性压力", "促进性压力", number(fields.promotingStress)),
        check("depleting-stress", "损耗性压力", "损耗性压力", number(fields.depletingStress)),
    ];
}

function afterWorkChecks(fields: DailyRecordFields): Check[] {
    const checks = [check("closure-decision", "是否需要工作闭环", "本次是否需要工作闭环", text(fields.closureNeed))];
    if (fields.closureNeed === "needed") {
        checks.push(
            check("closure-object", "闭环对象／材料", "对象／材料", text(fields.closureObject)),
            check("closure-planned", "闭环预计时间", "预计时间", number(fields.closurePlannedMinutes)),
            check("closure-next-decision", "是否有下一步安排", "是否有下一步安排", text(fields.closureHasNextStep)),
            check("closure-actual", "实际闭环时长", "实际闭环时长", number(fields.closureActualMinutes)),
        );
        if (fields.closureHasNextStep === "yes") checks.push(check("closure-next", "闭环下一步", "下一步内容", text(fields.closureNextStep)));
    }
    return checks;
}

function recoveryChecks(fields: DailyRecordFields): Check[] {
    return [
        check("recovery-energy", "白天精力", "白天精力", number(fields.daytimeEnergy)),
        check("recovery-life-result", "个人生活或兴趣项目结果", "今天的个人生活或兴趣项目结果", text(fields.personalLifeResult)),
    ];
}

function eveningChecks(record: DailyRecord): Check[] {
    const fields = record.fields;
    const workApplicable = record.dayType !== "holiday";
    const saturday = record.dayType === "saturday-reset";
    const checks = [
        check("best-thing", "今天做得最好的一件事", "今天做得最好的一件事", text(fields.bestThing)),
        check("obstacle", "今天最大的阻碍或消耗", "今天最大的阻碍或消耗", text(fields.obstacleOrCost)),
        check("anomaly-decision", "是否有其他异常或观察", "是否有其他异常或观察需要记录", text(fields.hasAnomalyOrObservation)),
        check("bedtime-decision", "今晚的睡前安排", "今晚的睡前安排", text(fields.bedtimePreparation)),
    ];
    if (workApplicable) checks.push(
        check("personal-life-result", "个人生活或兴趣项目结果", "今天的个人生活或兴趣项目结果", text(fields.personalLifeResult)),
        check("after-hours-decision", saturday ? "中午下班后是否接触工作" : "下班后是否处理工作", saturday ? "中午下班后是否接触了工作" : "下班后是否处理了工作", text(fields.afterHoursWorkOccurred)),
    );
    if (workApplicable && !saturday) checks.push(check("tomorrow-first-action", "明天工作的第一个动作", "明天开始工作时的第一个动作", text(fields.tomorrowFirstAction)));
    if (fields.afterHoursWorkOccurred === "yes") checks.push(check("after-hours-reason", "处理工作的原因", "处理工作的原因", text(fields.afterHoursWorkReason)));
    if (fields.hasAnomalyOrObservation === "yes") checks.push(check("anomaly-content", "异常或观察内容", "异常或观察内容", text(fields.anomalyOrObservation)));
    if (fields.bedtimePreparation === "yes" || fields.bedtimePreparation === "no") checks.push(
        check("planned-lights-off-day", "计划熄灯日期", "计划熄灯", text(fields.plannedLightsOffDay)),
        check("planned-lights-off-time", "计划熄灯时间", "计划熄灯", text(fields.plannedLightsOffTime)),
    );
    return checks;
}

function morningTouched(fields: DailyRecordFields, holiday: boolean, saturday: boolean): boolean {
    const keys: Array<keyof DailyRecordFields> = [
        "lightsOffTime", "wakeTime", "sleepDurationMinutes", "hasWatchSleepScore", "watchSleepScore", "subjectiveSleepQuality",
        "hasMorningWeight", "morningWeight",
        "hasDayAdjustments", "dayAdjustments", "trainingCompleted", "trainingPlan",
    ];
    if (holiday) keys.push("restAndLifePlan");
    else if (!saturday) keys.push("workStartTime", "plannedWorkEndTime", "importantWorkPlan");
    return touched(fields, keys);
}

function eveningTouched(fields: DailyRecordFields, holiday: boolean, saturday: boolean): boolean {
    const keys: Array<keyof DailyRecordFields> = [
        "bestThing", "obstacleOrCost", "hasAnomalyOrObservation", "anomalyOrObservation", "bedtimePreparation", "plannedLightsOffDay", "plannedLightsOffTime",
    ];
    if (!holiday) keys.push("personalLifeResult", "afterHoursWorkOccurred", "afterHoursWorkReason");
    if (!holiday && !saturday) keys.push("tomorrowFirstAction");
    return touched(fields, keys);
}

function stageResult(stage: DailyCompletionStage, label: string, checks: Check[], hasContent: boolean): DailyStageCompletion {
    const missing = checks.filter((entry) => !entry.filled).map(({ filled: _filled, ...entry }) => ({ ...entry, stage }));
    return { stage, label, missing, state: missing.length === 0 && checks.length > 0 ? "complete" : hasContent ? "incomplete" : "not-started" };
}

function notApplicable(stage: DailyCompletionStage, label: string): DailyStageCompletion {
    return { stage, label, state: "not-applicable", missing: [] };
}

function check(id: string, label: string, focusLabel: string, filled: boolean): Check {
    return { id, label, focusLabel, filled };
}

function text(value: unknown): boolean {
    return typeof value === "string" && value.trim().length > 0;
}

function number(value: unknown): boolean {
    return typeof value === "number" && Number.isFinite(value);
}

function touched(fields: DailyRecordFields, keys: Array<keyof DailyRecordFields>): boolean {
    return keys.some((key) => {
        const value = fields[key];
        if (Array.isArray(value)) return value.length > 0;
        return typeof value === "number" ? Number.isFinite(value) : typeof value === "string" && value.trim().length > 0;
    });
}
