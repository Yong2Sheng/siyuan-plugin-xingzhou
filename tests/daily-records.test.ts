import { describe, expect, it } from "vitest";
import {
    cloneDailyRecord,
    createDailyRecord,
    createEmptyDailyStore,
    dailyBackupFileForRevision,
    defaultDayType,
    isWorkMetricApplicable,
    parseDailyStore,
    resolveSleepDateTimes,
    upsertDailyRecord,
} from "../src/daily-records";

describe("生活节律内部数据库", () => {
    it("根据星期给出默认类型，同时允许节假日覆盖", () => {
        expect(defaultDayType("2026-09-03")).toBe("research-workday");
        expect(defaultDayType("2026-09-05")).toBe("saturday-reset");
        expect(defaultDayType("2026-09-06")).toBe("sunday-half-day");
        expect(createDailyRecord("2026-09-03", "holiday", 1000).dayType).toBe("holiday");
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
        expect(second.revision).toBe(3);
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
        expect(isWorkMetricApplicable("sunday-half-day")).toBe(true);
        expect([1, 2, 3, 4].map(dailyBackupFileForRevision)).toEqual([
            "daily-records.backup-1.json", "daily-records.backup-2.json", "daily-records.backup-3.json", "daily-records.backup-1.json",
        ]);
    });

    it("把只选择时分的睡眠输入解析为明确的跨日日期时间", () => {
        const evening = createDailyRecord("2026-09-03", "research-workday", 1000);
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

    it("保存个人项目稳定引用与历史快照，并在克隆时隔离数组", () => {
        const record = createDailyRecord("2026-09-04", "research-workday", 1000);
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
