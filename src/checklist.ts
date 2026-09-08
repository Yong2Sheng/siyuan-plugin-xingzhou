export const CHECKLIST_STORE_FILE = "checklist.json";
export const CHECKLIST_STORE_VERSION = 1;

export type ChecklistViewMode = "xingzhou" | "paper";
export type ChecklistTemplateId = "workday" | "conference" | "saturday" | "sunday";
export type ChecklistTone = "plain" | "mint" | "sand" | "rose";
export type ChecklistTrainingMode = "training" | "rest" | "";
export type ChecklistReminderState = "completed" | "partial" | "missed";

export type ChecklistDayState = {
    date: string;
    checkedKeys: string[];
    reminderStates: Record<string, ChecklistReminderState>;
    trainingMode: ChecklistTrainingMode;
    updatedAt: number;
};

export type ChecklistEntry = {
    id: string;
    time: string;
    title: string;
    reminders: string[];
    trainingChoices?: {
        training: string[];
        rest: string[];
    };
    tone: ChecklistTone;
};

export type ChecklistTemplate = {
    id: ChecklistTemplateId;
    label: string;
    subtitle: string;
    entries: ChecklistEntry[];
};

export type ChecklistStore = {
    version: 1;
    revision: number;
    updatedAt: number;
    viewMode: ChecklistViewMode;
    templates: ChecklistTemplate[];
    dayStates: ChecklistDayState[];
};

const entry = (
    id: string,
    time: string,
    title: string,
    reminders: string[],
    tone: ChecklistTone = "plain",
    trainingChoices?: ChecklistEntry["trainingChoices"],
): ChecklistEntry => ({ id, title, time, reminders, tone, ...(trainingChoices ? { trainingChoices } : {}) });

export function createDefaultChecklistStore(now = Date.now()): ChecklistStore {
    return {
        version: CHECKLIST_STORE_VERSION,
        revision: 1,
        updatedAt: now,
        viewMode: "xingzhou",
        dayStates: [],
        templates: [
            {
                id: "workday",
                label: "工作日",
                subtitle: "默认节奏可按现实重排；16:00–17:00 下班边界不后移",
                entries: [
                    entry("wd-wake", "默认 06:00", "起床", ["离床、如厕后、进食饮水前称重", "喝水、吃一根香蕉；洗头洗脸、整理头发，06:30 拎包出发"]),
                    entry("wd-drive", "06:30–07:00", "开车＋停车＋放好物品", ["06:30 开车出发；约 06:45 在学院门口停车", "先去办公室放好当天物品，再前往健身房；07:00 开始训练"]),
                    entry("wd-training", "07:00–08:30", "器材训练", ["只做需要器材的动作；最后一组无器材核心回家完成", "分次喝稀释乳清；肌酸 3–5 g 在训练结束前喝完；08:30 结束"]),
                    entry("wd-breakfast", "08:30–09:00 左右", "返回办公室＋早餐＋日评估", ["08:30 离开健身房；约 08:40 回到办公室", "玉米、红薯、鸡蛋；随餐鱼油 1 粒", "打开生活节律，完成睡眠、体重与训练记录"], "mint"),
                    entry("wd-plan", "约 09:00 开始", "今日节奏确认＋工作规划", ["写下固定事项及时间；训练选照常、缩短、改期或休息", "确定最重要结果和第一个动作", "开始较晚则缩减科研范围；不挤占专业学习或私人时间", "在 16:00–17:00 内自选正式下班时间；预留约 15 分钟收尾仪式"], "mint"),
                    entry("wd-morning-work", "规划后–午饭前", "上午工作｜先低沉浸，后高认知", ["先做相对容易、无需高强度思考、能轻松抽离的任务", "完成一项或一组后转入高认知主任务；开始前写停点、设提醒"]),
                    entry("wd-lunch", "12:00 左右", "午饭", ["离开办公桌；蛋白质＋水果＋适量主食", "随餐鱼油 1 粒；不边吃边工作"]),
                    entry("wd-study", "午饭后安排｜约 60 分钟", "专业学习｜下班前完成", ["连续 60 分钟或拆成 30＋30 分钟", "低压力，不要求正式产出；材料、进度和停点在生活节律中记录"], "mint"),
                    entry("wd-deep-work", "学习安排之外–收尾前", "高认知主任务", ["进入或继续当天的一个主任务；临近收尾不再开启新的深度单元", "到预定收尾时刻立即中断；不等待“最后一点”做完"]),
                    entry("wd-shutdown", "计划下班前约 15 分钟", "下班收尾仪式｜属于工作时间", ["提醒响起立即停，不做“最后一点”；记录结果与当前停点", "写明下一工作时段的第一个具体动作", "若需晚间整理，只写下待整理入口，不在此展开", "停止执行与外部沟通；关闭工作软件，邮件与 Slack 免打扰", "仪式完成后才算正式下班，并记录实际下班时间"], "rose"),
                    entry("wd-off", "16:00–17:00", "按早晨计划正式下班", ["区间内自选现实时间；计划时刻＝收尾完成并关闭工作环境", "白天客观变更不覆盖原计划；在生活节律中说明原因"], "sand"),
                    entry("wd-boundary", "正式下班以后", "私人时间＋工作闭环边界", ["邮件、Slack、执行性工作与外部沟通留到下一工作时段", "按需做一次低压力闭环：整理已有结果、标记停点、计划明天第一步；10–20 分钟，最长 30 分钟", "闭环只记录问题、确定第一步；不解决、不启动；真紧急才电话处理"], "rose"),
                    entry("wd-dinner", "18:00 前后", "晚饭与回家", ["随餐鱼油 1 粒", "到家先用约 30 分钟放松、换衣服并与对象交流"]),
                    entry("wd-personal", "晚饭后", "一个兴趣项目或休息", ["打开项目与事务“本周”，只做今天安排的一个主要工作项", "持续 60–90 分钟；不合适就改期、阅读或休息，不临时从全池重选"], "mint"),
                    entry("wd-casein", "20:00", "酪蛋白｜按需", ["仅在全天蛋白质不足或晚上容易饥饿时饮用"]),
                    entry("wd-prepare", "20:15–21:00", "准备明天", ["整理书包；训练用品、蛋白粉和肌酸提前装好，确保拎起就走", "净水器加满水；给蒸锅换水", "早餐入蒸锅：2 个鸡蛋、1/4 红薯、半根玉米、100g 冻虾", "洗净所有脏杯子和碗"], "sand"),
                    entry("wd-review", "21:00", "日评估晚间段＋睡前准备", ["完成生活节律晚间段，补齐当天记录", "正文记成果、阻碍和明天第一步", "21:00 停止全部工作（含整理与计划）；不看手机，洗漱降刺激"], "rose"),
                    entry("wd-sleep", "22:00", "熄灯", ["优先保证睡眠；不为兴趣项目推迟", "久睡不着：离床，在暗光下读平静纸书；不读科研笔记或自己的小说"], "mint"),
                ],
            },
            {
                id: "conference",
                label: "开会日",
                subtitle: "会议开始至结束不预设自由时间；会后再决定社交、个人事务或休息",
                entries: [
                    entry("conf-morning", "起床后", "晨间记录与基本准备", ["完成睡眠、身体和训练状态记录", "开会日在外进食不可控，今天不记录或补录营养摄入"], "mint"),
                    entry("conf-depart", "出发／上线前", "检查会议准备", ["确认 conference、talk 或合作会议的时间、地点与接入方式", "带齐电脑、充电器、会议材料和必要证件；只处理必须在会前完成的消息"], "sand"),
                    entry("conf-focus", "会议开始前", "确认今日会议重点", ["写下今天最重要的会议／工作内容和希望带走的一个结果", "记录会议开始时间；预计结束时间可以留空，不把估计当作下班承诺"], "mint"),
                    entry("conf-meeting", "会议开始–会议结束", "会议与交流优先", ["会议、talk 和合作交流优先，不并行安排深度科研或专业学习", "会议结束前不预设自由时间，也不要求推进个人事务", "只在间隙处理必要消息，并给自己留出喝水、走动和短暂恢复的空间"], "rose"),
                    entry("conf-meals", "会议间隙", "正常进食与恢复", ["按现场条件正常吃饭和补水，不追求精确控制", "不估算热量和营养素，也不在晚上凭记忆补录"], "plain"),
                    entry("conf-end", "会议结束后", "记录实际结束与关键结果", ["记录会议实际结束时间；开会日不评价是否超出预计时间", "写下关键结果、承诺事项和下一步入口；需要整理时只做低压力闭环"], "sand"),
                    entry("conf-evening-choice", "会后", "确认晚间安排", ["在生活节律中选择是否安排个人事务", "与同事聚餐、活动或需要休息时选择“不安排”；无需填写个人事务", "选择“安排”后，再照常选择个人事务并记录计划与实际时长"], "mint"),
                    entry("conf-review", "睡前", "简要复盘与明日承接", ["完成生活节律晚间记录，写下成果、消耗和明天第一个动作", "不补录营养；会议结束较晚时优先缩短流程并保证睡眠"], "rose"),
                    entry("conf-sleep", "准备好后", "降低刺激并熄灯", ["会议带来的兴奋或疲劳不延伸成额外工作", "按现实尽快休息，不用个人事务补偿白天失去的自由时间"], "mint"),
                ],
            },
            {
                id: "saturday",
                label: "周六",
                subtitle: "轻量复盘后，进入至少 24 小时完全无工作区间",
                entries: [
                    entry("sat-wake", "06:00", "起床", ["保持固定起床时间；称重后喝水、吃香蕉"]),
                    entry("sat-training", "06:30–07:30", "器材训练或休息日", [], "plain", {
                        training: ["只做器材动作，无器材核心回家完成", "乳清＋肌酸 3–5 g"],
                        rest: ["今天休息，不补做训练", "肌酸随早餐或午餐"],
                    }),
                    entry("sat-breakfast", "08:00 左右", "早餐＋日评估早晨段", ["早餐随餐鱼油 1 粒", "完成睡眠、体重与训练记录；总计控制在 3–5 分钟"], "mint"),
                    entry("sat-light-work", "周六上午", "轻量工作 1–2 小时", ["只做回顾、整理、计划和简单任务", "不启动复杂新任务；这段复盘计入每周工作时间"], "sand"),
                    entry("sat-review", "复盘时", "完成每周评估", ["筛选本周日期；检查遗漏与录入错误", "回看工作成果、边界执行、睡眠、训练与个人生活", "确定下周最重要的三个结果；最多调整一项执行细节", "另用 10–15 分钟整理项目与事务：活跃项目、下周日期、行动细则与结束状态"], "mint"),
                    entry("sat-shutdown", "轻量工作结束前", "下班收尾仪式｜约 15 分钟", ["记录结果、停点与下一个动作；关闭工作软件", "打开免打扰，防止零散工作扩散到全天"], "rose"),
                    entry("sat-no-work", "周六中午", "完全无工作开始", ["从现在到周日中午，保持至少连续 24 小时无工作；这一区间也不做整理与计划"], "rose"),
                    entry("sat-free", "周六下午", "自由选择", ["兴趣、关系、出行、阅读或彻底休息；不设硬性产出要求"], "mint"),
                    entry("sat-dinner", "18:00 前后", "晚饭", ["随餐鱼油 1 粒；让注意力真正回到生活"]),
                    entry("sat-personal", "晚饭后", "一个项目或休息", ["最多一个 60–90 分钟兴趣时段；精力不足就阅读或休息"]),
                    entry("sat-casein", "20:00", "酪蛋白｜按需", ["仅在蛋白质不足或晚上容易饥饿时饮用"]),
                    entry("sat-prepare", "20:15–21:00", "准备明天", ["整理书包；训练用品、蛋白粉和肌酸提前装好", "净水器加满水、蒸锅换水、早餐入锅", "洗净所有脏杯子和碗"], "sand"),
                    entry("sat-evening", "21:00", "日评估晚间段＋睡前准备", ["补齐当日记录；正文写成果、阻碍和明天第一个动作", "不看手机、不接触工作；洗漱并降低刺激"], "rose"),
                    entry("sat-sleep", "22:00", "熄灯", ["优先保证睡眠；久睡不着时离床读平静纸书"], "mint"),
                    entry("sat-monthly", "月末适用", "月度评估提醒", ["从当月每日记录直接计算；不对周平均再次平均", "补充低频身体与训练指标；按“基线–上月–本月–趋势–是否调整”复盘", "每月只改变 1–3 个关键变量"], "sand"),
                ],
            },
            {
                id: "sunday",
                label: "周日",
                subtitle: "上午不工作；12:00 开始、17:00 准时结束",
                entries: [
                    entry("sun-wake", "06:00", "起床", ["保持固定起床时间；称重后喝水、吃香蕉"]),
                    entry("sun-training", "06:30–07:30", "器材训练或休息日", ["在周六或周日灵活安排 1 个休息日"], "plain", {
                        training: ["只做器材动作，无器材核心回家完成"],
                        rest: ["今天休息，不临时加量或补做训练"],
                    }),
                    entry("sun-breakfast", "08:00 左右", "早餐＋日评估早晨段", ["早餐随餐鱼油 1 粒", "完成睡眠、体重、训练与当天计划"], "mint"),
                    entry("sun-no-work", "上午–12:00", "继续完全无工作", ["不处理邮件、Slack、科研笔记或“顺手回复”", "把连续 24 小时的无工作区间守到中午"], "rose"),
                    entry("sun-start", "12:00 左右", "到办公室，开始工作", ["确定今天最重要的结果与第一个动作", "明确 17:00 结束；午饭离开桌面并随餐鱼油 1 粒"], "mint"),
                    entry("sun-work", "12:00–16:45", "先低沉浸，后高认知", ["先处理低沉浸任务；完成合适的一项或一组后再进入高认知主任务", "高认知任务开始前写停点；约每 90 分钟离屏，16:45 提醒响起立即收尾"]),
                    entry("sun-shutdown", "16:45", "下班收尾仪式｜属于工作时间", ["记录结果、停点与下一步；若需晚间整理，只写下入口", "17:00 前完成仪式；关闭软件，邮件与 Slack 免打扰"], "rose"),
                    entry("sun-off", "17:00", "完成仪式，正式下班", ["记录实际下班时间；普通执行与外部沟通留到下一工作时段"], "rose"),
                    entry("sun-private", "正式下班以后", "私人时间＋按需闭环", ["先通勤、放松并与对象交流；不保持邮件与 Slack 待命", "如有需要，只做一次 10–20 分钟、最长 30 分钟的低压力整理与计划", "只记录问题，不解决问题；只确定第一步，不开始第一步"], "mint"),
                    entry("sun-dinner", "18:00 前后", "晚饭", ["随餐鱼油 1 粒"]),
                    entry("sun-personal", "晚饭后", "一个兴趣项目或休息", ["查看“本周”中今天的安排；只做一个 60–90 分钟工作项", "不通过推迟睡觉补偿个人项目进度"]),
                    entry("sun-casein", "20:00", "酪蛋白｜按需", ["仅在蛋白质不足或晚上容易饥饿时饮用"]),
                    entry("sun-prepare", "20:15–21:00", "准备周一", ["整理书包；训练用品、蛋白粉和肌酸提前装好，确保早晨拎起就走", "净水器加满水；蒸锅换水并放入早餐", "洗净所有脏杯子和碗"], "sand"),
                    entry("sun-evening", "21:00", "日评估晚间段＋睡前准备", ["完成生活节律晚间段，补齐当天记录", "正文写成果、阻碍和明天第一步", "停止包括整理与计划在内的全部工作；不看手机，洗漱并降低刺激"], "rose"),
                    entry("sun-sleep", "22:00", "熄灯", ["优先保证睡眠；久睡不着时离床读平静纸书", "不读科研笔记，也不读自己写的小说"], "mint"),
                    entry("sun-boundary-check", "边界自检", "遇到反复问题时", ["连续 3 天晨间困倦：提前睡前准备或减少晚间安排", "若经常晚于计划下班：检查任务分配、截止时间和 15 分钟收尾预留", "整理与计划频繁超过 30 分钟或转成执行：缩小范围，只保留记录入口", "训练表现持续下降：先调训练量、总热量和睡眠"], "sand"),
                ],
            },
        ],
    };
}

export function parseChecklistStore(value: unknown): ChecklistStore | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<ChecklistStore>;
    if (source.version !== CHECKLIST_STORE_VERSION || !Array.isArray(source.templates)) return null;
    const defaults = createDefaultChecklistStore();
    const templates = defaults.templates.map((fallback) => normalizeTemplate(source.templates?.find((candidate) => isObject(candidate) && candidate.id === fallback.id), fallback));
    const dayStates = normalizeDayStates(source.dayStates);
    const updatedAt = finiteNumber(source.updatedAt) ?? Date.now();
    return {
        version: CHECKLIST_STORE_VERSION,
        revision: Math.max(0, Math.trunc(finiteNumber(source.revision) ?? 0)),
        updatedAt,
        viewMode: source.viewMode === "paper" ? "paper" : "xingzhou",
        templates,
        dayStates,
    };
}

export function updateChecklistStore(store: ChecklistStore, changes: Partial<Pick<ChecklistStore, "viewMode" | "templates" | "dayStates">>, now = Date.now()): ChecklistStore {
    const parsed = parseChecklistStore({ ...store, ...changes, revision: store.revision + 1, updatedAt: now });
    if (!parsed) throw new Error("Checklist 配置包含无法识别的数据。");
    return parsed;
}

export function cloneChecklistStore(store: ChecklistStore): ChecklistStore {
    return {
        ...store,
        templates: store.templates.map((template) => ({ ...template, entries: template.entries.map(cloneEntry) })),
        dayStates: store.dayStates.map((state) => ({ ...state, checkedKeys: [...state.checkedKeys], reminderStates: { ...state.reminderStates } })),
    };
}

export function updateChecklistDayState(
    store: ChecklistStore,
    date: string,
    reminderStates: ReadonlyMap<string, ChecklistReminderState>,
    trainingMode: ChecklistTrainingMode,
    now = Date.now(),
): ChecklistStore {
    const normalizedStates = normalizeReminderStates(Object.fromEntries(reminderStates));
    const checkedKeys = Object.keys(normalizedStates).filter((key) => normalizedStates[key] === "completed").sort();
    const otherStates = store.dayStates.filter((state) => state.date !== date);
    const dayStates = Object.keys(normalizedStates).length || trainingMode
        ? [...otherStates, { date, checkedKeys, reminderStates: normalizedStates, trainingMode, updatedAt: now }].sort((a, b) => a.date.localeCompare(b.date))
        : otherStates;
    return updateChecklistStore(store, { dayStates }, now);
}

export function checklistStoresMatch(expected: ChecklistStore, actual: ChecklistStore): boolean {
    const normalizedExpected = parseChecklistStore(expected);
    const normalizedActual = parseChecklistStore(actual);
    return normalizedExpected !== null
        && normalizedActual !== null
        && JSON.stringify(normalizedExpected) === JSON.stringify(normalizedActual);
}

export function checklistBackupFileForRevision(revision: number): string {
    return `checklist.backup-${Math.abs(revision - 1) % 3 + 1}.json`;
}

function normalizeTemplate(value: unknown, fallback: ChecklistTemplate): ChecklistTemplate {
    if (!isObject(value)) return cloneTemplate(fallback);
    const entries = Array.isArray(value.entries)
        ? value.entries.map((entryValue) => normalizeEntry(entryValue, fallback.entries.find((candidate) => isObject(entryValue) && candidate.id === entryValue.id))).filter((candidate): candidate is ChecklistEntry => candidate !== null)
        : [];
    return {
        id: fallback.id,
        label: cleanString(value.label) || fallback.label,
        subtitle: cleanString(value.subtitle) || fallback.subtitle,
        entries: entries.length ? entries : cloneTemplate(fallback).entries,
    };
}

function normalizeDayStates(value: unknown): ChecklistDayState[] {
    if (!Array.isArray(value)) return [];
    const byDate = new Map<string, ChecklistDayState>();
    for (const candidate of value) {
        if (!isObject(candidate)) continue;
        const date = cleanString(candidate.date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const legacyCheckedKeys = Array.isArray(candidate.checkedKeys)
            ? [...new Set(candidate.checkedKeys.map(cleanString).filter(Boolean))].sort()
            : [];
        const reminderStates = normalizeReminderStates(candidate.reminderStates);
        for (const key of legacyCheckedKeys) reminderStates[key] ??= "completed";
        const checkedKeys = Object.keys(reminderStates).filter((key) => reminderStates[key] === "completed").sort();
        const trainingMode: ChecklistTrainingMode = candidate.trainingMode === "training" || candidate.trainingMode === "rest" ? candidate.trainingMode : "";
        if (!Object.keys(reminderStates).length && !trainingMode) continue;
        byDate.set(date, { date, checkedKeys, reminderStates, trainingMode, updatedAt: finiteNumber(candidate.updatedAt) ?? 0 });
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeEntry(value: unknown, fallback?: ChecklistEntry): ChecklistEntry | null {
    if (!isObject(value)) return null;
    const id = cleanString(value.id);
    const title = cleanString(value.title);
    const time = cleanString(value.time);
    const sourceReminders = Array.isArray(value.reminders) ? value.reminders.map(cleanString).filter(Boolean) : [];
    const sourceTrainingChoices = normalizeTrainingChoices(value.trainingChoices);
    const trainingChoices = sourceTrainingChoices ?? (fallback?.trainingChoices ? cloneTrainingChoices(fallback.trainingChoices) : undefined);
    const reminders = !sourceTrainingChoices && fallback?.trainingChoices ? [...fallback.reminders] : sourceReminders;
    if (!id || !title || !time || (!reminders.length && !trainingChoices)) return null;
    const tone: ChecklistTone = value.tone === "mint" || value.tone === "sand" || value.tone === "rose" ? value.tone : "plain";
    return { id, title, time, reminders, tone, ...(trainingChoices ? { trainingChoices } : {}) };
}

function cloneTemplate(template: ChecklistTemplate): ChecklistTemplate {
    return { ...template, entries: template.entries.map(cloneEntry) };
}

function cloneEntry(item: ChecklistEntry): ChecklistEntry {
    return {
        ...item,
        reminders: [...item.reminders],
        ...(item.trainingChoices ? { trainingChoices: cloneTrainingChoices(item.trainingChoices) } : {}),
    };
}

function cloneTrainingChoices(value: NonNullable<ChecklistEntry["trainingChoices"]>): NonNullable<ChecklistEntry["trainingChoices"]> {
    return { training: [...value.training], rest: [...value.rest] };
}

function normalizeTrainingChoices(value: unknown): ChecklistEntry["trainingChoices"] | undefined {
    if (!isObject(value)) return undefined;
    const training = Array.isArray(value.training) ? value.training.map(cleanString).filter(Boolean) : [];
    const rest = Array.isArray(value.rest) ? value.rest.map(cleanString).filter(Boolean) : [];
    return training.length && rest.length ? { training, rest } : undefined;
}

function normalizeReminderStates(value: unknown): Record<string, ChecklistReminderState> {
    if (!isObject(value)) return {};
    const states: Record<string, ChecklistReminderState> = {};
    for (const [rawKey, rawState] of Object.entries(value)) {
        const key = cleanString(rawKey);
        if (key && (rawState === "completed" || rawState === "partial" || rawState === "missed")) states[key] = rawState;
    }
    return Object.fromEntries(Object.entries(states).sort(([left], [right]) => left.localeCompare(right)));
}

function cleanString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object";
}
