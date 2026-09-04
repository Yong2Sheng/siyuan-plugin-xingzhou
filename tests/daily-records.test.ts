import { describe, expect, it } from "vitest";
import {
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

        const saved = upsertDailyRecord(createEmptyDailyStore(900), record, 1100).records[0];
        expect(saved.fields.closureNeed).toBe("needed");
    });
});
