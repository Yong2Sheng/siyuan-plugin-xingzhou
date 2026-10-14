import {
    describe,
    expect,
    it,
} from "vitest";
import {
    DEFAULT_SPRINT_ANCHORS,
    LANDING_RUNGS,
    PHASE_STORE_VERSION,
    activeLanding,
    activeSprint,
    advanceLanding,
    confirmSprintDay,
    createEmptyPhaseStore,
    currentRung,
    dateDiffInDays,
    endLanding,
    endSprint,
    extendSprint,
    isLandingStuck,
    isRungActedToday,
    isSprintConfirmed,
    isSprintDay,
    landedSummary,
    landingFieldGroups,
    landingOffersGroup,
    landingUnlocksFullForm,
    mergePhaseStores,
    parsePhaseStore,
    phaseBackupFileForRevision,
    phaseStoresMatch,
    rungNumberForDate,
    sprintDayCount,
    sprintDayIndex,
    sprintForDate,
    sprintPlannedDays,
    startSprint,
} from "../src/phases";

const NOW = new Date("2025-03-10T09:00:00").getTime();

function sprintStore(startDate = "2025-03-10", endDate = "2025-03-19", now = NOW) {
    return startSprint(createEmptyPhaseStore(now), { title: "proposal 起草", startDate, endDate }, now);
}

describe("阶段数据（紧急期 / 归航期）", () => {
    it("进入紧急期：记录原定结束日、延长次数为 0，锚点默认四条且熄灯必选", () => {
        const store = sprintStore();
        const phase = store.sprints[0];
        expect(phase.startDate).toBe("2025-03-10");
        expect(phase.endDate).toBe("2025-03-19");
        expect(phase.originalEndDate).toBe("2025-03-19");
        expect(phase.extensionCount).toBe(0);
        expect(phase.anchors.map((anchor) => anchor.id)).toEqual(DEFAULT_SPRINT_ANCHORS.map((anchor) => anchor.id));
        expect(phase.days).toEqual([]);
        expect(store.revision).toBe(2);
    });

    it("结束日不能早于开始日，区间长度有上限", () => {
        expect(() => startSprint(createEmptyPhaseStore(NOW), { startDate: "2025-03-19", endDate: "2025-03-10" }, NOW))
            .toThrow(/结束日不能早于开始日/);
        // 上限是"区间长度"，不是"日期先后"：1827 天（2025-01-01 → 2030-01-01）仍然允许
        expect(startSprint(createEmptyPhaseStore(NOW), { startDate: "2025-01-01", endDate: "2030-01-01" }, NOW).sprints).toHaveLength(1);
        expect(() => startSprint(createEmptyPhaseStore(NOW), { startDate: "2025-01-01", endDate: "2040-01-01" }, NOW))
            .toThrow(/区间过长/);
        expect(() => startSprint(createEmptyPhaseStore(NOW), { startDate: "2025-03-19", endDate: "not-a-date" }, NOW))
            .toThrow(/格式无效/);
    });

    it("延长只改结束日与次数：目标、开始日、原定结束日一律不动", () => {
        const store = sprintStore();
        const extended = extendSprint(store, store.sprints[0].id, "2025-03-26", NOW + 1000);
        const phase = extended.sprints[0];
        expect(phase.endDate).toBe("2025-03-26");
        expect(phase.extensionCount).toBe(1);
        expect(phase.title).toBe("proposal 起草");
        expect(phase.startDate).toBe("2025-03-10");
        expect(phase.originalEndDate).toBe("2025-03-19");
        expect(sprintPlannedDays(phase)).toBe(10);
        expect(sprintDayCount(phase)).toBe(17);
    });

    it("延长不接受更早或相同的结束日，已结束的紧急期不能再延长", () => {
        const store = sprintStore();
        const id = store.sprints[0].id;
        expect(() => extendSprint(store, id, "2025-03-19", NOW)).toThrow(/必须晚于当前结束日/);
        expect(() => extendSprint(store, id, "2025-03-01", NOW)).toThrow(/必须晚于当前结束日/);
        const ended = endSprint(store, id, { startLanding: false }, NOW);
        expect(() => extendSprint(ended, id, "2025-04-01", NOW)).toThrow(/已经结束/);
    });

    it("今天仍在紧急期：一天一条，重复确认不产生新记录，也不改修订号", () => {
        const store = sprintStore();
        const id = store.sprints[0].id;
        const once = confirmSprintDay(store, id, "2025-03-11", NOW);
        expect(isSprintConfirmed(once.sprints[0], "2025-03-11")).toBe(true);
        expect(once.revision).toBe(store.revision + 1);
        const twice = confirmSprintDay(once, id, "2025-03-11", NOW + 5000);
        expect(twice).toBe(once);
        expect(twice.sprints[0].days).toHaveLength(1);
    });

    it("确认只允许落在区间内的日期", () => {
        const store = sprintStore();
        expect(() => confirmSprintDay(store, store.sprints[0].id, "2025-03-20", NOW)).toThrow(/不在紧急期区间内/);
    });

    it("查询：区间内任意一天算紧急期，结束日与开始日都包含在内", () => {
        const store = sprintStore();
        expect(isSprintDay(store, "2025-03-09")).toBe(false);
        expect(isSprintDay(store, "2025-03-10")).toBe(true);
        expect(isSprintDay(store, "2025-03-19")).toBe(true);
        expect(isSprintDay(store, "2025-03-20")).toBe(false);
        expect(activeSprint(store, "2025-03-15")?.id).toBe(store.sprints[0].id);
        expect(activeSprint(store, "2025-03-25")).toBeNull();
    });

    it("第几天按开始日推算，跨月也正确", () => {
        const store = sprintStore("2025-03-28", "2025-04-03");
        const phase = store.sprints[0];
        expect(sprintDayIndex(phase, "2025-03-28")).toBe(1);
        expect(sprintDayIndex(phase, "2025-03-31")).toBe(4);
        expect(sprintDayIndex(phase, "2025-04-01")).toBe(5);
        expect(sprintDayCount(phase)).toBe(7);
        expect(sprintDayIndex(phase, "2025-04-04")).toBe(0);
    });

    it("结束紧急期：写入结束时间与方式，并可同时开启归航", () => {
        const store = sprintStore();
        const id = store.sprints[0].id;
        const ended = endSprint(store, id, { startLanding: true }, NOW + 10_000);
        expect(ended.sprints[0].endedAt).not.toBeNull();
        expect(ended.sprints[0].endedBy).toBe("manual");
        const landing = activeLanding(ended);
        expect(landing).not.toBeNull();
        expect(landing?.sprintId).toBe(id);
        expect(landing?.startDate).toBe("2025-03-20");
        expect(landing?.cursor).toBe(0);
    });

    it("结束却不归航时不会创建归航", () => {
        const store = sprintStore();
        const ended = endSprint(store, store.sprints[0].id, { startLanding: false }, NOW);
        expect(activeLanding(ended)).toBeNull();
    });

    it("归航：做完推进一级，从明天起生效（同一天重复点击不跳级）", () => {
        const store = endSprint(sprintStore(), sprintStore().sprints[0].id, { startLanding: true }, NOW);
        const landing = activeLanding(store);
        expect(landing).not.toBeNull();
        const id = landing?.id ?? "";
        expect(currentRung(landing!)?.index).toBe(0);

        const done = advanceLanding(store, id, "done", "2025-03-20", NOW);
        expect(currentRung(activeLanding(done)!)?.index).toBe(1);
        expect(isRungActedToday(activeLanding(done)!, "2025-03-20")).toBe(true);

        const again = advanceLanding(done, id, "done", "2025-03-20", NOW + 1000);
        expect(again).toBe(done);
        expect(currentRung(activeLanding(again)!)?.index).toBe(1);
    });

    it("归航：今天不方便时这一级留到明天（不推进、也不作废）", () => {
        const store = endSprint(sprintStore(), sprintStore().sprints[0].id, { startLanding: true }, NOW);
        const id = activeLanding(store)?.id ?? "";
        const deferred = advanceLanding(store, id, "deferred", "2025-03-20", NOW);
        expect(currentRung(activeLanding(deferred)!)?.index).toBe(0);
        // 第二天仍然可以做这一级
        const nextDay = advanceLanding(deferred, id, "done", "2025-03-21", NOW + 86_400_000);
        expect(currentRung(activeLanding(nextDay)!)?.index).toBe(1);
    });

    it("归航：这一级不需要时直接进下一级，并把这级记为跳过", () => {
        const store = endSprint(sprintStore(), sprintStore().sprints[0].id, { startLanding: true }, NOW);
        const id = activeLanding(store)?.id ?? "";
        const skipped = advanceLanding(store, id, "skipped", "2025-03-20", NOW);
        expect(currentRung(activeLanding(skipped)!)?.index).toBe(1);
        expect(landedSummary(activeLanding(skipped)!, skipped).skipped).toBe(1);
    });

    it("走完七级自动结束归航，并给出不打分的事实数字", () => {
        const base = sprintStore();
        let store = endSprint(base, base.sprints[0].id, { startLanding: true }, NOW);
        const id = activeLanding(store)?.id ?? "";
        for (let index = 0; index < LANDING_RUNGS.length; index += 1) {
            const date = `2025-03-${String(20 + index).padStart(2, "0")}`;
            store = advanceLanding(store, id, "done", date, NOW + index * 86_400_000);
        }
        const landing = store.landings.find((phase) => phase.id === id)!;
        expect(landing.cursor).toBe(LANDING_RUNGS.length);
        expect(landing.endedAt).not.toBeNull();
        expect(landing.endedBy).toBe("completed");
        expect(currentRung(landing)).toBeNull();
        const summary = landedSummary(landing, store);
        expect(summary.done).toBe(LANDING_RUNGS.length);
        expect(summary.plannedDays).toBe(10);
        expect(summary.actualDays).toBe(10);
    });

    it("卡住判定：停在同一级达到阈值时问一次，动作之后不再问", () => {
        const base = sprintStore();
        const store = endSprint(base, base.sprints[0].id, { startLanding: true }, NOW);
        const id = activeLanding(store)?.id ?? "";
        expect(isLandingStuck(activeLanding(store)!, "2025-03-22")).toBe(false);
        expect(isLandingStuck(activeLanding(store)!, "2025-03-24")).toBe(true);
        const done = advanceLanding(store, id, "done", "2025-03-24", NOW);
        expect(isLandingStuck(activeLanding(done)!, "2025-03-24")).toBe(false);
    });

    it("结束归航保留已记录的级数，可以以后重新开一次", () => {
        const base = sprintStore();
        const started = endSprint(base, base.sprints[0].id, { startLanding: true }, NOW);
        const id = activeLanding(started)?.id ?? "";
        const advanced = advanceLanding(started, id, "done", "2025-03-20", NOW);
        const ended = endLanding(advanced, id, NOW);
        expect(activeLanding(ended)).toBeNull();
        expect(ended.landings[0].cursor).toBe(1);
        expect(ended.landings[0].logs).toHaveLength(1);
    });

    it("解析：缺字段、脏数据都能回落，非法结构返回 null", () => {
        expect(parsePhaseStore(null)).toBeNull();
        expect(parsePhaseStore({ version: 2, sprints: [], landings: [] })).toBeNull();
        expect(parsePhaseStore({ version: 1, sprints: "x", landings: [] })).toBeNull();

        const store = sprintStore();
        const id = store.sprints[0].id;
        const withDay = confirmSprintDay(store, id, "2025-03-12", NOW);
        const parsed = parsePhaseStore(JSON.parse(JSON.stringify(withDay)));
        expect(parsed).not.toBeNull();
        expect(parsed?.sprints[0].id).toBe(id);
        expect(parsed?.sprints[0].days[0].date).toBe("2025-03-12");
        expect(parsed?.sprints[0].anchors.map((anchor) => anchor.id)).toContain("lightsOff");
    });

    it("解析：锚点里没有熄灯时补回熄灯，顺序固定为默认顺序", () => {
        const parsed = parsePhaseStore({
            version: PHASE_STORE_VERSION,
            revision: 3,
            createdAt: NOW,
            updatedAt: NOW,
            sprints: [{
                id: "sprint-1",
                kind: "sprint",
                title: "",
                startDate: "2025-03-10",
                endDate: "2025-03-12",
                anchors: [{ id: "progress", label: "今天推进了什么" }, { id: "不存在", label: "x" }],
                days: [],
                createdAt: NOW,
                updatedAt: NOW,
                endedAt: null,
                endedBy: null,
            }],
            landings: [],
        });
        expect(parsed).not.toBeNull();
        expect(parsed?.sprints[0].anchors.map((anchor) => anchor.id)).toEqual(["lightsOff", "progress"]);
    });

    it("解析：区间外的确认记录与越界的归航光标一律收敛，不产生越界状态", () => {
        const parsed = parsePhaseStore({
            version: PHASE_STORE_VERSION,
            revision: 1,
            createdAt: NOW,
            updatedAt: NOW,
            sprints: [{
                id: "sprint-1",
                kind: "sprint",
                title: "",
                startDate: "2025-03-10",
                endDate: "2025-03-12",
                originalEndDate: "2025-03-12",
                extensionCount: -3,
                anchors: DEFAULT_SPRINT_ANCHORS,
                days: [{ date: "2025-04-01", confirmedAt: NOW }, { date: "2025-03-11", confirmedAt: NOW }],
                createdAt: NOW,
                updatedAt: NOW,
                endedAt: null,
                endedBy: null,
            }],
            landings: [{
                id: "landing-1",
                kind: "landing",
                sprintId: "sprint-1",
                sprintTitle: "",
                startDate: "2025-03-13",
                cursor: 99,
                logs: [{ rungIndex: 42, status: "done", date: "2025-03-13", at: NOW }],
                createdAt: NOW,
                updatedAt: NOW,
                endedAt: null,
                endedBy: null,
            }],
        });
        expect(parsed?.sprints[0].days.map((entry) => entry.date)).toEqual(["2025-03-11"]);
        expect(parsed?.sprints[0].extensionCount).toBe(0);
        expect(parsed?.landings[0].cursor).toBe(LANDING_RUNGS.length);
        expect(parsed?.landings[0].logs).toHaveLength(0);
    });

    it("比较与备份命名：写后复核可用，备份轮换为三段", () => {
        const store = sprintStore();
        expect(phaseStoresMatch(store, parsePhaseStore(JSON.parse(JSON.stringify(store)))!)).toBe(true);
        const different = confirmSprintDay(store, store.sprints[0].id, "2025-03-11", NOW);
        expect(phaseStoresMatch(store, different)).toBe(false);
        expect(phaseBackupFileForRevision(1)).toBe("phases.backup-1.json");
        expect(phaseBackupFileForRevision(2)).toBe("phases.backup-2.json");
        expect(phaseBackupFileForRevision(3)).toBe("phases.backup-3.json");
        expect(phaseBackupFileForRevision(4)).toBe("phases.backup-1.json");
    });

    it("日期差用中午解析，跨夏令时边界也不会少一天", () => {
        expect(dateDiffInDays("2025-03-08", "2025-03-10")).toBe(2);
        expect(dateDiffInDays("2025-11-01", "2025-11-03")).toBe(2);
        expect(dateDiffInDays("2025-12-31", "2026-01-01")).toBe(1);
    });
});

describe("阶段数据的合并保存（防止陈旧快照删掉紧急期）", () => {
    it("陈旧快照整份覆盖时，磁盘上已有的紧急期必须保留", () => {
        const declared = startSprint(createEmptyPhaseStore(NOW), { title: "proposal 起草", startDate: "2025-03-10", endDate: "2025-03-19" }, NOW);
        // 另一个打开的窗口加载到的是空数据，它保存时不该把上面这个紧急期删掉
        const stale = createEmptyPhaseStore(NOW + 1000);
        const merged = mergePhaseStores(declared, stale);
        expect(merged.sprints).toHaveLength(1);
        expect(merged.sprints[0].title).toBe("proposal 起草");
        expect(merged.revision).toBe(Math.max(declared.revision, stale.revision));
    });

    it("同一个阶段以提交过来的版本为准（用户刚改的那份）", () => {
        const declared = startSprint(createEmptyPhaseStore(NOW), { startDate: "2025-03-10", endDate: "2025-03-19" }, NOW);
        const id = declared.sprints[0].id;
        const extended = extendSprint(declared, id, "2025-03-26", NOW + 5000);
        const merged = mergePhaseStores(declared, extended);
        expect(merged.sprints).toHaveLength(1);
        expect(merged.sprints[0].endDate).toBe("2025-03-26");
        expect(merged.sprints[0].extensionCount).toBe(1);
    });

    it("归航阶段的合并同理：一边推进、一边只知道旧光标时，取推进后的那份", () => {
        const base = endSprint(sprintStore(), sprintStore().sprints[0].id, { startLanding: true }, NOW);
        const id = base.landings[0].id;
        const advanced = advanceLanding(base, id, "done", "2025-03-20", NOW + 1000);
        const merged = mergePhaseStores(base, advanced);
        expect(merged.landings).toHaveLength(1);
        expect(merged.landings[0].cursor).toBe(1);
        expect(mergePhaseStores(base, createEmptyPhaseStore(NOW)).landings).toHaveLength(1);
    });
});

describe("已结束的紧急期不再出现在今日界面", () => {
    it("结束之后（无论手动还是到点）activeSprint 一律返回 null，但按日期查询仍能定位到它", () => {
        const started = sprintStore("2025-03-10", "2025-03-19");
        const id = started.sprints[0].id;
        expect(activeSprint(started, "2025-03-12")?.id).toBe(id);

        const ended = endSprint(started, id, { startLanding: false }, NOW + 1000);
        // 界面用 activeSprint：结束后必须为空，否则会继续显示「第 N 天 / 延长到… / 结束紧急期」
        expect(activeSprint(ended, "2025-03-12")).toBeNull();
        expect(activeSprint(ended, "2025-03-19")).toBeNull();
        // 历史列表 / 补记用 sprintForDate：仍然能定位到这次紧急期
        expect(sprintForDate(ended, "2025-03-12")?.id).toBe(id);
        // 到点结束同理
        expect(activeSprint({ ...started, sprints: [{ ...started.sprints[0], endedAt: NOW, endedBy: "deadline" }] }, "2025-03-12")).toBeNull();
    });
});

describe("归航逐级解锁字段", () => {
    it("第 1 级只放交付结果，之后每天加回一组，第 7 级恢复完整表单", () => {
        expect(landingFieldGroups(0)).toEqual(["delivery"]);
        expect(landingOffersGroup(0, "wake")).toBe(false);
        expect(landingOffersGroup(1, "wake")).toBe(true);
        expect(landingOffersGroup(1, "sleep")).toBe(false);
        expect(landingOffersGroup(2, "sleep")).toBe(true);
        expect(landingOffersGroup(3, "workBoundary")).toBe(true);
        expect(landingOffersGroup(3, "afterWork")).toBe(false);
        expect(landingOffersGroup(6, "afterWork")).toBe(true);
        expect(landingUnlocksFullForm(6)).toBe(true);
        expect(landingUnlocksFullForm(5)).toBe(false);
        // 越界一律按最后一档处理，不抛错
        expect(landingFieldGroups(99)).toEqual(landingFieldGroups(6));
    });
});

describe("同一天点完做完了，当天显示的级数不能跳（真实 bug）", () => {
    it("18 号记第 1 级后当天仍显示第 1 级；19 号才显示第 2 级", () => {
        const started = startSprint(createEmptyPhaseStore(1000), { startDate: "2026-10-11", endDate: "2026-10-17" }, 1000);
        let store = endSprint(started, started.sprints[0].id, { startLanding: true, landingStartDate: "2026-10-18" }, 2000);
        const id = store.landings[0].id;

        // 记之前：18 号显示第 1 级
        expect(rungNumberForDate(activeLanding(store)!, "2026-10-18")).toBe(0);
        store = advanceLanding(store, id, "done", "2026-10-18", 3000);
        // 记之后：光标已前进，但**18 号当天**仍必须显示第 1 级
        expect(currentRung(activeLanding(store)!)?.index).toBe(1);
        expect(rungNumberForDate(activeLanding(store)!, "2026-10-18")).toBe(0);
        // 19 号才显示第 2 级
        expect(rungNumberForDate(activeLanding(store)!, "2026-10-19")).toBe(1);

        // 三种动作都符合："不方便"留在第 1 级、"不需要"进第 2 级，但当天显示都不跳
        const deferred = advanceLanding(store, id, "deferred", "2026-10-19", 4000);
        expect(rungNumberForDate(activeLanding(deferred)!, "2026-10-19")).toBe(1);
        expect(rungNumberForDate(activeLanding(deferred)!, "2026-10-20")).toBe(1);
        const skipped = advanceLanding(deferred, id, "skipped", "2026-10-20", 5000);
        expect(rungNumberForDate(activeLanding(skipped)!, "2026-10-20")).toBe(1);
        expect(rungNumberForDate(activeLanding(skipped)!, "2026-10-21")).toBe(2);
    });
});
