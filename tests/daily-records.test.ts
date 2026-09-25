import { describe, expect, it } from "vitest";
import {
    cloneDailyRecord,
    createDailyRecord,
    createEmptyDailyStore,
    dailyBackupFileForRevision,
    defaultDayType,
    deriveLightsOffAdherence,
    isWorkMetricApplicable,
    lightsOffNightInput,
    parseDailyStore,
    plannedLightsOffReference,
    plannedLightsOffReferenceFromFields,
    previousDayFirstAction,
    resolveSleepDateTimes,
    sleepLatencyLabel,
    type DailyRecord,
    upsertDailyRecord,
} from "../src/daily-records";

describe("生活节律内部数据库", () => {
    it("根据星期给出默认类型，同时允许节假日覆盖", () => {
        expect(defaultDayType("2026-09-03")).toBe("research-workday");
        expect(defaultDayType("2026-09-05")).toBe("saturday-reset");
        expect(defaultDayType("2026-09-06")).toBe("sunday-half-day");
        expect(createDailyRecord("2026-09-03", "holiday", 1000).dayType).toBe("holiday");
        expect(createDailyRecord("2026-09-03", "conference-day", 1000).dayType).toBe("conference-day");
    });

    it("从空仓库写入并更新同一天，不产生重复记录", () => {
        const empty = createEmptyDailyStore(1000);
        const record = createDailyRecord("2026-09-03", "research-workday", 1100);
        record.fields.sleepDurationMinutes = 346;
        const first = upsertDailyRecord(empty, record, 1200);
        const changed = { ...first.records[0], fields: { ...first.records[0].fields, weightUnit: "lb" as const, morningWeight: 150 } };
        const second = upsertDailyRecord(first, changed, 1300);

        expect(second.records).toHaveLength(1);
        expect(second.records[0]).toMatchObject({ date: "2026-09-03", createdAt: 1100, updatedAt: 1300 });
        expect(second.records[0].fields).toMatchObject({ sleepDurationMinutes: 346, morningWeight: 150, weightUnit: "lb" });
        expect(second.records[0].fields.hasMorningWeight).toBe("yes");
        expect(second.revision).toBe(3);
    });

    it("区分没有测量条件与尚未填写，并兼容已有评分和体重", () => {
        const legacy = createDailyRecord("2026-09-03", "research-workday", 1000);
        legacy.fields.watchSleepScore = 82;
        legacy.fields.morningWeight = 70.4;
        const migrated = upsertDailyRecord(createEmptyDailyStore(900), legacy, 1100).records[0];
        expect(migrated.fields).toMatchObject({
            hasWatchSleepScore: "yes",
            watchSleepScore: 82,
            hasMorningWeight: "yes",
            morningWeight: 70.4,
        });

        migrated.fields.hasWatchSleepScore = "no";
        migrated.fields.hasMorningWeight = "no";
        const unavailable = upsertDailyRecord(createEmptyDailyStore(1200), migrated, 1300).records[0];
        expect(unavailable.fields).toMatchObject({
            hasWatchSleepScore: "no",
            watchSleepScore: null,
            hasMorningWeight: "no",
            morningWeight: null,
        });
    });

    it("损坏结构、重复日期和越界评分不会被静默接受", () => {
        expect(parseDailyStore({ version: 2, records: [] })).toBeNull();
        const record = createDailyRecord("2026-09-03", "research-workday", 1000);
        const duplicate = { version: 1, revision: 1, createdAt: 1, updatedAt: 1, records: [record, record] };
        expect(parseDailyStore(duplicate)).toBeNull();
        record.fields.daytimeEnergy = 9;
        const parsed = parseDailyStore({ version: 1, revision: 1, createdAt: 1, updatedAt: 1, records: [record] });
        expect(parsed?.records[0].fields.daytimeEnergy).toBeNull();
    });

    it("休假日不参与工作指标，备份在三个文件间轮换", () => {
        expect(isWorkMetricApplicable("holiday")).toBe(false);
        expect(isWorkMetricApplicable("conference-day")).toBe(true);
        expect(isWorkMetricApplicable("sunday-half-day")).toBe(true);
        expect([1, 2, 3, 4].map(dailyBackupFileForRevision)).toEqual([
            "daily-records.backup-1.json", "daily-records.backup-2.json", "daily-records.backup-3.json", "daily-records.backup-1.json",
        ]);
    });

    it("开会日明确不安排个人事务时清空相关填写，安排时保留内容", () => {
        const record = createDailyRecord("2026-09-03", "conference-day", 1000);
        record.fields.personalAffairsPlanned = "no";
        record.fields.personalProjectPlan = "此前的个人计划";
        record.fields.personalProjectDurationMinutes = 60;
        record.fields.personalLifeResult = "此前的结果";
        record.fields.personalProjectLinks = [{ workItemId: "personal-1", titleSnapshot: "写小说", pathSnapshot: "", typeSnapshot: "事务" }];

        const skipped = upsertDailyRecord(createEmptyDailyStore(900), record, 1100).records[0];
        expect(skipped.fields).toMatchObject({
            personalAffairsPlanned: "no",
            personalProjectLinks: [],
            personalProjectPlan: "",
            personalProjectDurationMinutes: null,
            personalLifeResult: "",
        });

        record.fields.personalAffairsPlanned = "yes";
        const planned = upsertDailyRecord(createEmptyDailyStore(1200), record, 1300).records[0];
        expect(planned.fields).toMatchObject({ personalAffairsPlanned: "yes", personalProjectPlan: "此前的个人计划", personalProjectDurationMinutes: 60 });
        expect(planned.fields.personalProjectLinks).toHaveLength(1);
    });

    it("旧记录里已有的个人事务补充说明会被推断为已选择“是”，不隐藏正文", () => {
        const legacy = createDailyRecord("2026-09-04", "research-workday", 1000);
        legacy.fields.personalProjectPlan = "先散步，再整理账目";
        const migrated = upsertDailyRecord(createEmptyDailyStore(900), legacy, 1100).records[0];
        expect(migrated.fields).toMatchObject({
            hasPersonalProjectNote: "yes",
            personalProjectPlan: "先散步，再整理账目",
            personalProjectNoteDraft: "",
        });

        const untouched = createDailyRecord("2026-09-04", "research-workday", 1000);
        expect(upsertDailyRecord(createEmptyDailyStore(900), untouched, 1100).records[0].fields).toMatchObject({
            hasPersonalProjectNote: "",
            personalProjectPlan: "",
            personalProjectNoteDraft: "",
        });
    });

    it("补充说明选择“否”时清空正文但保留暂存，改回“是”可恢复", () => {
        const record = createDailyRecord("2026-09-04", "research-workday", 1000);
        record.fields.hasPersonalProjectNote = "no";
        record.fields.personalProjectPlan = "";
        record.fields.personalProjectNoteDraft = "先散步 30 分钟，再整理家庭账目。";
        const skipped = upsertDailyRecord(createEmptyDailyStore(900), record, 1100).records[0];
        expect(skipped.fields).toMatchObject({
            hasPersonalProjectNote: "no",
            personalProjectPlan: "",
            personalProjectNoteDraft: "先散步 30 分钟，再整理家庭账目。",
        });
        expect(parseDailyStore({ version: 1, revision: 1, createdAt: 1, updatedAt: 1, records: [skipped] })?.records[0].fields.personalProjectNoteDraft)
            .toBe("先散步 30 分钟，再整理家庭账目。");

        const restored = { ...skipped, fields: { ...skipped.fields, hasPersonalProjectNote: "yes" as const, personalProjectPlan: "先散步 30 分钟，再整理家庭账目。" } };
        expect(upsertDailyRecord(createEmptyDailyStore(1200), restored, 1300).records[0].fields).toMatchObject({
            hasPersonalProjectNote: "yes",
            personalProjectPlan: "先散步 30 分钟，再整理家庭账目。",
            personalProjectNoteDraft: "",
        });
    });

    it("开会日不安排个人事务时连同补充说明与暂存一起清空", () => {
        const record = createDailyRecord("2026-09-03", "conference-day", 1000);
        record.fields.personalAffairsPlanned = "no";
        record.fields.personalProjectPlan = "会后计划";
        record.fields.personalProjectNoteDraft = "会后暂存";
        const saved = upsertDailyRecord(createEmptyDailyStore(900), record, 1100).records[0];
        expect(saved.fields).toMatchObject({
            personalAffairsPlanned: "no",
            hasPersonalProjectNote: "",
            personalProjectPlan: "",
            personalProjectNoteDraft: "",
        });
    });

    it("把只选择时分的睡眠输入解析为明确的跨日日期时间", () => {        const evening = createDailyRecord("2026-09-03", "research-workday", 1000);
        evening.fields.lightsOffTime = "22:07";
        evening.fields.wakeTime = "06:10";
        expect(resolveSleepDateTimes(evening).fields).toMatchObject({
            lightsOffAt: "2026-09-02T22:07",
            wakeAt: "2026-09-03T06:10",
        });

        const afterMidnight = createDailyRecord("2026-09-03", "research-workday", 1000);
        afterMidnight.fields.lightsOffTime = "00:30";
        afterMidnight.fields.wakeTime = "06:10";
        expect(resolveSleepDateTimes(afterMidnight).fields.lightsOffAt).toBe("2026-09-03T00:30");
    });

    it("把 12 点后的熄灯记为熬夜时段，没有具体时间时也可以只留标记", () => {
        const evening = createDailyRecord("2026-09-03", "research-workday", 1000);
        evening.fields.lightsOffTime = "22:07";
        evening.fields.wakeTime = "06:10";
        expect(resolveSleepDateTimes(evening).fields).toMatchObject({
            lightsOffAt: "2026-09-02T22:07",
            lightsOffBand: "before-midnight",
        });

        const afterMidnight = createDailyRecord("2026-09-03", "research-workday", 1000);
        afterMidnight.fields.lightsOffTime = "00:30";
        afterMidnight.fields.wakeTime = "06:10";
        expect(resolveSleepDateTimes(afterMidnight).fields).toMatchObject({
            lightsOffAt: "2026-09-03T00:30",
            lightsOffBand: "after-midnight",
        });

        // 熬夜标记可以独立保存：没有时间就不写 lightsOffAt，也不伪造 00:00
        const markerOnly = createDailyRecord("2026-09-03", "research-workday", 1000);
        markerOnly.fields.lightsOffBand = "after-midnight";
        const saved = upsertDailyRecord(createEmptyDailyStore(900), markerOnly, 1100).records[0];
        expect(saved.fields).toMatchObject({ lightsOffTime: "", lightsOffAt: "", lightsOffBand: "after-midnight" });

        // 12 点前是默认状态，没有时间时同样保留显式选择
        const beforeOnly = createDailyRecord("2026-09-03", "research-workday", 1000);
        beforeOnly.fields.lightsOffBand = "before-midnight";
        expect(resolveSleepDateTimes(beforeOnly).fields.lightsOffBand).toBe("before-midnight");
    });

    it("时间与时段冲突时以时间为准，非法时段被丢弃", () => {
        const conflicting = createDailyRecord("2026-09-03", "research-workday", 1000);
        conflicting.fields.lightsOffBand = "before-midnight";
        conflicting.fields.lightsOffTime = "00:30";
        conflicting.fields.wakeTime = "06:10";
        expect(resolveSleepDateTimes(conflicting).fields.lightsOffBand).toBe("after-midnight");

        const invalid = createDailyRecord("2026-09-03", "research-workday", 1000);
        invalid.fields.lightsOffBand = "afternoon" as never;
        expect(resolveSleepDateTimes(invalid).fields.lightsOffBand).toBe("");
    });

    it("已发布版本的数据没有时段字段时按已有时间补出来", () => {
        const withoutBand = (record: DailyRecord): DailyRecord => {
            const { lightsOffBand: _dropped, ...fields } = record.fields;
            return { ...record, fields: fields as DailyRecord["fields"] };
        };
        const legacy = createDailyRecord("2026-09-03", "research-workday", 1000);
        legacy.fields.lightsOffTime = "23:40";
        legacy.fields.wakeTime = "06:30";

        const parsed = parseDailyStore({ version: 1, revision: 3, createdAt: 1000, updatedAt: 2000, records: [withoutBand(legacy)] });
        expect(parsed?.records[0].fields.lightsOffBand).toBe("before-midnight");

        const legacyAfterMidnight = createDailyRecord("2026-09-04", "research-workday", 1000);
        legacyAfterMidnight.fields.lightsOffTime = "01:15";
        legacyAfterMidnight.fields.wakeTime = "07:00";
        const parsedAfterMidnight = parseDailyStore({ version: 1, revision: 4, createdAt: 1000, updatedAt: 2000, records: [withoutBand(legacyAfterMidnight)] });
        expect(parsedAfterMidnight?.records[0].fields.lightsOffBand).toBe("after-midnight");
        expect(parsedAfterMidnight?.records[0].fields.lightsOffAt).toBe("2026-09-04T01:15");
    });

    it("不需要工作闭环时保存为不适用语义，而不是零分钟", () => {
        const record = createDailyRecord("2026-09-03", "research-workday", 1000);
        record.fields.closureNeed = "not-needed";
        record.fields.closureObject = "此前填写的材料";
        record.fields.closurePlannedMinutes = 30;
        record.fields.closureNextStep = "此前填写的下一步";
        record.fields.closureActualMinutes = 15;

        const saved = upsertDailyRecord(createEmptyDailyStore(900), record, 1100).records[0];
        expect(saved.fields).toMatchObject({
            closureNeed: "not-needed",
            closureObject: "",
            closurePlannedMinutes: null,
            closureNextStep: "",
            closureActualMinutes: null,
        });
    });

    it("旧记录已有闭环内容时自动识别为需要闭环", () => {
        const record = createDailyRecord("2026-09-03", "research-workday", 1000);
        record.fields.closureObject = "论文图表";
        record.fields.closureNextStep = "明天整理图注";

        const saved = upsertDailyRecord(createEmptyDailyStore(900), record, 1100).records[0];
        expect(saved.fields.closureNeed).toBe("needed");
        expect(saved.fields.closureHasNextStep).toBe("yes");
        expect(saved.fields.closureNextStep).toBe("明天整理图注");
    });

    it("旧记录会从文字推断下班后工作和异常观察的判断状态", () => {
        const record = createDailyRecord("2026-09-04", "research-workday", 1000);
        record.fields.afterHoursWorkReason = "没有";
        record.fields.anomalyOrObservation = "午后出现短暂头痛";

        const saved = upsertDailyRecord(createEmptyDailyStore(900), record, 1100).records[0];
        expect(saved.fields).toMatchObject({
            afterHoursWorkOccurred: "no",
            afterHoursWorkReason: "",
            hasAnomalyOrObservation: "yes",
            anomalyOrObservation: "午后出现短暂头痛",
        });
    });

    it("旧记录会从临时调整文字推断判断状态，明确选择否时清空说明", () => {
        const legacy = createDailyRecord("2026-09-04", "research-workday", 1000);
        legacy.fields.dayAdjustments = "上午会议临时延长";
        const migrated = upsertDailyRecord(createEmptyDailyStore(900), legacy, 1100).records[0];
        expect(migrated.fields).toMatchObject({ hasDayAdjustments: "yes", dayAdjustments: "上午会议临时延长" });

        migrated.fields.hasDayAdjustments = "no";
        const cleared = upsertDailyRecord(createEmptyDailyStore(1200), migrated, 1300).records[0];
        expect(cleared.fields).toMatchObject({ hasDayAdjustments: "no", dayAdjustments: "" });
    });

    it("旧学习记录自动推断为有安排，明确没有时清空学习字段", () => {
        const legacy = createDailyRecord("2026-09-06", "sunday-half-day", 1000);
        legacy.fields.studyMaterial = "统计学习方法";
        legacy.fields.studyTopic = "第五章";
        const migrated = upsertDailyRecord(createEmptyDailyStore(900), legacy, 1100).records[0];
        expect(migrated.fields).toMatchObject({ professionalStudyPlanned: "yes", studyMaterial: "统计学习方法", studyTopic: "第五章" });

        migrated.fields.professionalStudyPlanned = "no";
        const cleared = upsertDailyRecord(createEmptyDailyStore(1200), migrated, 1300).records[0];
        expect(cleared.fields).toMatchObject({ professionalStudyPlanned: "no", studyMaterial: "", studyTopic: "", studyPlan: "", studyResult: "" });
    });

    it("周六旧记录会从复盘内容推断已复盘，明确未复盘时清空工作字段", () => {
        const legacy = createDailyRecord("2026-09-05", "saturday-reset", 1000);
        legacy.fields.workStartTime = "09:00";
        legacy.fields.plannedWorkEndTime = "11:00";
        legacy.fields.importantWorkPlan = "完成周复盘";
        const migrated = upsertDailyRecord(createEmptyDailyStore(900), legacy, 1100).records[0];
        expect(migrated.fields.saturdayReviewOccurred).toBe("yes");

        migrated.fields.saturdayReviewOccurred = "no";
        migrated.fields.actualWorkEndTime = "11:10";
        migrated.fields.keyWorkResult = "met";
        migrated.fields.importantWorkResult = "整理完成";
        const skipped = upsertDailyRecord(createEmptyDailyStore(1200), migrated, 1300).records[0];
        expect(skipped.fields).toMatchObject({
            saturdayReviewOccurred: "no",
            workStartTime: "",
            plannedWorkEndTime: "",
            importantWorkPlan: "",
            actualWorkEndTime: "",
            keyWorkResult: "",
            importantWorkResult: "",
        });
    });

    it("明确选择没有时清除条件说明，选择有时保留说明", () => {
        const record = createDailyRecord("2026-09-04", "research-workday", 1000);
        record.fields.afterHoursWorkOccurred = "no";
        record.fields.afterHoursWorkReason = "此前的原因";
        record.fields.hasAnomalyOrObservation = "yes";
        record.fields.anomalyOrObservation = "需要保留的观察";

        const saved = upsertDailyRecord(createEmptyDailyStore(900), record, 1100).records[0];
        expect(saved.fields.afterHoursWorkReason).toBe("");
        expect(saved.fields.anomalyOrObservation).toBe("需要保留的观察");
    });

    it("计划熄灯可明确落在次日，自由安排会清空计划而不影响实际睡眠记录", () => {
        const planned = createDailyRecord("2026-09-04", "research-workday", 1000);
        planned.fields.bedtimePreparation = "yes";
        planned.fields.plannedLightsOffDay = "next-day";
        planned.fields.plannedLightsOffTime = "00:45";
        expect(resolveSleepDateTimes(planned).fields.plannedLightsOffAt).toBe("2026-09-05T00:45");

        planned.fields.bedtimePreparation = "free";
        planned.fields.lightsOffTime = "00:30";
        planned.fields.wakeTime = "08:30";
        const free = upsertDailyRecord(createEmptyDailyStore(900), planned, 1100).records[0];
        expect(free.fields).toMatchObject({
            plannedLightsOffDay: "",
            plannedLightsOffTime: "",
            plannedLightsOffAt: "",
            lightsOffAt: "2026-09-04T00:30",
            wakeAt: "2026-09-04T08:30",
        });
    });

    it("旧的计划熄灯时间会按夜间语义补上日期范围", () => {
        const sameDay = createDailyRecord("2026-09-04", "research-workday", 1000);
        sameDay.fields.bedtimePreparation = "yes";
        sameDay.fields.plannedLightsOffTime = "23:30";
        const afterMidnight = createDailyRecord("2026-09-04", "research-workday", 1000);
        afterMidnight.fields.bedtimePreparation = "yes";
        afterMidnight.fields.plannedLightsOffTime = "00:30";

        expect(upsertDailyRecord(createEmptyDailyStore(900), sameDay, 1100).records[0].fields).toMatchObject({
            plannedLightsOffDay: "same-day",
            plannedLightsOffAt: "2026-09-04T23:30",
        });
        expect(upsertDailyRecord(createEmptyDailyStore(900), afterMidnight, 1100).records[0].fields).toMatchObject({
            plannedLightsOffDay: "next-day",
            plannedLightsOffAt: "2026-09-05T00:30",
        });
    });

    it("当场记录的实际熄灯归到当晚，凭回忆补记的仍按夜间语义归到前一夜", () => {
        // 睡前在当晚记录：22:47 就是今晚的熄灯，不能算成昨晚
        const live = createDailyRecord("2026-09-23", "research-workday", 1000);
        live.fields.lightsOffTime = "22:47";
        live.fields.lightsOffTimeSource = "live";
        expect(resolveSleepDateTimes(live).fields).toMatchObject({ lightsOffAt: "2026-09-23T22:47", lightsOffBand: "after-midnight" });

        // 凌晨当场记录：归日同样是当天，时间轴按 24:20 落在同一夜
        const liveAfterMidnight = createDailyRecord("2026-09-24", "research-workday", 1000);
        liveAfterMidnight.fields.lightsOffTime = "00:20";
        liveAfterMidnight.fields.lightsOffTimeSource = "live";
        expect(resolveSleepDateTimes(liveAfterMidnight).fields).toMatchObject({ lightsOffAt: "2026-09-24T00:20", lightsOffBand: "after-midnight" });

        // 旧口径不变：第二天早上补记的时刻属于前一夜
        const recalled = createDailyRecord("2026-09-24", "research-workday", 1000);
        recalled.fields.lightsOffTime = "22:47";
        expect(resolveSleepDateTimes(recalled).fields).toMatchObject({ lightsOffAt: "2026-09-23T22:47", lightsOffBand: "before-midnight" });

        // 没有来源标记的存量数据一律按旧口径解析
        const legacy = createDailyRecord("2026-09-24", "research-workday", 1000);
        legacy.fields.lightsOffTime = "23:07";
        expect(upsertDailyRecord(createEmptyDailyStore(900), legacy, 1100).records[0].fields).toMatchObject({
            lightsOffAt: "2026-09-23T23:07",
            lightsOffTimeSource: "",
        });
    });

    it("熄灯计划达成按 ±15 分钟自动判定，早于计划算守住", () => {
        const plan = (time: string) => {
            const record = createDailyRecord("2026-09-03", "research-workday", 1000);
            record.fields.bedtimePreparation = "yes";
            record.fields.plannedLightsOffTime = time;
            return resolveSleepDateTimes(record);
        };
        const morning = (lightsOffTime: string, source: "live" | "recalled" = "live") => {
            const record = createDailyRecord("2026-09-04", "research-workday", 1000);
            record.fields.lightsOffTime = lightsOffTime;
            record.fields.lightsOffTimeSource = source;
            return resolveSleepDateTimes(record);
        };
        const derive = (planned: DailyRecord | null, record: DailyRecord) => deriveLightsOffAdherence(lightsOffNightInput(planned, record));

        expect(derive(plan("22:30"), morning("22:45")).status).toBe("met");
        expect(derive(plan("22:30"), morning("22:46")).status).toBe("missed");
        expect(derive(plan("22:30"), morning("22:07")).status).toBe("met");
        // 计划在当晚、实际过了午夜：跨日比较不能变成「早 22 小时」
        expect(derive(plan("23:45"), morning("00:40")).status).toBe("missed");
        expect(derive(plan("22:30"), morning("22:30")).status).toBe("met");

        const met = derive(plan("22:30"), morning("22:45"));
        expect(met).toMatchObject({ source: "measured", evidence: { plannedTime: "22:30", actualTime: "22:45", diffMinutes: 15 } });
        const missed = derive(plan("22:30"), morning("22:07"));
        expect(missed).toMatchObject({ source: "measured", evidence: { diffMinutes: -23 } });
    });

    it("没有实际时刻时用人工回答，没有计划时不追问", () => {
        const plan = createDailyRecord("2026-09-03", "research-workday", 1000);
        plan.fields.bedtimePreparation = "yes";
        plan.fields.plannedLightsOffTime = "22:30";
        const resolvedPlan = resolveSleepDateTimes(plan);

        const answeredYes = createDailyRecord("2026-09-04", "research-workday", 1000);
        answeredYes.fields.lightsOffAdherence = "yes";
        expect(deriveLightsOffAdherence(lightsOffNightInput(resolvedPlan, answeredYes))).toEqual({ status: "met", source: "answered", evidence: null });

        const unanswered = createDailyRecord("2026-09-04", "research-workday", 1000);
        expect(deriveLightsOffAdherence(lightsOffNightInput(resolvedPlan, unanswered)).status).toBe("unanswered");

        const noPlan = createDailyRecord("2026-09-03", "research-workday", 1000);
        expect(deriveLightsOffAdherence(lightsOffNightInput(noPlan, unanswered)).status).toBe("unanswered");
        expect(deriveLightsOffAdherence(lightsOffNightInput(null, unanswered)).status).toBe("unanswered");

        // 自由安排的夜晚不产生计划参照
        noPlan.fields.bedtimePreparation = "free";
        expect(plannedLightsOffReference(noPlan)).toBeNull();
    });

    it("今晚计划可以当场算出，不依赖保存后才回填的派生字段", () => {
        // 草稿刚选完时间：plannedLightsOffAt 还是空的，界面也要能知道今晚计划落在哪一天
        const draft = createDailyRecord("2026-09-24", "research-workday", 1000);
        draft.fields.bedtimePreparation = "yes";
        draft.fields.plannedLightsOffTime = "22:30";
        expect(draft.fields.plannedLightsOffAt).toBe("");
        expect(plannedLightsOffReference(draft)).toBeNull();
        expect(plannedLightsOffReferenceFromFields(draft.date, draft.fields)).toEqual({
            plannedAt: "2026-09-24T22:30", time: "22:30", date: "2026-09-24",
        });

        // 12:00 以前的计划属于次日凌晨，与 resolveSleepDateTimes 的口径一致
        draft.fields.plannedLightsOffTime = "00:45";
        expect(plannedLightsOffReferenceFromFields(draft.date, draft.fields)).toEqual({
            plannedAt: "2026-09-25T00:45", time: "00:45", date: "2026-09-25",
        });
        // 显式选了「次日」时以显式选择为准
        draft.fields.plannedLightsOffDay = "next-day";
        draft.fields.plannedLightsOffTime = "23:30";
        expect(plannedLightsOffReferenceFromFields(draft.date, draft.fields)?.plannedAt).toBe("2026-09-25T23:30");

        // 没填时间或自由安排都没有可对照的计划
        draft.fields.plannedLightsOffTime = "";
        expect(plannedLightsOffReferenceFromFields(draft.date, draft.fields)).toBeNull();
        draft.fields.bedtimePreparation = "free";
        expect(plannedLightsOffReferenceFromFields(draft.date, draft.fields)).toBeNull();
    });

    it("手表入睡时间只做记录：跨午夜算入睡用时，且不影响熄灯计划判定", () => {
        const record = createDailyRecord("2026-09-24", "research-workday", 1000);
        record.fields.lightsOffTime = "23:45";
        record.fields.lightsOffTimeSource = "live";
        record.fields.wakeTime = "07:07";
        record.fields.hasWatchSleepScore = "yes";
        record.fields.watchSleepScore = 81;
        record.fields.watchSleepOnsetTime = "00:40";
        const resolved = resolveSleepDateTimes(record).fields;

        // 入睡时刻归到前一夜，跨午夜的差值不能变成负数
        expect(resolved.watchSleepOnsetAt).toBe("2026-09-24T00:40");
        expect(resolved.sleepLatencyMinutes).toBe(55);
        expect(sleepLatencyLabel(resolved.sleepLatencyMinutes)).toBe("55 分钟");

        // 躺下后很久才睡着也一样只是记录：判定只看熄灯，不因为入睡晚而变成未达成
        record.fields.watchSleepOnsetTime = "03:10";
        const lateOnset = resolveSleepDateTimes(record).fields;
        expect(lateOnset.sleepLatencyMinutes).toBe(205);
        expect(sleepLatencyLabel(lateOnset.sleepLatencyMinutes)).toBe("3 小时 25 分");
        expect(deriveLightsOffAdherence(lightsOffNightInput(null, { ...record, fields: lateOnset })).status).toBe("unanswered");

        // 没有熄灯时刻时不给潜伏期，避免凭空造一个数字
        const noLightsOff = createDailyRecord("2026-09-24", "research-workday", 1000);
        noLightsOff.fields.watchSleepOnsetTime = "00:40";
        expect(resolveSleepDateTimes(noLightsOff).fields).toMatchObject({ watchSleepOnsetAt: "2026-09-24T00:40", sleepLatencyMinutes: null });

        // 入睡时刻填了就是有；清空后连同派生值一起消失
        const cleared = createDailyRecord("2026-09-24", "research-workday", 1000);
        expect(cleared.fields.hasWatchSleepOnset).toBe("");
        expect(upsertDailyRecord(createEmptyDailyStore(900), { ...noLightsOff, fields: { ...noLightsOff.fields, watchSleepOnsetTime: "" } }, 1100).records[0].fields)
            .toMatchObject({ hasWatchSleepOnset: "", watchSleepOnsetTime: "", watchSleepOnsetAt: "", sleepLatencyMinutes: null });
    });

    it("自由安排会一并清掉人工回答，回答原因只跟着「否」保存", () => {
        const record = createDailyRecord("2026-09-04", "research-workday", 1000);
        record.fields.bedtimePreparation = "yes";
        record.fields.plannedLightsOffTime = "22:30";
        record.fields.lightsOffAdherence = "no";
        record.fields.lightsOffAdherenceReason = "小说写到一半没停下来";

        const saved = upsertDailyRecord(createEmptyDailyStore(900), record, 1100).records[0];
        expect(saved.fields).toMatchObject({
            lightsOffAdherence: "no",
            lightsOffAdherenceReason: "小说写到一半没停下来",
        });

        // 改成「是」或自由安排后，原因不再保留
        const flipped = { ...saved, fields: { ...saved.fields, lightsOffAdherence: "yes" as const } };
        expect(upsertDailyRecord(createEmptyDailyStore(1200), flipped, 1300).records[0].fields).toMatchObject({
            lightsOffAdherence: "yes",
            lightsOffAdherenceReason: "",
        });

        const free = { ...saved, fields: { ...saved.fields, bedtimePreparation: "free" as const } };
        expect(upsertDailyRecord(createEmptyDailyStore(1400), free, 1500).records[0].fields).toMatchObject({
            lightsOffAdherence: "",
            lightsOffAdherenceReason: "",
            plannedLightsOffAt: "",
        });
    });

    it("保存个人项目稳定引用与历史快照，并在克隆时隔离数组", () => {        const record = createDailyRecord("2026-09-04", "research-workday", 1000);
        record.fields.personalProjectLinks = [{
            workItemId: "project-1",
            titleSnapshot: "完善行舟",
            pathSnapshot: "个人系统 / 行舟",
            typeSnapshot: "项目",
        }, {
            workItemId: "project-1",
            titleSnapshot: "重复引用会被去重",
            pathSnapshot: "",
            typeSnapshot: "项目",
        }];

        const saved = upsertDailyRecord(createEmptyDailyStore(900), record, 1100).records[0];
        expect(saved.fields.personalProjectLinks).toEqual([{
            workItemId: "project-1",
            titleSnapshot: "完善行舟",
            pathSnapshot: "个人系统 / 行舟",
            typeSnapshot: "项目",
        }]);

        const cloned = cloneDailyRecord(saved);
        cloned.fields.personalProjectLinks[0].titleSnapshot = "修改克隆";
        expect(saved.fields.personalProjectLinks[0].titleSnapshot).toBe("完善行舟");
    });
});

describe("previousDayFirstAction 次日早晨提示", () => {
    function record(date: string, firstAction: string): DailyRecord {
        const value = createDailyRecord(date);
        value.fields.tomorrowFirstAction = firstAction;
        return value;
    }

    it("返回前一天记录中“明天开始工作时的第一个动作”", () => {
        const records = [record("2026-09-08", "打开实验记录"), record("2026-09-09", "写讨论部分")];
        expect(previousDayFirstAction(records, "2026-09-09")).toBe("打开实验记录");
    });

    it("前一天没有记录时返回空串", () => {
        expect(previousDayFirstAction([record("2026-09-07", "旧提示")], "2026-09-09")).toBe("");
    });

    it("前一天有记录但未填写时返回空串，不采用更早的非空提示", () => {
        const records = [record("2026-09-06", "旧提示"), record("2026-09-08", "")];
        expect(previousDayFirstAction(records, "2026-09-09")).toBe("");
    });

    it("跨月与跨年边界仍取字面前一天的记录", () => {
        expect(previousDayFirstAction([record("2026-02-28", "月界")], "2026-03-01")).toBe("月界");
        expect(previousDayFirstAction([record("2025-12-31", "年界")], "2026-01-01")).toBe("年界");
    });
});
