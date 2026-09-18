import * as siyuan from "siyuan";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import XingzhouPlugin from "../src/index";
import { SiYuanApiError, requestSiYuan } from "../src/siyuan-api";
import { log } from "../src/log";
import type { InternalWorkItemStore } from "../src/internal-store";

/**
 * 让思源 API 替身返回指定响应。
 * 用 spyOn 而不是 vi.mock：vi.mock 的工厂会被提升，同一文件里的其它测试拿不到它的引用。
 */
function stubFetchSyncPost(handler: (endpoint: string) => Promise<{ code: number; msg: string; data: unknown }>): void {
    const module = siyuan as unknown as { fetchSyncPost: (endpoint: string, payload: unknown) => Promise<unknown> };
    vi.spyOn(module, "fetchSyncPost").mockImplementation(((endpoint: string) => handler(endpoint)) as never);
}

describe("日志：思源 API 与全局异常", () => {
    beforeEach(() => {
        log.reset();
        log.configure({ minLevel: "verbose" });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        log.reset();
    });

    it("接口成功时记录接口名与耗时", async () => {
        stubFetchSyncPost(async () => ({ code: 0, msg: "", data: { rows: 2 } }));

        await expect(requestSiYuan("/api/query/sql", { stmt: "select 1" })).resolves.toEqual({ rows: 2 });

        const ok = log.entries().find((entry) => entry.event === "request.ok");
        expect(ok?.scope).toBe("siyuan-api");
        expect(ok?.level).toBe("verbose");
        expect(ok?.detail).toMatchObject({ endpoint: "/api/query/sql" });
        expect(ok?.detail?.ms).toBeTypeOf("number");
    });

    it("接口返回非 0 时记录失败原因与错误码，并抛出可读异常", async () => {
        stubFetchSyncPost(async () => ({ code: -1, msg: "数据库不存在", data: null }));

        await expect(requestSiYuan("/api/av/getAttributeView", { id: "av-1" })).rejects.toBeInstanceOf(SiYuanApiError);

        const failure = log.entries().find((entry) => entry.event === "request.fail");
        expect(failure?.level).toBe("warn");
        expect(failure?.detail).toMatchObject({ endpoint: "/api/av/getAttributeView", code: -1, err: "数据库不存在" });
        expect(failure?.detail?.ms).toBeTypeOf("number");
    });

    it("网络异常同样留痕，且不会重复记录两条失败", async () => {
        stubFetchSyncPost(async () => {
            throw new Error("Failed to fetch");
        });

        await expect(requestSiYuan("/api/asset/upload", {})).rejects.toThrow("Failed to fetch");

        const failures = log.entries().filter((entry) => entry.event === "request.fail");
        expect(failures).toHaveLength(1);
        expect(JSON.stringify(failures[0].detail?.err)).toContain("Failed to fetch");
    });

    it("接口成功条目在默认级别下不写入缓冲，但仍计入丢弃数", async () => {
        log.configure({ minLevel: "warn" });
        stubFetchSyncPost(async () => ({ code: 0, msg: "", data: null }));

        await requestSiYuan("/api/system/version", {});

        expect(log.entries()).toHaveLength(0);
        expect(log.stats().dropped).toBe(1);
        expect(log.exportText()).toContain("因级别丢弃 1 条");
    });

    it("未捕获异常与未处理的 Promise 拒绝都进入日志并抬高未读数", () => {
        const storage = {
            files: new Map<string, unknown>([
                ["work-items.json", { version: 2, revision: 1, createdAt: 1, updatedAt: 1, items: [] } satisfies InternalWorkItemStore],
            ]),
            writes: [] as string[],
        };
        const plugin = new XingzhouPlugin({} as never);
        Object.assign(plugin, {
            loadData: async (file: string) => storage.files.get(file),
            saveData: async (file: string, value: unknown) => {
                storage.writes.push(file);
                storage.files.set(file, value);
                return { code: 0, msg: "", data: null };
            },
        });
        (plugin as unknown as { settingsReady: Promise<void> }).settingsReady = Promise.resolve();

        // 注册行为用替身观察；处理逻辑直接调用内部报告函数，避免 jsdom 把合成 ErrorEvent 再抛一次
        const addListener = vi.spyOn(window, "addEventListener");
        plugin.onload();
        expect(addListener.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(["error", "unhandledrejection"]));
        addListener.mockRestore();

        const reporter = plugin as unknown as {
            reportWindowError: (event: unknown) => void;
            reportUnhandledRejection: (event: unknown) => void;
        };
        const failure = { name: "TypeError", message: "Cannot read properties of null (reading 'value')", stack: "TypeError: boom\n    at frame" };
        reporter.reportWindowError({ message: "Uncaught TypeError: Cannot read properties of null", filename: "plugin.js", lineno: 42, colno: 7, error: failure });
        reporter.reportUnhandledRejection({ reason: new Error("保存后复核失败") });

        const onError = log.entries().find((entry) => entry.event === "window.onerror");
        expect(onError?.level).toBe("error");
        expect(onError?.scope).toBe("lifecycle");
        expect(onError?.detail).toMatchObject({ message: "Uncaught TypeError: Cannot read properties of null", source: "plugin.js", line: 42, column: 7 });
        expect(JSON.stringify(onError?.detail?.err)).toContain("Cannot read properties of null");

        const onRejection = log.entries().find((entry) => entry.event === "window.unhandledrejection");
        expect(onRejection?.level).toBe("error");
        expect(JSON.stringify(onRejection?.detail?.err)).toContain("保存后复核失败");

        expect(log.stats().unread).toBe(2);
        expect(log.entries().map((entry) => entry.event)).toContain("plugin.load");

        // 卸载后不再挂监听，也不能让缓冲留到下一次加载
        const removeListener = vi.spyOn(window, "removeEventListener");
        plugin.onunload();
        expect(removeListener.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(["error", "unhandledrejection"]));
        removeListener.mockRestore();
        expect(log.entries()).toHaveLength(0);
    });
});
