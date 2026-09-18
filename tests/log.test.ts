import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_LOG_BUFFER_SIZE,
    LOG_LEVELS,
    LOG_SCOPES,
    MAX_LOG_BUFFER_SIZE,
    MIN_LOG_BUFFER_SIZE,
    clampLogBufferSize,
    log,
    normalizeLogConfig,
} from "../src/log";

/** 小容量缓冲：覆盖行为用 200 条上限测太慢，这里统一压到下限并只填需要的条数。 */
function useSmallBuffer(size = MIN_LOG_BUFFER_SIZE): void {
    log.configure({ minLevel: "verbose", bufferSize: size, scopes: {} });
}

describe("通用日志 recorder", () => {
    beforeEach(() => {
        log.reset();
    });

    afterEach(() => {
        log.reset();
        vi.restoreAllMocks();
    });

    it("默认只记 warn/error，并且不影响调用方继续记录", () => {
        expect(log.getConfig().minLevel).toBe("warn");
        expect(log.getConfig().bufferSize).toBe(DEFAULT_LOG_BUFFER_SIZE);
        log.verbose("ui", "ui.debug");
        log.info("ui", "ui.info");
        log.warn("ui", "ui.warn");
        log.error("ui", "ui.error");
        expect(log.entries().map((entry) => entry.event)).toEqual(["ui.warn", "ui.error"]);
        expect(log.stats().dropped).toBe(2);
    });

    it("环形缓冲按容量覆盖最旧记录，并保持最旧在前的顺序", () => {
        useSmallBuffer(200);
        for (let index = 0; index < 260; index += 1) log.warn("ui", `event-${index}`);
        const entries = log.entries();
        expect(entries).toHaveLength(200);
        expect(entries[0].event).toBe("event-60");
        expect(entries[199].event).toBe("event-259");
        expect(log.stats().total).toBe(260);
        expect(log.stats().counts.warn).toBe(260);
    });

    it("序号单调递增，清空缓冲后继续递增不复位", () => {
        useSmallBuffer();
        log.warn("ui", "first");
        log.warn("ui", "second");
        const [first, second] = log.entries();
        expect(second.seq).toBe(first.seq + 1);
        log.clear();
        expect(log.entries()).toHaveLength(0);
        log.warn("ui", "third");
        expect(log.entries()[0].seq).toBe(second.seq + 1);
    });

    it("缩小缓冲时保留最新记录，容量被限制在允许区间内", () => {
        useSmallBuffer(400);
        for (let index = 0; index < 400; index += 1) log.warn("store", `e${index}`);
        log.configure({ bufferSize: MIN_LOG_BUFFER_SIZE });
        expect(log.entries()).toHaveLength(MIN_LOG_BUFFER_SIZE);
        expect(log.entries()[MIN_LOG_BUFFER_SIZE - 1].event).toBe("e399");
        expect(log.getConfig().bufferSize).toBe(MIN_LOG_BUFFER_SIZE);
        expect(clampLogBufferSize(1)).toBe(MIN_LOG_BUFFER_SIZE);
        expect(clampLogBufferSize(999999)).toBe(MAX_LOG_BUFFER_SIZE);
        expect(clampLogBufferSize("abc")).toBe(DEFAULT_LOG_BUFFER_SIZE);
    });

    it("全局级别与按 scope 覆盖共同决定是否记录", () => {
        log.configure({ minLevel: "warn", scopes: { store: "verbose", ui: "error" } });
        log.verbose("store", "store.detail");
        log.verbose("ui", "ui.detail");
        log.warn("ui", "ui.warn");
        log.error("ui", "ui.error");
        expect(log.entries().map((entry) => entry.event)).toEqual(["store.detail", "ui.error"]);
        expect(log.isEnabled("store", "verbose")).toBe(true);
        expect(log.isEnabled("ui", "info")).toBe(false);
        expect(log.levelOf("daily")).toBe("warn");
        log.setScopeLevel("ui", null);
        expect(log.levelOf("ui")).toBe("warn");
        log.setMinLevel("verbose");
        expect(log.levelOf("daily")).toBe("verbose");
        expect(log.isEnabled("daily", "verbose")).toBe(true);
    });

    it("非法配置值被忽略，不会破坏记录能力", () => {
        log.configure({ minLevel: "nonsense" as never, scopes: { ui: "nope" as never }, bufferSize: Number.NaN });
        expect(log.getConfig().minLevel).toBe("warn");
        expect(log.getConfig().scopes).toEqual({});
        log.warn("ui", "still-works");
        expect(log.entries()).toHaveLength(1);
        expect(normalizeLogConfig({ minLevel: "verbose", scopes: { ui: "info", "": "warn" }, bufferSize: 12, allowTruncatedText: true }))
            .toEqual({ minLevel: "verbose", scopes: { ui: "info" }, bufferSize: MIN_LOG_BUFFER_SIZE, allowTruncatedText: true });
    });

    it("time() 记录耗时与结果，级别不足时不额外产生条目", () => {
        log.configure({ minLevel: "verbose" });
        const end = log.time("siyuan-api", "request", { endpoint: "/api/query/sql" });
        const elapsed = end({ ok: true, detail: { rows: 3 } });
        expect(typeof elapsed).toBe("number");
        const [entry] = log.entries();
        expect(entry.event).toBe("request.done");
        expect(entry.scope).toBe("siyuan-api");
        expect(entry.detail).toMatchObject({ endpoint: "/api/query/sql", rows: 3, ok: true });
        expect(entry.ms).toBeTypeOf("number");

        log.reset();
        log.configure({ minLevel: "warn" });
        log.time("siyuan-api", "request")({ ok: true });
        expect(log.entries()).toHaveLength(0);
        expect(log.time("siyuan-api", "request")({ ok: false })).toBeTypeOf("number");
        expect(log.entries().map((entry) => entry.event)).toEqual(["request.done"]);
        expect(log.entries()[0].level).toBe("warn");
    });

    it("measure() 未开启级别时直接返回原值，开启后返回耗时与结果", () => {
        log.configure({ minLevel: "warn" });
        const plain = log.measure("siyuan-api", "verbose", () => 42);
        expect(plain).toBe(42);
        expect(log.isMeasurement(plain)).toBe(false);

        log.configure({ minLevel: "verbose" });
        const measured = log.measure("siyuan-api", "verbose", () => "payload");
        expect(log.isMeasurement(measured)).toBe(true);
        if (!log.isMeasurement(measured)) throw new Error("未返回计时结果");
        expect(measured.result).toBe("payload");
        expect(measured.ms).toBeGreaterThanOrEqual(0);
    });

    it("正文类字段只留长度与类型，不把内容写进日志", () => {
        log.configure({ minLevel: "verbose" });
        const secret = "今天要把未完成的项目收尾，并给合作者写一封长邮件说明进展。";
        log.info("editor", "editor.save", {
            content: secret,
            currentAction: secret,
            title: secret,
            draft: { markdown: secret },
            itemId: "20260101120000-abcdefg",
            length: secret.length,
        });
        const [entry] = log.entries();
        expect(entry.detail?.content).toEqual({ kind: "正文", length: secret.length });
        expect(entry.detail?.currentAction).toEqual({ kind: "正文", length: secret.length });
        expect(JSON.stringify(entry.detail)).not.toContain("合作者");
        expect(JSON.stringify(entry)).not.toContain(secret.slice(0, 8));
        expect(entry.detail?.itemId).toBe("20260101120000-abcdefg");
        expect(entry.detail?.length).toBe(secret.length);

        // 只有显式打开 allowTruncatedText 时，正文类字段才保留截断预览
        log.clear();
        log.setAllowTruncatedText(true);
        log.info("editor", "editor.save", { content: secret });
        expect(JSON.stringify(log.entries()[0].detail)).toContain("今天要把未完成的项目收尾");
        log.setAllowTruncatedText(false);
    });

    it("普通字符串超长时截断，事件名换行被压平", () => {
        log.configure({ minLevel: "verbose" });
        log.warn("store", "store\nverify   failed", { diff: "x".repeat(400), file: "work-items.json" });
        const [entry] = log.entries();
        expect(entry.event).toBe("store verify failed");
        expect(String(entry.detail?.diff)).toContain("（共 400 字符）");
        expect(entry.detail?.file).toBe("work-items.json");
    });

    it("事件名里混进正文关键词时整体隐藏，错误信息保持可读", () => {
        log.configure({ minLevel: "verbose" });
        log.warn("store", "store.正文.dump", { rows: 3 });
        expect(log.entries()[0].event).toBe("[已隐藏含正文的事件名]");
        log.clear();
        log.error("lifecycle", "window.onerror", { message: "Cannot read properties of null", err: "Uncaught TypeError: boom" });
        expect(log.entries()[0].detail?.message).toBe("Cannot read properties of null");
        expect(log.entries()[0].detail?.err).toBe("Uncaught TypeError: boom");
    });

    it("循环引用或异常对象不会让记录抛错", () => {
        log.configure({ minLevel: "verbose" });
        const cyclic: Record<string, unknown> = { name: "loop" };
        cyclic.self = cyclic;
        expect(() => log.warn("ui", "ui.cyclic", { cyclic: cyclic as never, error: new Error("boom") })).not.toThrow();
        const [entry] = log.entries();
        expect(JSON.stringify(entry.detail)).toContain("循环引用");
        expect(JSON.stringify(entry.detail)).toContain("boom");
    });

    it("统计包含未读、级别计数、时间范围与丢弃数", () => {
        log.configure({ minLevel: "warn" });
        log.info("ui", "ui.info");
        log.warn("ui", "ui.warn.a");
        log.error("ui", "ui.warn.b");
        const stats = log.stats();
        expect(stats.size).toBe(2);
        expect(stats.total).toBe(2);
        expect(stats.dropped).toBe(1);
        expect(stats.unread).toBe(2);
        expect(stats.counts).toMatchObject({ warn: 1, error: 1, info: 0, verbose: 0 });
        expect(stats.firstTime).toBeTypeOf("number");
        expect(stats.lastTime).toBeTypeOf("number");
        log.markRead();
        expect(log.stats().unread).toBe(0);
        log.warn("ui", "ui.warn.c");
        expect(log.stats().unread).toBe(1);
    });

    it("订阅者会收到记录、清空与级别变更通知，取消订阅后不再收到", () => {
        useSmallBuffer();
        const listener = vi.fn();
        const unsubscribe = log.subscribe(listener);
        log.warn("ui", "ui.warn");
        expect(listener).toHaveBeenCalledTimes(1);
        log.markRead();
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
        log.warn("ui", "ui.warn.again");
        expect(listener).toHaveBeenCalledTimes(2);
        const throwing = log.subscribe(() => {
            throw new Error("订阅者自身异常");
        });
        expect(() => log.warn("ui", "ui.warn.safe")).not.toThrow();
        throwing();
    });

    it("文本导出包含头部元信息与逐条时间线", () => {
        useSmallBuffer();
        const secret = "这是一段不应该出现在日志里的行动细则正文。";
        log.warn("store", "store.verify.fail", { file: "work-items.json", revision: 7, currentAction: secret });
        log.error("lifecycle", "window.onerror", { message: "boom" });
        const text = log.exportText({ kernelVersion: "3.8.4" });
        expect(text).toContain("# 行舟日志");
        expect(text).toContain("# 思源内核版本：3.8.4");
        expect(text).toContain("因级别丢弃 0 条");
        expect(text).toContain("WARN    store store.verify.fail");
        expect(text).toContain('"revision":7');
        expect(text).toContain("ERROR   lifecycle window.onerror");
        expect(text).not.toContain("不应该出现");
        expect(text.split("\n").filter((line) => line.startsWith("#")).length).toBeGreaterThanOrEqual(6);
    });

    it("JSON 导出结构稳定，且 meta 记录生效级别与丢弃数", () => {
        useSmallBuffer();
        log.configure({ scopes: { store: "verbose" }, minLevel: "info" });
        log.verbose("ui", "ui.hidden");
        log.verbose("store", "store.visible", { revision: 3 });
        const payload = JSON.parse(log.exportJson({ kernelVersion: "3.8.4", note: "手动导出" })) as {
            meta: Record<string, unknown>;
            entries: Array<Record<string, unknown>>;
        };
        expect(payload.meta).toMatchObject({
            kind: "xingzhou-log",
            exportVersion: 1,
            kernelVersion: "3.8.4",
            note: "手动导出",
            minLevel: "info",
            scopes: { store: "verbose" },
            entries: 1,
            droppedByLevel: 1,
        });
        expect(payload.entries).toHaveLength(1);
        expect(payload.entries[0]).toMatchObject({ level: "verbose", scope: "store", event: "store.visible", detail: { revision: 3 } });
        expect(JSON.parse(log.exportJson()).entries).toHaveLength(1);
    });

    it("级别与 scope 清单覆盖任务要求的来源", () => {
        expect(LOG_LEVELS).toEqual(["verbose", "info", "warn", "error"]);
        const ids = LOG_SCOPES.map((scope) => scope.id);
        for (const scope of ["lifecycle", "store", "siyuan-api", "daily", "checklist", "nutrition", "editor", "asset", "ui", "settings"]) {
            expect(ids).toContain(scope);
        }
        expect(new Set(ids).size).toBe(ids.length);
    });
});
