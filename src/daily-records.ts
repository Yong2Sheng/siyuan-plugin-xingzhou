export const DAILY_STORE_FILE = "daily-records.json";
export const DAILY_STORE_VERSION = 1;
export const DAILY_PROFILE_VERSION = 1;

export type DailyDayType = "research-workday" | "conference-day" | "saturday-reset" | "sunday-half-day" | "holiday";
export type WeightUnit = "kg" | "lb";
export type TriState = "yes" | "no" | "not-applicable" | "";
export type PresenceState = "yes" | "no" | "";
export type BedtimePreparation = "yes" | "no" | "free" | "";
export type PlannedLightsOffDay = "same-day" | "next-day" | "";
/** 就寝时段：12 点前 / 12 点后（熬夜）。有时间时由时间推导，没有时间时可以作为单独的熬夜标记保存。 */
export type LightsOffBand = "before-midnight" | "after-midnight" | "";
/**
 * 实际熄灯时刻的来源：
 * - `live`：关灯前在「睡前准备」里当场记录（一键「此刻熄灯」），归日就是记录日当晚；
 * - `recalled`：早期版本在第二天早上凭回忆补记，归日按「晚于起床时刻即属于前一夜」推导。
 * 两种来源在跨午夜时归日不同（当场记的 22:47 属于今晚，回忆的 22:47 属于昨晚），
 * 因此必须显式保存，不能靠时刻本身反推。
 */
export type LightsOffTimeSource = "live" | "recalled" | "";
/** 早晨对「昨晚是否按计划熄灯」的人工回答；仅用于系统无法推导时（有计划、但没记实际时刻）。 */
export type LightsOffAdherence = "yes" | "no" | "";
/** 熄灯计划达成的容差：比计划晚超过这个分钟数才算「没按计划」；早于计划一律算守住。 */
export const LIGHTS_OFF_TOLERANCE_MINUTES = 15;
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
    lightsOffTimeSource: LightsOffTimeSource;
    lightsOffAdherence: LightsOffAdherence;
    lightsOffAdherenceReason: string;
    wakeTime: string;
    lightsOffAt: string;
    lightsOffBand: LightsOffBand;
    wakeAt: string;
    sleepDurationMinutes: number | null;
    hasWatchSleepScore: PresenceState;
    watchSleepScore: number | null;
    /** 手表记录的入睡时刻。入睡是不可控的（熄灯早也可能翻来覆去），因此只记录、不参与任何达成判定。 */
    hasWatchSleepOnset: PresenceState;
    watchSleepOnsetTime: string;
    watchSleepOnsetAt: string;
    /** 熄灯 → 入睡的间隔（分钟）：可控的是熄灯，这个数字用来看「躺下后多久睡着」。 */
    sleepLatencyMinutes: number | null;
    subjectiveSleepQuality: number | null;
    hasMorningWeight: PresenceState;
    morningWeight: number | null;
    weightUnit: WeightUnit;
    workStartTime: string;
    plannedWorkEndTime: string;
    importantWorkPlan: string;
    saturdayReviewOccurred: PresenceState;
    hasDayAdjustments: PresenceState;
    dayAdjustments: string;
    trainingPlan: string;
    personalAffairsPlanned: PresenceState;
    personalProjectLinks: DailyWorkItemLink[];
    hasPersonalProjectNote: PresenceState;
    personalProjectPlan: string;
    personalProjectNoteDraft: string;
    restAndLifePlan: string;
    professionalStudyPlanned: PresenceState;
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
    closureHasNextStep: PresenceState;
    closureNextStep: string;
    closureActualMinutes: number | null;
    personalLifeResult: string;
    bestThing: string;
    obstacleOrCost: string;
    afterHoursWorkOccurred: PresenceState;
    afterHoursWorkReason: string;
    tomorrowFirstAction: string;
    hasAnomalyOrObservation: PresenceState;
    anomalyOrObservation: string;
    bedtimePreparation: BedtimePreparation;
    plannedLightsOffDay: PlannedLightsOffDay;
    plannedLightsOffTime: string;
    plannedLightsOffAt: string;
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

/** 返回给定日期前一天记录中“明天开始工作时的第一个动作”，供次日早晨只读提示使用；前一天没有记录或未填写时返回空串。 */
export function previousDayFirstAction(records: DailyRecord[], date: string): string {
    const record = records.find((candidate) => candidate.date === shiftDateKey(date, -1));
    return record ? (record.fields.tomorrowFirstAction ?? "").trim() : "";
}

/** 「熄灯 → 入睡」的间隔文案：小时 + 分钟，午睡式的小间隔只报分钟。 */
export function sleepLatencyLabel(minutes: number | null): string {
    if (minutes === null || !Number.isFinite(minutes)) return "";
    if (minutes < 60) return `${Math.round(minutes)} 分钟`;
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
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
 *
 * 就寝时段（lightsOffBand）跟着一起推导：有时间时以时间为准（凌晨时间算「12 点后」，即熬夜），
 * 没有时间时保留用户显式选择的时段，因此「12 点后 + 不记具体时间」可以只存一个标记。
 */
export function resolveSleepDateTimes(record: DailyRecord): DailyRecord {
    const next = cloneDailyRecord(record);
    const { lightsOffTime, wakeTime } = next.fields;
    next.fields.wakeAt = validTime(wakeTime) ? `${next.date}T${wakeTime}` : "";
    if (!validTime(lightsOffTime)) {
        next.fields.lightsOffAt = "";
        next.fields.lightsOffBand = lightsOffBand(next.fields.lightsOffBand);
        resolveWatchSleepOnset(next);
        resolvePlannedLightsOff(next);
        return next;
    }
    const lightsOffMinutes = clockMinutes(lightsOffTime);
    const wakeMinutes = validTime(wakeTime) ? clockMinutes(wakeTime) : null;
    /*
     * 当场记录（live）：记录时刻就是当晚，归日直接取记录日，不参与「晚于起床即属于前一夜」的推导；
     * 回忆补记（recalled）：保持旧口径，晚于起床时刻的一律算前一夜。
     */
    const isLive = next.fields.lightsOffTimeSource === "live";
    const belongsToPreviousDay = isLive ? false : wakeMinutes === null ? lightsOffMinutes >= 12 * 60 : lightsOffMinutes > wakeMinutes;
    const date = belongsToPreviousDay ? shiftDateKey(next.date, -1) : next.date;
    next.fields.lightsOffAt = `${date}T${lightsOffTime}`;
    next.fields.lightsOffBand = belongsToPreviousDay ? "before-midnight" : "after-midnight";
    resolveWatchSleepOnset(next);
    resolvePlannedLightsOff(next);
    return next;
}

/**
 * 手表入睡时刻：与熄灯同一套夜间语义（晚于起床时刻即属于前一夜）。
 * 它只是记录，不参与「是否按计划」的判定——入睡不受意志直接控制，
 * 拿它来评价会惩罚一件你控制不了的事。真正被评价的只有熄灯。
 */
function resolveWatchSleepOnset(record: DailyRecord): void {
    const fields = record.fields;
    /*
     * 只看时间值本身：草稿直接调 resolveSleepDateTimes 时 hasWatchSleepOnset 这个派生开关
     * 还没被规范化，不能因为它没跟上就丢掉用户刚填的入睡时间。
     */
    if (!validTime(fields.watchSleepOnsetTime)) {
        fields.watchSleepOnsetAt = "";
        fields.sleepLatencyMinutes = null;
        return;
    }
    const onsetMinutes = clockMinutes(fields.watchSleepOnsetTime);
    const wakeMinutes = validTime(fields.wakeTime) ? clockMinutes(fields.wakeTime) : null;
    const belongsToPreviousDay = wakeMinutes === null ? onsetMinutes >= 12 * 60 : onsetMinutes > wakeMinutes;
    fields.watchSleepOnsetAt = `${belongsToPreviousDay ? shiftDateKey(record.date, -1) : record.date}T${fields.watchSleepOnsetTime}`;
    fields.sleepLatencyMinutes = sleepLatency(fields.lightsOffAt, fields.watchSleepOnsetAt);
}

/**
 * 熄灯到入睡的间隔（分钟）。跨午夜时取模补回一天：23:45 熄灯、00:40 入睡 = 55 分钟，
 * 而不是负值或 22 小时。熄灯与入睡相差整天时按 1440 分钟处理，不伪造更细的数字。
 */
function sleepLatency(lightsOffAt: string, sleepOnsetAt: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(lightsOffAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(sleepOnsetAt)) return null;
    const diff = (Date.parse(sleepOnsetAt) - Date.parse(lightsOffAt)) / 60_000;
    if (!Number.isFinite(diff)) return null;
    const rounded = Math.round(diff);
    const wrapped = ((rounded % 1440) + 1440) % 1440;
    return wrapped === 0 && rounded !== 0 ? 1440 : wrapped;
}

/** 计划熄灯时刻：记录日当晚的计划由本记录持有；判定它守没守住要拿次日记录里的实际熄灯。 */
export function plannedLightsOffReference(record: DailyRecord): { plannedAt: string; time: string; date: string; free: boolean } | null {
    if (record.fields.bedtimePreparation === "free") return null;
    const plannedAt = record.fields.plannedLightsOffAt;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(plannedAt)) return null;
    return { plannedAt, time: plannedAt.slice(11), date: plannedAt.slice(0, 10), free: false };
}

/**
 * 同一口径的「当场计算」版本：`plannedLightsOffAt` 要等保存后才由 resolveSleepDateTimes 补出来，
 * 界面在用户刚选完时间、还没保存时也需要知道今晚计划落在哪一天，因此这里直接从原始字段算，
 * 复用同一个归属规则（12:00 以前视为次日凌晨），避免在组件里再抄一份日期推导。
 */
export function plannedLightsOffReferenceFromFields(date: string, fields: Pick<DailyRecordFields, "bedtimePreparation" | "plannedLightsOffDay" | "plannedLightsOffTime">): { plannedAt: string; time: string; date: string } | null {
    if (fields.bedtimePreparation === "free" || !validTime(fields.plannedLightsOffTime)) return null;
    const day = plannedLightsOffDay(fields.plannedLightsOffDay, fields.plannedLightsOffTime);
    if (!day) return null;
    const plannedDate = day === "next-day" ? shiftDateKey(date, 1) : date;
    return { plannedAt: `${plannedDate}T${fields.plannedLightsOffTime}`, time: fields.plannedLightsOffTime, date: plannedDate };
}

/**
 * 熄灯计划达成的推导结果。判定是现算的派生值、不落库，因此历史数据不需要迁移，
 * 也不会出现「存下来的判定与实测数据互相矛盾」。
 */
export type LightsOffAdherenceResult =
    | { status: "unanswered" }
    | { status: "met" | "missed"; source: "measured"; evidence: { plannedTime: string; actualTime: string; diffMinutes: number } }
    | { status: "met" | "missed"; source: "answered"; evidence: null };

/** 一个夜晚的完整判定输入：当晚计划（前一条记录）+ 次日早晨记录里保存的实际熄灯与人工回答。 */
export type LightsOffNightInput = {
    plannedAt: string;
    date: string;
    time: string;
    free: boolean;
    actualTime: string;
    actualAt: string;
    answered: LightsOffAdherence;
};

export function lightsOffNightInput(previousRecord: DailyRecord | null, record: DailyRecord): LightsOffNightInput {
    const reference = previousRecord ? plannedLightsOffReference(previousRecord) : null;
    return {
        plannedAt: reference?.plannedAt ?? "",
        date: reference?.date ?? "",
        time: reference?.time ?? "",
        free: previousRecord?.fields.bedtimePreparation === "free",
        actualTime: validTime(record.fields.lightsOffTime) ? record.fields.lightsOffTime : "",
        actualAt: record.fields.lightsOffAt,
        answered: record.fields.lightsOffAdherence,
    };
}

export function deriveLightsOffAdherence(input: LightsOffNightInput): LightsOffAdherenceResult {
    if (!input.plannedAt) return { status: "unanswered" };
    if (input.actualTime) {
        const diffMinutes = lightsOffDiffMinutes(input.actualTime, input.time);
        if (diffMinutes === null) return { status: "unanswered" };
        return {
            status: diffMinutes > LIGHTS_OFF_TOLERANCE_MINUTES ? "missed" : "met",
            source: "measured",
            evidence: { plannedTime: input.time, actualTime: input.actualTime, diffMinutes },
        };
    }
    const answered = lightsOffAdherenceState(input.answered);
    if (answered) return { status: answered === "yes" ? "met" : "missed", source: "answered", evidence: null };
    return { status: "unanswered" };
}

function lightsOffDiffMinutes(actualTime: string, plannedTime: string): number | null {
    if (!validTime(actualTime) || !validTime(plannedTime)) return null;
    const diff = clockMinutes(actualTime) - clockMinutes(plannedTime);
    // 熄灯发生在午夜之后（例如计划 23:45、实际 00:40）时，时钟读数更小，要补回一天
    return diff >= -12 * 60 ? diff : diff + 24 * 60;
}

function resolvePlannedLightsOff(record: DailyRecord): void {
    const fields = record.fields;
    if (fields.bedtimePreparation === "free") {
        fields.plannedLightsOffDay = "";
        fields.plannedLightsOffTime = "";
        fields.plannedLightsOffAt = "";
        fields.lightsOffAdherence = "";
        fields.lightsOffAdherenceReason = "";
        return;
    }
    if (!validTime(fields.plannedLightsOffTime)) {
        fields.plannedLightsOffAt = "";
        return;
    }
    if (!fields.plannedLightsOffDay) {
        fields.plannedLightsOffDay = clockMinutes(fields.plannedLightsOffTime) < 12 * 60 ? "next-day" : "same-day";
    }
    const date = fields.plannedLightsOffDay === "next-day" ? shiftDateKey(record.date, 1) : record.date;
    fields.plannedLightsOffAt = `${date}T${fields.plannedLightsOffTime}`;
}

function emptyDailyFields(): DailyRecordFields {
    return {
        lightsOffTime: "", lightsOffTimeSource: "", lightsOffAdherence: "", lightsOffAdherenceReason: "",
        wakeTime: "", lightsOffAt: "", lightsOffBand: "", wakeAt: "", sleepDurationMinutes: null,
        hasWatchSleepScore: "", watchSleepScore: null, hasWatchSleepOnset: "", watchSleepOnsetTime: "", watchSleepOnsetAt: "", sleepLatencyMinutes: null, subjectiveSleepQuality: null,
        hasMorningWeight: "", morningWeight: null, weightUnit: "kg", workStartTime: "",
        plannedWorkEndTime: "", importantWorkPlan: "", saturdayReviewOccurred: "", hasDayAdjustments: "", dayAdjustments: "", trainingPlan: "",
        personalAffairsPlanned: "", personalProjectLinks: [],
        hasPersonalProjectNote: "", personalProjectPlan: "", personalProjectNoteDraft: "",
        restAndLifePlan: "", professionalStudyPlanned: "", studyMaterial: "", studyTopic: "", studyPlan: "",
        studyResult: "", actualWorkEndTime: "", keyWorkResult: "", trainingCompleted: "",
        importantWorkResult: "", personalProjectDurationMinutes: null, daytimeEnergy: null,
        workEfficiency: null, promotingStress: null, depletingStress: null, closureNeed: "", closureObject: "",
        closurePlannedMinutes: null, closureHasNextStep: "", closureNextStep: "", closureActualMinutes: null,
        personalLifeResult: "", bestThing: "", obstacleOrCost: "", afterHoursWorkOccurred: "", afterHoursWorkReason: "",
        tomorrowFirstAction: "", hasAnomalyOrObservation: "", anomalyOrObservation: "", bedtimePreparation: "",
        plannedLightsOffDay: "", plannedLightsOffTime: "", plannedLightsOffAt: "",
    };
}

function normalizeDailyRecord(value: unknown): DailyRecord | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<DailyRecord>;
    if (!isDateKey(source.date) || !isDayType(source.dayType) || !source.fields || typeof source.fields !== "object") return null;
    const createdAt = finiteNumber(source.createdAt) ?? Date.now();
    const fields = source.fields as Partial<DailyRecordFields>;
    const normalizedClosureNeed = closureNeed(fields);
    const normalizedSaturdayReview = saturdayReviewOccurred(fields, source.dayType);
    const normalizedDayAdjustments = presenceState(fields.hasDayAdjustments, fields.dayAdjustments);
    const normalizedProfessionalStudy = presenceState(fields.professionalStudyPlanned, [fields.studyMaterial, fields.studyTopic, fields.studyPlan, fields.studyResult].map(textValue).join(""));
    const normalizedClosureHasNextStep = presenceState(fields.closureHasNextStep, fields.closureNextStep);
    const normalizedAfterHoursWork = presenceState(fields.afterHoursWorkOccurred, fields.afterHoursWorkReason);
    const normalizedAnomaly = presenceState(fields.hasAnomalyOrObservation, fields.anomalyOrObservation);
    const normalizedHasWatchSleepScore = measurementPresenceState(fields.hasWatchSleepScore, fields.watchSleepScore);
    // 入睡时间的「有无」直接由值决定：填了就是有。评分那栏已经表达了「今天有没有手表数据」，
    // 再给它一个独立开关只会多一次判断，而且两处开关容易互相矛盾。
    const normalizedHasWatchSleepOnset: PresenceState = validTime(textValue(fields.watchSleepOnsetTime)) ? "yes" : "";
    const normalizedHasMorningWeight = measurementPresenceState(fields.hasMorningWeight, fields.morningWeight);
    const normalizedPersonalProjectLinks = normalizeWorkItemLinks(fields.personalProjectLinks);
    const normalizedPersonalAffairsPlanned = personalAffairsState(fields, source.dayType, normalizedPersonalProjectLinks);
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
            hasWatchSleepScore: normalizedHasWatchSleepScore,
            watchSleepScore: normalizedHasWatchSleepScore === "yes" ? nullableBoundedNumber(fields.watchSleepScore, 0, 100) : null,
            hasWatchSleepOnset: normalizedHasWatchSleepOnset,
            watchSleepOnsetTime: normalizedHasWatchSleepOnset === "yes" ? textValue(fields.watchSleepOnsetTime) : "",
            subjectiveSleepQuality: nullableScore(fields.subjectiveSleepQuality),
            hasMorningWeight: normalizedHasMorningWeight,
            morningWeight: normalizedHasMorningWeight === "yes" ? nullableNonnegativeNumber(fields.morningWeight) : null,
            weightUnit: fields.weightUnit === "lb" ? "lb" : "kg",
            keyWorkResult: normalizedSaturdayReview === "no" ? "" : resultState(fields.keyWorkResult),
            trainingCompleted: triState(fields.trainingCompleted),
            saturdayReviewOccurred: normalizedSaturdayReview,
            workStartTime: normalizedSaturdayReview === "no" ? "" : textValue(fields.workStartTime),
            plannedWorkEndTime: normalizedSaturdayReview === "no" ? "" : textValue(fields.plannedWorkEndTime),
            importantWorkPlan: normalizedSaturdayReview === "no" ? "" : textValue(fields.importantWorkPlan),
            actualWorkEndTime: normalizedSaturdayReview === "no" ? "" : textValue(fields.actualWorkEndTime),
            importantWorkResult: normalizedSaturdayReview === "no" ? "" : textValue(fields.importantWorkResult),
            hasDayAdjustments: normalizedDayAdjustments,
            dayAdjustments: normalizedDayAdjustments === "yes" ? textValue(fields.dayAdjustments) : "",
            professionalStudyPlanned: normalizedProfessionalStudy,
            studyMaterial: normalizedProfessionalStudy === "yes" ? textValue(fields.studyMaterial) : "",
            studyTopic: normalizedProfessionalStudy === "yes" ? textValue(fields.studyTopic) : "",
            studyPlan: normalizedProfessionalStudy === "yes" ? textValue(fields.studyPlan) : "",
            studyResult: normalizedProfessionalStudy === "yes" ? textValue(fields.studyResult) : "",
            personalAffairsPlanned: normalizedPersonalAffairsPlanned,
            personalProjectLinks: source.dayType === "conference-day" && normalizedPersonalAffairsPlanned !== "yes" ? [] : normalizedPersonalProjectLinks,
            ...personalProjectNoteFields(fields, source.dayType, normalizedPersonalAffairsPlanned),
            personalProjectDurationMinutes: source.dayType === "conference-day" && normalizedPersonalAffairsPlanned !== "yes" ? null : nullableNonnegativeNumber(fields.personalProjectDurationMinutes),
            daytimeEnergy: nullableScore(fields.daytimeEnergy),
            workEfficiency: nullableScore(fields.workEfficiency),
            promotingStress: nullableScore(fields.promotingStress),
            depletingStress: nullableScore(fields.depletingStress),
            closureNeed: normalizedClosureNeed,
            closureObject: normalizedClosureNeed === "not-needed" ? "" : textValue(fields.closureObject),
            closurePlannedMinutes: normalizedClosureNeed === "not-needed" ? null : nullableNonnegativeNumber(fields.closurePlannedMinutes),
            closureHasNextStep: normalizedClosureNeed === "not-needed" ? "" : normalizedClosureHasNextStep,
            closureNextStep: normalizedClosureNeed === "needed" && normalizedClosureHasNextStep === "yes" ? textValue(fields.closureNextStep) : "",
            closureActualMinutes: normalizedClosureNeed === "not-needed" ? null : nullableNonnegativeNumber(fields.closureActualMinutes),
            personalLifeResult: source.dayType === "conference-day" && normalizedPersonalAffairsPlanned !== "yes" ? "" : textValue(fields.personalLifeResult),
            afterHoursWorkOccurred: normalizedAfterHoursWork,
            afterHoursWorkReason: normalizedAfterHoursWork === "yes" ? textValue(fields.afterHoursWorkReason) : "",
            hasAnomalyOrObservation: normalizedAnomaly,
            anomalyOrObservation: normalizedAnomaly === "yes" ? textValue(fields.anomalyOrObservation) : "",
            bedtimePreparation: bedtimePreparation(fields.bedtimePreparation),
            lightsOffBand: lightsOffBand(fields.lightsOffBand),
            lightsOffTimeSource: lightsOffTimeSource(fields.lightsOffTimeSource),
            lightsOffAdherence: lightsOffAdherenceState(fields.lightsOffAdherence),
            lightsOffAdherenceReason: lightsOffAdherenceState(fields.lightsOffAdherence) === "no" ? textValue(fields.lightsOffAdherenceReason) : "",
            plannedLightsOffDay: plannedLightsOffDay(fields.plannedLightsOffDay, fields.plannedLightsOffTime),
        },
    });
}

function stringFields(fields: Partial<DailyRecordFields>): Partial<DailyRecordFields> {
    const keys: Array<keyof DailyRecordFields> = [
        "lightsOffTime", "wakeTime", "lightsOffAt", "wakeAt", "workStartTime", "plannedWorkEndTime", "importantWorkPlan", "dayAdjustments",
        "trainingPlan", "personalProjectPlan", "personalProjectNoteDraft", "restAndLifePlan", "studyMaterial", "studyTopic", "studyPlan", "studyResult",
        "actualWorkEndTime", "importantWorkResult", "closureObject", "closureNextStep", "personalLifeResult", "bestThing",
        "obstacleOrCost", "afterHoursWorkReason", "tomorrowFirstAction", "anomalyOrObservation", "plannedLightsOffTime", "plannedLightsOffAt",
        "lightsOffAdherenceReason", "watchSleepOnsetTime", "watchSleepOnsetAt",
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
    return value === "research-workday" || value === "conference-day" || value === "saturday-reset" || value === "sunday-half-day" || value === "holiday";
}

function triState(value: unknown): TriState {
    return value === "yes" || value === "no" || value === "not-applicable" ? value : "";
}

function bedtimePreparation(value: unknown): BedtimePreparation {
    return value === "yes" || value === "no" || value === "free" ? value : "";
}

function lightsOffBand(value: unknown): LightsOffBand {
    return value === "before-midnight" || value === "after-midnight" ? value : "";
}

/** 存量记录没有来源标记：一律当作「回忆补记」，也就是旧版本一直以来的口径。 */
function lightsOffTimeSource(value: unknown): LightsOffTimeSource {
    return value === "live" || value === "recalled" ? value : "";
}

function lightsOffAdherenceState(value: unknown): LightsOffAdherence {
    return value === "yes" || value === "no" ? value : "";
}

function plannedLightsOffDay(value: unknown, time: unknown): PlannedLightsOffDay {
    if (value === "same-day" || value === "next-day") return value;
    if (typeof time !== "string" || !validTime(time)) return "";
    return clockMinutes(time) < 12 * 60 ? "next-day" : "same-day";
}

function presenceState(value: unknown, legacyText: unknown): PresenceState {
    if (value === "yes" || value === "no") return value;
    const text = textValue(legacyText).trim();
    if (!text) return "";
    return /^(无|没有|否|none)[。.!！]?$/i.test(text) ? "no" : "yes";
}

function measurementPresenceState(value: unknown, legacyNumber: unknown): PresenceState {
    if (value === "yes" || value === "no") return value;
    return finiteNumber(legacyNumber) !== null ? "yes" : "";
}

function personalAffairsState(fields: Partial<DailyRecordFields>, dayType: DailyDayType, links: DailyWorkItemLink[]): PresenceState {
    if (dayType !== "conference-day") return "";
    if (fields.personalAffairsPlanned === "yes" || fields.personalAffairsPlanned === "no") return fields.personalAffairsPlanned;
    return links.length > 0 || Boolean(textValue(fields.personalProjectPlan).trim()) || nullableNonnegativeNumber(fields.personalProjectDurationMinutes) !== null ? "yes" : "";
}

/**
 * 个人事务补充说明是条件字段：先用“是否有补充说明”做一次是／否判断，选“否”时正文清空但不销毁。
 * 选“否”时已写内容移入 personalProjectNoteDraft，改回“是”即可恢复；因此草稿只在选“否”时保留。
 */
function personalProjectNoteFields(fields: Partial<DailyRecordFields>, dayType: DailyDayType, personalAffairsPlanned: PresenceState): Pick<DailyRecordFields, "hasPersonalProjectNote" | "personalProjectPlan" | "personalProjectNoteDraft"> {
    const plan = textValue(fields.personalProjectPlan);
    if (dayType === "conference-day" && personalAffairsPlanned !== "yes") {
        return { hasPersonalProjectNote: "", personalProjectPlan: "", personalProjectNoteDraft: "" };
    }
    if (fields.hasPersonalProjectNote === "yes" || fields.hasPersonalProjectNote === "no") {
        return fields.hasPersonalProjectNote === "yes"
            ? { hasPersonalProjectNote: "yes", personalProjectPlan: plan, personalProjectNoteDraft: "" }
            : { hasPersonalProjectNote: "no", personalProjectPlan: "", personalProjectNoteDraft: plan || textValue(fields.personalProjectNoteDraft) };
    }
    // 已发布的数据没有这个决策字段：有正文时推断为“是”，让老记录的文字继续可见、可编辑。
    const legacyNote = presenceState(fields.hasPersonalProjectNote, plan);
    return legacyNote === "yes"
        ? { hasPersonalProjectNote: "yes", personalProjectPlan: plan, personalProjectNoteDraft: "" }
        : { hasPersonalProjectNote: "", personalProjectPlan: plan, personalProjectNoteDraft: "" };
}

function saturdayReviewOccurred(fields: Partial<DailyRecordFields>, dayType: DailyDayType): PresenceState {
    if (fields.saturdayReviewOccurred === "yes" || fields.saturdayReviewOccurred === "no") return fields.saturdayReviewOccurred;
    if (dayType !== "saturday-reset") return "";
    return [fields.workStartTime, fields.plannedWorkEndTime, fields.importantWorkPlan].some((value) => typeof value === "string" && Boolean(value.trim())) ? "yes" : "";
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

export function shiftDateKey(date: string, days: number): string {
    const parsed = new Date(`${date}T12:00:00`);
    parsed.setDate(parsed.getDate() + days);
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}
