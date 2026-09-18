import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppShell from "../src/AppShell.svelte";
import XingzhouPlugin from "../src/index";
import { log } from "../src/log";
import { openLogPanel, type LogPanelHandle } from "../src/log-viewer";
import type { WorkItemData } from "../src/work-items";

const EMPTY_DATA: WorkItemData = {
    attributeViewId: "xingzhou-internal",
    attributeViewName: "行舟内部数据",
    viewId: "all",
    items: [],
    missingFields: [],
    fields: {},
};

function panelOptions(overrides: Partial<Parameters<typeof openLogPanel>[0]> = {}) {
    return {
        config: log.getConfig(),
        onConfigChange: vi.fn(),
        meta: () => ({ kernelVersion: "3.8.4" }),
        ...overrides,
    };
}

describe("日志面板", () => {
    let handle: LogPanelHandle | undefined;

    beforeEach(() => {
        log.reset();
        log.configure({ minLevel: "verbose" });
    });

    afterEach(() => {
        handle?.destroy();
        handle = undefined;
        document.body.replaceChildren();
        vi.restoreAllMocks();
        log.reset();
    });

    it("按时间顺序渲染最近的日志，并显示级别、scope、事件与耗时", () => {
        log.verbose("store", "store.write.ok", { file: "work-items.json", revision: 3 }, 12);
        log.warn("siyuan-api", "request.fail", { endpoint: "/api/query/sql", err: "数据库不存在" });
        log.error("lifecycle", "window.onerror", { message: "boom" });

        handle = openLogPanel(panelOptions());

        const rows = [...document.querySelectorAll(".xz-log-row")];
        expect(rows).toHaveLength(3);
        expect(rows[0].textContent).toContain("store.write.ok");
        expect(rows[0].textContent).toContain("12 ms");
        expect(rows[0].className).toContain("xz-log-row--verbose");
        expect(rows[1].textContent).toContain("request.fail");
        expect(rows[1].textContent).toContain("数据库不存在");
        expect(rows[2].className).toContain("xz-log-row--error");
        expect(document.querySelector(".xz-log-count")?.textContent).toContain("显示 3");
    });

    it("打开面板即清除未读角标", () => {
        log.warn("store", "store.parse.failed");
        expect(log.stats().unread).toBe(1);
        handle = openLogPanel(panelOptions());
        expect(log.stats().unread).toBe(0);
    });

    it("可以按级别、scope 与关键字过滤", () => {
        log.verbose("store", "store.write.ok");
        log.warn("store", "store.verify.fail");
        log.error("siyuan-api", "request.fail");
        handle = openLogPanel(panelOptions());

        const onlyProblems = document.querySelector<HTMLInputElement>(".xz-log-only-problems");
        expect(onlyProblems).not.toBeNull();
        onlyProblems!.checked = true;
        onlyProblems!.dispatchEvent(new Event("change"));
        expect(document.querySelectorAll(".xz-log-row")).toHaveLength(2);

        // 取消"详细"级别后只剩警告与错误
        document.querySelector<HTMLButtonElement>(".xz-log-level--verbose")!.click();
        expect(document.querySelectorAll(".xz-log-row")).toHaveLength(2);

        // 只看 store 来源：只剩 verify.fail
        document.querySelector<HTMLButtonElement>('.xz-log-scope[data-scope="store"]')!.click();
        const remaining = [...document.querySelectorAll(".xz-log-row")];
        expect(remaining).toHaveLength(1);
        expect(remaining[0].textContent).toContain("store.verify.fail");
        expect(document.querySelector(".xz-log-count")?.textContent).toContain("匹配 1");

        // 只保留 store 来源：verify.fail 这一条 warn 仍然可见
        expect(document.querySelectorAll(".xz-log-row")).toHaveLength(1);

        // 关键字只按事件名/scope 匹配
        const search = document.querySelector<HTMLInputElement>(".xz-log-search")!;
        search.value = "request";
        search.dispatchEvent(new Event("input"));
        expect(document.querySelectorAll(".xz-log-row")).toHaveLength(0);
        search.value = "";
        search.dispatchEvent(new Event("input"));
        expect(document.querySelectorAll(".xz-log-row")).toHaveLength(1);
    });

    it("逐 scope 调整级别会立即生效并回调设置写回", () => {
        log.configure({ minLevel: "warn" });
        const onConfigChange = vi.fn();
        handle = openLogPanel(panelOptions({ onConfigChange }));

        const select = document.querySelector<HTMLSelectElement>('.xz-log-scope-setting select[data-scope="store"]');
        expect(select).not.toBeNull();
        select!.value = "verbose";
        select!.dispatchEvent(new Event("change"));

        expect(log.levelOf("store")).toBe("verbose");
        expect(onConfigChange).toHaveBeenCalled();
        const written = onConfigChange.mock.calls[onConfigChange.mock.calls.length - 1][0] as { minLevel: string; scopes: Record<string, string> };
        expect(written.scopes.store).toBe("verbose");
        expect(written.minLevel).toBe("warn");
        log.verbose("store", "store.after.change");
        expect(log.entries().map((entry) => entry.event)).toContain("store.after.change");
    });

    it("自检按钮写入一条可见日志，并真实触发一次未捕获异常", () => {
        // 测试里只观察"面板是否要求自检"，真实抛错与上报由插件侧覆盖
        const onSelfTest = vi.fn();
        handle = openLogPanel(panelOptions({ onSelfTest }));

        document.querySelector<HTMLButtonElement>('[data-action="self-test"]')!.click();

        // 面板自身留痕，并把"造一次真实未捕获异常"交给插件侧（测试里用替身，真实抛错由插件接线测试覆盖）
        expect(onSelfTest).toHaveBeenCalledWith("uncaught");
        const selfTests = log.entries().filter((entry) => entry.event === "log.selftest");
        expect(selfTests).toHaveLength(1);
        expect(selfTests[0].detail).toHaveProperty("at");
        expect(document.querySelector(".xz-log-status")?.textContent).toContain("自检");
    });

    it("复制全部会把完整时间线写进剪贴板", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        log.reset();
        log.warn("store", "store.verify.fail", { file: "work-items.json" });
        handle = openLogPanel(panelOptions());

        document.querySelector<HTMLButtonElement>('[data-action="copy"]')!.click();
        // 复制是异步的：等到状态行出现结果，再核对写进剪贴板的内容
        await vi.waitFor(() => expect(document.querySelector(".xz-log-status")?.textContent).toContain("已复制"));
        expect(writeText).toHaveBeenCalledTimes(1);

        const copied = writeText.mock.calls[0][0] as string;
        expect(copied).toContain("# 行舟日志");
        expect(copied).toContain("# 思源内核版本：3.8.4");
        expect(copied).toContain("store.verify.fail");
    });

    it("下载提供 .txt 与 .json 两种格式", () => {
        const blobs: string[] = [];
        class BlobSpy {
            constructor(parts: unknown[]) {
                blobs.push(String(parts[0]));
            }
        }
        vi.stubGlobal("Blob", BlobSpy);
        vi.stubGlobal("URL", { createObjectURL: () => "blob:fake", revokeObjectURL: () => undefined });
        const clicked: string[] = [];
        const createElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
            const node = createElement(tag);
            // 下载用的 <a> 挂上即点即移除，这里只记录文件名，不真的触发下载
            if (tag === "a") node.click = () => clicked.push((node as HTMLAnchorElement).download);
            return node;
        });
        log.warn("store", "store.write.fail", { file: "work-items.json" });
        handle = openLogPanel(panelOptions());

        document.querySelector<HTMLButtonElement>('[data-action="download-text"]')!.click();
        document.querySelector<HTMLButtonElement>('[data-action="download-json"]')!.click();

        expect(blobs[0]).toContain("store.write.fail");
        expect(JSON.parse(blobs[1]).entries[0].event).toBe("store.write.fail");
        expect(clicked[0]).toMatch(/^xingzhou-logs-\d{8}-\d{6}\.txt$/);
        expect(clicked[1]).toMatch(/\.json$/);
        expect(document.querySelector(".xz-log-status")?.textContent).toContain("已开始下载");
    });

    it("清空会丢掉此前日志，但清空动作自身仍留痕可追溯", () => {
        log.reset();
        log.configure({ minLevel: "verbose" });
        log.warn("store", "store.parse.failed");
        log.warn("store", "store.verify.fail");
        handle = openLogPanel(panelOptions());
        // 清空是同步动作：点击后立即核对缓冲与状态行
        document.querySelector<HTMLButtonElement>('[data-action="clear"]')!.click();
        expect(log.entries().map((entry) => entry.event)).toEqual(["log.cleared"]);
        expect(log.entries().find((entry) => entry.event === "log.cleared")?.detail).toMatchObject({ removed: 2 });
        expect(document.querySelectorAll(".xz-log-row")).toHaveLength(1);
        expect(document.querySelector(".xz-log-status")?.textContent).toContain("已清空 2 条日志");
    });
});

describe("界面日志入口", () => {
    afterEach(() => {
        document.body.replaceChildren();
        log.reset();
    });

    it("头部「日志」按钮在有告警时显示未读数，点击后调用打开面板", async () => {
        log.reset();
        const openLog = vi.fn();
        const component = new AppShell({
            target: document.body,
            props: {
                load: vi.fn().mockResolvedValue(EMPTY_DATA),
                captureInbox: vi.fn(),
                saveItem: vi.fn(),
                deleteItem: vi.fn(),
                openDocument: vi.fn(),
                openItemMenu: vi.fn(),
                openCaptureDialog: vi.fn(),
                loadDaily: vi.fn(),
                saveDaily: vi.fn(),
                openLog,
            },
        });
        await tick();

        const button = document.querySelector<HTMLButtonElement>(".xz-log-entry");
        expect(button).not.toBeNull();
        expect(button!.textContent).toContain("日志");
        expect(document.querySelector(".xz-log-entry__badge")).toBeNull();

        log.error("store", "store.write.stopped", { file: "work-items.json" });
        await tick();
        expect(document.querySelector(".xz-log-entry__badge")?.textContent).toBe("1");
        expect(button!.getAttribute("aria-label")).toContain("1 条新警告或错误");

        button!.click();
        expect(openLog).toHaveBeenCalledTimes(1);
        component.$destroy();
    });
});

describe("插件里的日志面板接线", () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
        log.reset();
    });

    it("插件打开面板、通过面板改级别后写回 settings.json，卸载时清空缓冲", async () => {
        vi.useFakeTimers();
        log.reset();
        const files = new Map<string, unknown>();
        const plugin = new XingzhouPlugin({} as never);
        Object.assign(plugin, {
            loadData: async (file: string) => files.get(file),
            saveData: async (file: string, value: unknown) => {
                files.set(file, value);
                return { code: 0, msg: "", data: null };
            },
        });
        log.configure({ minLevel: "info" });
        plugin.onload();
        await vi.waitFor(() => expect(log.entries().map((entry) => entry.event)).toContain("plugin.load"));
        log.configure({ minLevel: "warn" });

        const internals = plugin as unknown as { openLog: () => void; onunload: () => void };
        internals.openLog();
        expect(document.querySelector(".xz-log-panel")).not.toBeNull();

        // 打开面板即清未读；此后的新错误会重新累计未读，直到再次查看
        log.warn("store", "store.parse.failed", { file: "work-items.json" });
        log.markRead();
        expect(log.stats().unread).toBe(0);
        log.error("store", "store.write.stopped", { file: "work-items.json" });
        expect(log.stats().unread).toBe(1);

        const select = document.querySelector<HTMLSelectElement>('.xz-log-scope-setting select[data-scope="store"]');
        select!.value = "verbose";
        select!.dispatchEvent(new Event("change"));
        expect(log.levelOf("store")).toBe("verbose");

        // 级别改动合并写盘，不额外弹提示
        await vi.advanceTimersByTimeAsync(400);
        const settings = files.get("settings.json") as { log?: { scopes?: Record<string, string> } } | undefined;
        expect(settings?.log?.scopes).toEqual({ store: "verbose" });

        internals.onunload();
        expect(document.querySelector(".xz-log-panel")).toBeNull();
        expect(log.entries()).toHaveLength(0);
    });

    it("插件侧自检写入 warn 级日志，并走未捕获异常上报入口", async () => {
        vi.useRealTimers();
        log.reset();
        const plugin = new XingzhouPlugin({} as never);
        Object.assign(plugin, {
            loadData: async () => undefined,
            saveData: async () => ({ code: 0, msg: "", data: null }),
        });
        const addListener = vi.spyOn(window, "addEventListener");
        plugin.onload();
        expect(addListener.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(["error", "unhandledrejection"]));
        addListener.mockRestore();

        // 自检会安排一次"真实抛错"；单元测试里把定时器换掉，避免把未捕获异常抛给测试运行器
        const pending: Array<() => void> = [];
        const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void) => {
            pending.push(handler);
            return 0 as unknown as ReturnType<typeof setTimeout>;
        }) as never);
        (plugin as unknown as { runLogSelfTest: (kind: string) => void }).runLogSelfTest("uncaught");
        timer.mockRestore();
        expect(pending).toHaveLength(1); // 自检确实安排了抛错，只是测试里不执行

        const selfTest = log.entries().find((entry) => entry.event === "log.selftest");
        expect(selfTest?.level).toBe("warn");
        expect(selfTest?.detail).toMatchObject({ kind: "uncaught" });

        // 真实抛错把异常交给浏览器，再由 window.onerror 回到同一个上报函数：
        // 这里直接调用上报函数，确认它落进日志并抬高未读数（jsdom 下真实抛错会被 vitest 判为未处理错误）
        (plugin as unknown as { reportWindowError: (event: unknown) => void }).reportWindowError({
            message: "Uncaught Error: 行舟日志自检：未捕获异常链路正常",
            filename: "index.js",
            lineno: 1,
            colno: 1,
            error: new Error("行舟日志自检：未捕获异常链路正常"),
        });
        const onError = log.entries().find((entry) => entry.event === "window.onerror");
        expect(onError?.level).toBe("error");
        expect(JSON.stringify(onError?.detail)).toContain("行舟日志自检");
        expect(log.stats().unread).toBeGreaterThanOrEqual(2);

        plugin.onunload();
    });
});
