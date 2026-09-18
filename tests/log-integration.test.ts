import { afterEach, beforeEach, describe, expect, it } from "vitest";
import XingzhouPlugin from "../src/index";
import { INTERNAL_STORE_FILE, type InternalWorkItemStore } from "../src/internal-store";
import { log } from "../src/log";
import type { WorkItem, WorkItemData } from "../src/work-items";

type SaveResponse = { code: number; msg: string; data: null };

/** 插件数据文件的替身：模拟思源 loadData/saveData 的对象读写语义。 */
class FakeStorage {
    readonly files = new Map<string, unknown>();
    readonly writes: Array<{ file: string; value: unknown }> = [];
    /** 命中这些文件名时写入返回非 0（模拟思源拒绝保存）。 */
    readonly failingWrites = new Set<string>();
    /** 命中这些文件名时读取返回不可识别内容（模拟文件损坏）。 */
    readonly corruptedFiles = new Set<string>();
    /** 命中这些文件名时读取直接失败（模拟读取异常）。 */
    readonly unreadableFiles = new Set<string>();

    async loadData(file: string): Promise<unknown> {
        if (this.unreadableFiles.has(file)) throw new Error(`${file} 读取失败`);
        if (this.corruptedFiles.has(file)) return { version: 99, items: "不是数组" };
        return this.files.get(file);
    }

    async saveData(file: string, value: unknown): Promise<SaveResponse> {
        this.writes.push({ file, value });
        if (this.failingWrites.has(file)) return { code: 1, msg: `${file} 写入被拒绝`, data: null };
        if (value !== undefined && value !== null) {
            this.files.set(file, value);
            // 写成功即视为修复：损坏标记只影响写入之前的状态
            this.corruptedFiles.delete(file);
            this.unreadableFiles.delete(file);
        }
        return { code: 0, msg: "", data: null };
    }

    filesWritten(): string[] {
        return this.writes.map((entry) => entry.file);
    }
}

type PluginInternals = {
    settingsReady: Promise<void>;
    settings: { attributeViewId: string; databaseBlockId: string; log: unknown };
    loadWorkItemData: () => Promise<WorkItemData>;
    saveWorkItemData: (data: WorkItemData, item: WorkItem, changes: Record<string, unknown>) => Promise<WorkItemData>;
    deleteWorkItemData: (data: WorkItemData, item: WorkItem) => Promise<WorkItemData>;
};

function createPlugin(storage: FakeStorage): { plugin: XingzhouPlugin; internals: PluginInternals } {
    const plugin = new XingzhouPlugin({} as never);
    const internals = plugin as unknown as PluginInternals;
    Object.assign(plugin, {
        loadData: (file: string) => storage.loadData(file),
        saveData: (file: string, value: unknown) => storage.saveData(file, value),
    });
    internals.settingsReady = Promise.resolve();
    return { plugin, internals };
}

function validStore(revision: number, items: WorkItem[] = []): InternalWorkItemStore {
    return { version: 2, revision, createdAt: 1000, updatedAt: 1000 + revision, items };
}

function notes(...events: string[]): string[] {
    return log.entries().map((entry) => entry.event).filter((event) => events.includes(event));
}

describe("日志：关键路径自动埋点", () => {
    let storage: FakeStorage;

    beforeEach(() => {
        log.reset();
        log.configure({ minLevel: "verbose" });
        storage = new FakeStorage();
    });

    afterEach(() => {
        log.reset();
    });

    it("保存成功时留下完整时间线：写备份 → 轮换 → 写主文件 → 复核通过", async () => {
        storage.files.set(INTERNAL_STORE_FILE, validStore(1, [fakeItem()]));
        const { internals } = createPlugin(storage);

        const data = await internals.loadWorkItemData();
        expect(data.items).toHaveLength(1);
        await internals.saveWorkItemData(data, data.items[0], { status: "进行中" });

        const events = log.entries().filter((entry) => entry.scope === "store").map((entry) => entry.event);
        expect(events).toContain("store.queue.enqueue");
        expect(events).toContain("store.revision.bump");
        expect(events).toContain("store.backup.rotate");
        expect(events).toContain("store.write.start");
        expect(events).toContain("store.write.ok");
        expect(events).toContain("store.verify.pass");
        expect(events).toContain("store.queue.done");

        // 顺序：轮换 → 写 → 复核，且备份先于主文件
        const timeline = log.entries().filter((entry) => entry.scope === "store");
        const indexOf = (event: string, file?: string) => timeline.findIndex((entry) =>
            entry.event === event && (!file || entry.detail?.file === file));
        const rotate = indexOf("store.backup.rotate");
        const backupWrite = indexOf("store.write.ok", "work-items.backup-1.json");
        const primaryWrite = indexOf("store.write.ok", INTERNAL_STORE_FILE);
        const verify = indexOf("store.verify.pass", INTERNAL_STORE_FILE);
        expect(rotate).toBeGreaterThan(-1);
        expect(rotate).toBeLessThan(backupWrite);
        expect(backupWrite).toBeLessThan(primaryWrite);
        expect(primaryWrite).toBeLessThan(verify);

        const bump = log.entries().find((entry) => entry.event === "store.revision.bump");
        expect(bump?.detail).toMatchObject({ action: "update", from: 1, to: 2, fields: ["status"] });
        expect(bump?.detail).not.toHaveProperty("title");
        const saved = storage.files.get(INTERNAL_STORE_FILE) as InternalWorkItemStore;
        expect(saved.revision).toBe(2);
    });

    it("写主文件被思源拒绝时记录失败原因，并且不再声称复核通过", async () => {
        storage.files.set(INTERNAL_STORE_FILE, validStore(4, [fakeItem()]));
        storage.failingWrites.add(INTERNAL_STORE_FILE);
        const { internals } = createPlugin(storage);
        const data = await internals.loadWorkItemData();

        await expect(internals.saveWorkItemData(data, data.items[0], { status: "已完成" })).rejects.toThrow();

        const failure = log.entries().find((entry) => entry.event === "store.write.fail");
        expect(failure?.level).toBe("error");
        expect(failure?.detail).toMatchObject({ file: INTERNAL_STORE_FILE, role: "primary", revision: 5, code: 1 });
        expect(String(failure?.detail?.err)).toContain("写入被拒绝");
        expect(notes("store.verify.pass")).toHaveLength(1); // 只有备份那一次复核通过
    });

    it("主文件损坏时选择修订号最高的有效备份恢复，并记录恢复过程", async () => {
        storage.corruptedFiles.add(INTERNAL_STORE_FILE);
        storage.files.set("work-items.backup-1.json", validStore(2));
        storage.files.set("work-items.backup-2.json", validStore(9));
        storage.unreadableFiles.add("work-items.backup-3.json");
        const { internals } = createPlugin(storage);

        const data = await internals.loadWorkItemData();

        const parseFailed = log.entries().find((entry) => entry.event === "store.parse.failed");
        expect(parseFailed?.level).toBe("warn");
        expect(parseFailed?.detail).toMatchObject({ file: INTERNAL_STORE_FILE, absent: false });
        const recovery = log.entries().find((entry) => entry.event === "store.recover.fromBackup");
        expect(recovery?.level).toBe("warn");
        expect(recovery?.detail).toMatchObject({ file: INTERNAL_STORE_FILE, backup: "work-items.backup-2.json", revision: 9 });
        expect(data.attributeViewId).toBe("xingzhou-internal");
        const restored = storage.files.get(INTERNAL_STORE_FILE) as InternalWorkItemStore;
        expect(restored.revision).toBe(9);
    });

    it("主文件与三个备份都不可用时停止写入：留下 error 日志且一个字节都不写", async () => {
        storage.corruptedFiles.add(INTERNAL_STORE_FILE);
        storage.files.set("work-items.backup-1.json", { 坏: 1 });
        storage.files.set("work-items.backup-2.json", null);
        const { internals } = createPlugin(storage);

        await expect(internals.loadWorkItemData()).rejects.toThrow("已停止写入");

        const stopped = log.entries().find((entry) => entry.event === "store.write.stopped");
        expect(stopped?.level).toBe("error");
        expect(stopped?.detail).toMatchObject({ file: INTERNAL_STORE_FILE, backupsChecked: 3 });
        expect(String(stopped?.detail?.reason)).toContain("停止写入");
        expect(storage.filesWritten()).toEqual([]);
    });

    it("写后复核不一致时给出差异位置，并按 error 记录", async () => {
        storage.files.set(INTERNAL_STORE_FILE, validStore(3, [fakeItem()]));
        const { internals } = createPlugin(storage);
        const data = await internals.loadWorkItemData();

        // 模拟"写进去的内容被别处改过"：读回时返回不同内容
        const originalLoad = storage.loadData.bind(storage);
        storage.loadData = async (file: string) => {
            const value = await originalLoad(file);
            if (file !== INTERNAL_STORE_FILE || !value) return value;
            return { ...(value as InternalWorkItemStore), revision: 999 };
        };

        await expect(internals.saveWorkItemData(data, data.items[0], { title: "标题" })).rejects.toThrow("未通过完整性复核");

        const failure = log.entries().find((entry) => entry.event === "store.verify.fail");
        expect(failure?.level).toBe("error");
        expect(failure?.detail).toMatchObject({ file: INTERNAL_STORE_FILE, role: "primary" });
        expect(String(failure?.detail?.reason)).toContain("不一致");
        expect(String(failure?.detail?.diff)).toContain("写入与读取不一致");
    });

    it("所有日志条目按序号单调递增，可还原因果顺序", async () => {
        storage.files.set(INTERNAL_STORE_FILE, validStore(1, [fakeItem()]));
        const { internals } = createPlugin(storage);
        const data = await internals.loadWorkItemData();
        await internals.saveWorkItemData(data, data.items[0], { status: "进行中" });
        const entries = log.entries();
        expect(entries.length).toBeGreaterThan(5);
        for (let index = 1; index < entries.length; index += 1) {
            expect(entries[index].seq).toBe(entries[index - 1].seq + 1);
            expect(entries[index].time).toBeGreaterThanOrEqual(entries[index - 1].time);
        }
    });

    it("导出日志里不出现笔记正文，只出现长度、字段名与条目 id", async () => {
        const secret = "明天上午把实验结果整理成图表发给导师，并附上三点结论。";
        storage.files.set(INTERNAL_STORE_FILE, validStore(1, [{ ...fakeItem(), title: secret, currentAction: secret }]));
        const { internals } = createPlugin(storage);
        const data = await internals.loadWorkItemData();

        await internals.saveWorkItemData(data, data.items[0], { title: secret, currentAction: secret });

        const text = log.exportText();
        const json = log.exportJson();
        for (const output of [text, json]) {
            expect(output).not.toContain(secret);
            expect(output).not.toContain("实验结果整理成图表");
            expect(output).toContain("item-1");
        }
        const bump = log.entries().find((entry) => entry.event === "store.revision.bump");
        expect(bump?.detail?.itemId).toBe("item-1");
        expect(bump?.detail?.fields).toEqual(["currentAction", "title"]);
    });
});

function fakeItem(): WorkItem {
    return {
        id: "item-1", rowId: "item-1", title: "工作项", documentId: null, detached: true,
        type: "事务", status: "待开始", currentAction: "", nextAction: "", parentIds: [], topProjectIds: [],
        hardPrerequisiteIds: [], softPrerequisiteIds: [], completedDates: [], sliceTargetCount: null,
        executionSlices: [], imageCleanup: null, planDate: null, deadline: null, noDeadline: false,
        durationMinutes: null, energy: "", updatedAt: 1000, sortOrder: 0,
    };
}
