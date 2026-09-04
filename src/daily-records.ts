export const DAILY_STORE_FILE = "daily-records.json";
export const DAILY_STORE_VERSION = 1;
export const DAILY_PROFILE_VERSION = 1;

export type DailyDayType = "research-workday" | "saturday-reset" | "sunday-half-day" | "holiday";
export type WeightUnit = "kg" | "lb";
export type TriState = "yes" | "no" | "not-applicable" | "";
export type ResultState = "met" | "exceeded" | "missed" | "not-applicable" | "";
export type ClosureNeed = "needed" | "not-needed" | "";

export type DailyWorkItemLink = {
    workItemId: string;
    titleSnapshot: string;
    pathSnapshot: string;
    typeSnapshot: string;
};

export type DailyRecordFields = {
    lightsOffTime: string;
    wakeTime: string;
    lightsOffAt: string;
    wakeAt: string;
    sleepDurationMinutes: number | null;
    watchSleepScore: number | null;
    subjectiveSleepQuality: number | null;
    morningWeight: number | null;
    weightUnit: WeightUnit;
    workStartTime: string;
    plannedWorkEndTime: string;
    importantWorkPlan: string;
    dayAdjustments: string;
    trainingPlan: string;
    personalProjectLinks: DailyWorkItemLink[];
    personalProjectPlan: string;
    restAndLifePlan: string;
    studyMaterial: string;
    studyTopic: string;
    studyPlan: string;
    studyResult: string;
    actualWorkEndTime: string;
    keyWorkResult: ResultState;
    trainingCompleted: TriState;
    importantWorkResult: string;
    personalProjectDurationMinutes: number | null;
    daytimeEnergy: number | null;
    workEfficiency: number | null;
    promotingStress: number | null;
    depletingStress: number | null;
    closureNeed: ClosureNeed;
    closureObject: string;
    closurePlannedMinutes: number | null;
    closureNextStep: string;
    closureActualMinutes: number | null;
    personalLifeResult: string;
    bestThing: string;
    obstacleOrCost: string;
    afterHoursWorkReason: string;
    tomorrowFirstAction: string;
    anomalyOrObservation: string;
    bedtimePreparation: TriState;
    plannedLightsOffTime: string;
};

export type DailyRecord = {
    date: string;
    dayType: DailyDayType;
    profileVersion: 1;
    createdAt: number;
    updatedAt: number;
    fields: DailyRecordFields;
};

export type DailyRecordStore = {
    version: 1;
    revision: number;
    createdAt: number;
    updatedAt: number;
    records: DailyRecord[];
};

export type DailyRubric = {
    id: "subjectiveSleepQuality" | "daytimeEnergy" | "workEfficiency" | "promotingStress" | "depletingStress";
    label: string;
    direction: "higher-is-better" | "lower-is-better" | "balanced";
    levels: readonly [string, string, string, string, string];
};

export const DAILY_RUBRICS: readonly DailyRubric[] = [
    {
        id: "subjectiveSleepQuality",
        label: "主观睡眠质量",
        direction: "higher-is-better",
        levels: ["睡眠很差，明显影响当天状态", "睡眠不足或多次醒来，恢复有限", "基本正常，能够完成日常活动", "睡得较好，醒来后恢复充分", "睡眠非常好，醒来清醒且精力充足"],
    },
    {
        id: "daytimeEnergy",
        label: "白天精力",
        direction: "higher-is-better",
        levels: ["明显疲惫，难以维持正常活动", "精力偏低，需要频繁休息", "精力正常，可以完成计划", "精力良好，工作和训练状态稳定", "精力非常充足，但没有过度兴奋或透支感"],
    },
    {
        id: "workEfficiency",
        label: "工作效率",
        direction: "higher-is-better",
        levels: ["核心任务几乎没有推进", "有少量推进，明显低于预期", "正常完成主要工作", "重点明确，产生高质量进展", "高效完成关键成果且没有透支"],
    },
    {
        id: "promotingStress",
        label: "促进性压力",
        direction: "balanced",
        levels: ["几乎没有形成动力", "有轻微推动但帮助有限", "适度紧迫，帮助开始并持续推进", "明显增强专注且仍然可控", "显著推动高质量产出但仍能停止"],
    },
    {
        id: "depletingStress",
        label: "损耗性压力",
        direction: "lower-is-better",
        levels: ["几乎没有焦虑、沮丧或恢复损耗", "轻微不适，基本不影响生活", "损耗可感，需要正常恢复", "明显影响情绪、注意力或恢复", "压力过载，明显妨碍工作与生活"],
    },
] as const;

export function createEmptyDailyStore(now = Date.now()): DailyRecordStore {
    return { version: DAILY_STORE_VERSION, revision: 1, createdAt: now, updatedAt: now, records: [] };
}

export function createDailyRecord(date: string, dayType = defaultDayType(date), now = Date.now()): DailyRecord {
    if (!isDateKey(date)) throw new Error("每日记录日期格式无效。");
    return {
        date,
        dayType,
        profileVersion: DAILY_PROFILE_VERSION,
        createdAt: now,
        updatedAt: now,
        fields: emptyDailyFields(),
    };
}

export function defaultDayType(date: string): DailyDayType {
    if (!isDateKey(date)) return "research-workday";
    const weekday = new Date(`${date}T12:00:00`).getDay();
    if (weekday === 6) return "saturday-reset";
    if (weekday === 0) return "sunday-half-day";
    return "research-workday";
}

export function parseDailyStore(value: unknown): DailyRecordStore | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<DailyRecordStore>;
    if (source.version !== DAILY_STORE_VERSION || !Array.isArray(source.records)) return null;
    const dates = new Set<string>();
    const records: DailyRecord[] = [];
    for (const value of source.records) {
        const record = normalizeDailyRecord(value);
        if (!record || dates.has(record.date)) return null;
        dates.add(record.date);
        records.push(record);
    }
    const createdAt = finiteNumber(source.createdAt) ?? Date.now();
    return {
        version: DAILY_STORE_VERSION,
        revision: Math.max(0, Math.trunc(finiteNumber(source.revision) ?? 0)),
        createdAt,
        updatedAt: finiteNumber(source.updatedAt) ?? createdAt,
        records: records.sort((a, b) => a.date.localeCompare(b.date)),
    };
}

export function upsertDailyRecord(store: DailyRecordStore, incoming: DailyRecord, now = Date.now()): DailyRecordStore {
    const normalized = normalizeDailyRecord({ ...resolveSleepDateTimes(incoming), updatedAt: now });
    if (!normalized) throw new Error("每日记录包含无法识别的数据，已停止保存。");
    const existing = store.records.find((record) => record.date === normalized.date);
    const record = { ...normalized, createdAt: existing?.createdAt ?? normalized.createdAt, updatedAt: now };
    const records = store.records.filter((entry) => entry.date !== record.date).map(cloneDailyRecord);
    records.push(record);
    records.sort((a, b) => a.date.localeCompare(b.date));
    return { ...store, revision: store.revision + 1, updatedAt: now, records };
}

export function dailyStoresMatch(expected: DailyRecordStore, actual: DailyRecordStore): boolean {
    return JSON.stringify(expected) === JSON.stringify(actual);
}

export function dailyBackupFileForRevision(revision: number): string {
    return `daily-records.backup-${Math.abs(revision - 1) % 3 + 1}.json`;
}

export function isWorkMetricApplicable(dayType: DailyDayType): boolean {
    return dayType !== "holiday";
}

export function cloneDailyRecord(record: DailyRecord): DailyRecord {
    return {
        ...record,
        fields: {
            ...record.fields,
            personalProjectLinks: record.fields.personalProjectLinks.map((link) => ({ ...link })),
        },
    };
}

/**
 * Attach explicit local date-times while keeping the UI's compact time-only inputs.
 * A clock time later than the wake time belongs to the previous calendar day;
 * an after-midnight time belongs to the record date.
 */
export function resolveSleepDateTimes(record: DailyRecord): DailyRecord {
    const next = cloneDailyRecord(record);
    const { lightsOffTime, wakeTime } = next.fields;
    next.fields.wakeAt = validTime(wakeTime) ? `${next.date}T${wakeTime}` : "";
    if (!validTime(lightsOffTime)) {
        next.fields.lightsOffAt = "";
        return next;
    }
    const lightsOffMinutes = clockMinutes(lightsOffTime);
    const wakeMinutes = validTime(wakeTime) ? clockMinutes(wakeTime) : null;
    const belongsToPreviousDay = wakeMinutes === null ? lightsOffMinutes >= 12 * 60 : lightsOffMinutes > wakeMinutes;
    const date = belongsToPreviousDay ? shiftDateKey(next.date, -1) : next.date;
    next.fields.lightsOffAt = `${date}T${lightsOffTime}`;
    return next;
}

function emptyDailyFields(): DailyRecordFields {
    return {
        lightsOffTime: "", wakeTime: "", lightsOffAt: "", wakeAt: "", sleepDurationMinutes: null, watchSleepScore: null,
        subjectiveSleepQuality: null, morningWeight: null, weightUnit: "kg", workStartTime: "",
        plannedWorkEndTime: "", importantWorkPlan: "", dayAdjustments: "", trainingPlan: "", personalProjectLinks: [],
        personalProjectPlan: "", restAndLifePlan: "", studyMaterial: "", studyTopic: "", studyPlan: "",
        studyResult: "", actualWorkEndTime: "", keyWorkResult: "", trainingCompleted: "",
        importantWorkResult: "", personalProjectDurationMinutes: null, daytimeEnergy: null,
        workEfficiency: null, promotingStress: null, depletingStress: null, closureNeed: "", closureObject: "",
        closurePlannedMinutes: null, closureNextStep: "", closureActualMinutes: null,
        personalLifeResult: "", bestThing: "", obstacleOrCost: "", afterHoursWorkReason: "",
        tomorrowFirstAction: "", anomalyOrObservation: "", bedtimePreparation: "", plannedLightsOffTime: "",
    };
}

function normalizeDailyRecord(value: unknown): DailyRecord | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<DailyRecord>;
    if (!isDateKey(source.date) || !isDayType(source.dayType) || !source.fields || typeof source.fields !== "object") return null;
    const createdAt = finiteNumber(source.createdAt) ?? Date.now();
    const fields = source.fields as Partial<DailyRecordFields>;
    const normalizedClosureNeed = closureNeed(fields);
    return resolveSleepDateTimes({
        date: source.date,
        dayType: source.dayType,
        profileVersion: DAILY_PROFILE_VERSION,
        createdAt,
        updatedAt: finiteNumber(source.updatedAt) ?? createdAt,
        fields: {
            ...emptyDailyFields(),
            ...stringFields(fields),
            sleepDurationMinutes: nullableNonnegativeNumber(fields.sleepDurationMinutes),
            watchSleepScore: nullableBoundedNumber(fields.watchSleepScore, 0, 100),
            subjectiveSleepQuality: nullableScore(fields.subjectiveSleepQuality),
            morningWeight: nullableNonnegativeNumber(fields.morningWeight),
            weightUnit: fields.weightUnit === "lb" ? "lb" : "kg",
            keyWorkResult: resultState(fields.keyWorkResult),
            trainingCompleted: triState(fields.trainingCompleted),
            personalProjectLinks: normalizeWorkItemLinks(fields.personalProjectLinks),
            personalProjectDurationMinutes: nullableNonnegativeNumber(fields.personalProjectDurationMinutes),
            daytimeEnergy: nullableScore(fields.daytimeEnergy),
            workEfficiency: nullableScore(fields.workEfficiency),
            promotingStress: nullableScore(fields.promotingStress),
            depletingStress: nullableScore(fields.depletingStress),
            closureNeed: normalizedClosureNeed,
            closureObject: normalizedClosureNeed === "not-needed" ? "" : textValue(fields.closureObject),
            closurePlannedMinutes: normalizedClosureNeed === "not-needed" ? null : nullableNonnegativeNumber(fields.closurePlannedMinutes),
            closureNextStep: normalizedClosureNeed === "not-needed" ? "" : textValue(fields.closureNextStep),
            closureActualMinutes: normalizedClosureNeed === "not-needed" ? null : nullableNonnegativeNumber(fields.closureActualMinutes),
            bedtimePreparation: triState(fields.bedtimePreparation),
        },
    });
}

function stringFields(fields: Partial<DailyRecordFields>): Partial<DailyRecordFields> {
    const keys: Array<keyof DailyRecordFields> = [
        "lightsOffTime", "wakeTime", "lightsOffAt", "wakeAt", "workStartTime", "plannedWorkEndTime", "importantWorkPlan", "dayAdjustments",
        "trainingPlan", "personalProjectPlan", "restAndLifePlan", "studyMaterial", "studyTopic", "studyPlan", "studyResult",
        "actualWorkEndTime", "importantWorkResult", "closureObject", "closureNextStep", "personalLifeResult", "bestThing",
        "obstacleOrCost", "afterHoursWorkReason", "tomorrowFirstAction", "anomalyOrObservation", "plannedLightsOffTime",
    ];
    return Object.fromEntries(keys.map((key) => [key, typeof fields[key] === "string" ? fields[key] : ""])) as Partial<DailyRecordFields>;
}

function textValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function normalizeWorkItemLinks(value: unknown): DailyWorkItemLink[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const result: DailyWorkItemLink[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") continue;
        const source = entry as Partial<DailyWorkItemLink>;
        const workItemId = textValue(source.workItemId).trim();
        const titleSnapshot = textValue(source.titleSnapshot).trim();
        if (!workItemId || !titleSnapshot || seen.has(workItemId)) continue;
        seen.add(workItemId);
        result.push({
            workItemId,
            titleSnapshot,
            pathSnapshot: textValue(source.pathSnapshot).trim(),
            typeSnapshot: textValue(source.typeSnapshot).trim(),
        });
    }
    return result;
}

function isDateKey(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function isDayType(value: unknown): value is DailyDayType {
    return value === "research-workday" || value === "saturday-reset" || value === "sunday-half-day" || value === "holiday";
}

function triState(value: unknown): TriState {
    return value === "yes" || value === "no" || value === "not-applicable" ? value : "";
}

function resultState(value: unknown): ResultState {
    return value === "met" || value === "exceeded" || value === "missed" || value === "not-applicable" ? value : "";
}

function closureNeed(fields: Partial<DailyRecordFields>): ClosureNeed {
    if (fields.closureNeed === "needed" || fields.closureNeed === "not-needed") return fields.closureNeed;
    if (
        (typeof fields.closureObject === "string" && Boolean(fields.closureObject.trim()))
        || (typeof fields.closureNextStep === "string" && Boolean(fields.closureNextStep.trim()))
        || nullableNonnegativeNumber(fields.closurePlannedMinutes) !== null
        || nullableNonnegativeNumber(fields.closureActualMinutes) !== null
    ) return "needed";
    return "";
}

function nullableScore(value: unknown): number | null {
    return nullableBoundedNumber(value, 1, 5);
}

function nullableNonnegativeNumber(value: unknown): number | null {
    const number = finiteNumber(value);
    return number !== null && number >= 0 ? number : null;
}

function nullableBoundedNumber(value: unknown, minimum: number, maximum: number): number | null {
    const number = finiteNumber(value);
    return number !== null && number >= minimum && number <= maximum ? number : null;
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validTime(value: string): boolean {
    if (!/^\d{2}:\d{2}$/.test(value)) return false;
    const [hour, minute] = value.split(":").map(Number);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function clockMinutes(value: string): number {
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function shiftDateKey(date: string, days: number): string {
    const parsed = new Date(`${date}T12:00:00`);
    parsed.setDate(parsed.getDate() + days);
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}
