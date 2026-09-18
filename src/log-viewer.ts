/**
 * 日志面板：让不看 DevTools 的使用者也能在插件界面里查看、复制、导出日志。
 *
 * 为什么用命令式 DOM 而不是 Svelte 组件：面板要在思源 Dialog 里打开，而思源 Dialog 的
 * content 只接受字符串（见 ActionEditorWindow 的用法）。这里用占位符建对话框，再把自建
 * 容器挂进 dialog.element，避免为一个纯列表再引入组件生命周期。
 *
 * 面板行为：
 * - 打开即视为已读（清未读角标）；
 * - 默认只显示 warn/error 与常用 scope；可逐 scope 打开 verbose（写入插件设置后持久生效）；
 * - 复制全部、清空、下载 .txt / .json；
 * - 列表跟随最新，用户往上翻时暂停跟随，便于停在出错的那一刻。
 */
import { Dialog } from "siyuan";
import {
    LOG_LEVELS,
    LOG_LEVEL_LABELS,
    LOG_SCOPES,
    formatTime,
    log,
    type LogDetail,
    type LogEntry,
    type LogLevel,
    type LogSettings,
} from "./log";

export type LogPanelOptions = {
    /** 当前日志配置（面板里的级别开关以此为初值）。 */
    config: LogSettings;
    /** 级别/scope 开关变化：由插件写回 settings.json。 */
    onConfigChange: (config: LogSettings) => void;
    /**
     * 自检：写入一条日志，并真实抛出一次未捕获异常。
     * 使用者不看 DevTools 也能确认"记录 → 未读角标 → 导出"这条链路是通的。
     */
    onSelfTest?: (kind: "log" | "uncaught") => void;
    /** 插件版本等导出元信息。 */
    meta?: () => Record<string, unknown>;
    /** 面板销毁（含点窗口外关闭）时回调。 */
    onDestroy?: () => void;
};

export type LogPanelHandle = {
    element: HTMLElement;
    refresh: () => void;
    destroy: () => void;
};

const RENDER_LIMIT = 400;
const FOLLOW_THRESHOLD_PX = 24;

function isBodyFieldPreviewKey(key: string): boolean {
    const lower = key.toLowerCase();
    return ["content", "text", "body", "markdown", "title", "currentaction", "nextaction", "preview", "snapshot"].some((word) => lower.includes(word));
}

function detailPreview(detail: LogDetail | undefined): string {
    if (!detail) return "";
    const parts: string[] = [];
    for (const [key, value] of Object.entries(detail)) {
        if (isBodyFieldPreviewKey(key)) continue;
        if (value === null || value === undefined) continue;
        const text = typeof value === "string" ? value : JSON.stringify(value);
        if (!text) continue;
        parts.push(`${key}=${text.length > 80 ? `${text.slice(0, 80)}…` : text}`);
    }
    return parts.length > 0 ? parts.join("  ") : JSON.stringify(detail);
}

function entryMatches(entry: LogEntry, levels: Set<LogLevel>, scopes: Set<string>, keyword: string, onlyProblems: boolean): boolean {
    if (!levels.has(entry.level)) return false;
    if (scopes.size > 0 && !scopes.has(entry.scope)) return false;
    if (onlyProblems && entry.level !== "warn" && entry.level !== "error") return false;
    if (keyword && !`${entry.scope} ${entry.event} ${entry.level}`.toLowerCase().includes(keyword)) return false;
    return true;
}

/** 面板骨架节点的统一构造器：类名与属性一次写清，避免散落的样板代码。 */
function element<TElement extends HTMLElement>(
    tag: string,
    className: string,
    attributes: Record<string, string> = {},
): TElement {
    const node = document.createElement(tag);
    node.className = className;
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node as TElement;
}

export function openLogPanel(options: LogPanelOptions): LogPanelHandle {
    const levels = new Set<LogLevel>(["verbose", "info", "warn", "error"]);
    const scopes = new Set<string>();
    let keyword = "";
    let onlyProblems = false;
    let follow = true;
    let unsubscribe: (() => void) | undefined;

    const dialog = new Dialog({
        title: "行舟日志",
        width: "min(1080px, 92vw)",
        height: "78vh",
        content: '<div class="xz-log-panel__slot"></div>',
        destroyCallback: () => {
            unsubscribe?.();
            unsubscribe = undefined;
            options.onDestroy?.();
        },
    });

    const root = document.createElement("div");
    root.className = "xz-log-panel";
    const slot = dialog.element.querySelector<HTMLElement>(".xz-log-panel__slot");
    (slot ?? dialog.element).append(root);

    // 面板骨架不写成 innerHTML：全部节点自建，后续填充只用 textContent，杜绝任何内容被当作标记执行。
    root.append(
        buildToolbar(),
        buildScopeSettings(),
        buildList(),
        buildFoot(),
        buildStatus(),
    );

    function buildToolbar(): HTMLElement {
        const toolbar = document.createElement("div");
        toolbar.className = "xz-log-toolbar";
        toolbar.setAttribute("role", "group");
        toolbar.setAttribute("aria-label", "日志筛选");
        // 第一行放两组筛选 chip（各自成组、各自换行），第二行放范围控件，避免互相挤压
        const filters = document.createElement("div");
        filters.className = "xz-log-toolbar__row xz-log-toolbar__row--filters";
        filters.append(toolbarRow("级别", "xz-log-levels"), toolbarRow("来源", "xz-log-scopes"));
        toolbar.append(filters);
        const range = document.createElement("div");
        range.className = "xz-log-toolbar__row";
        range.append(
            label("范围"),
            element("select", "b3-select xz-log-level-select", { "aria-label": "全局日志级别" }),
            element("input", "b3-text-field xz-log-search", { type: "search", placeholder: "搜索事件名 / scope", "aria-label": "搜索日志" }),
        );
        const onlyProblems = document.createElement("label");
        onlyProblems.className = "xz-log-checkbox";
        onlyProblems.append(element("input", "xz-log-only-problems", { type: "checkbox" }), document.createTextNode(" 只看警告与错误"));
        const spacer = document.createElement("span");
        spacer.className = "xz-log-toolbar__spacer";
        const followHint = element("span", "xz-log-follow-hint", { "aria-live": "polite" });
        range.append(onlyProblems, spacer, followHint);
        toolbar.append(range);
        return toolbar;
    }

    function toolbarRow(labelText: string, hostClass: string): HTMLElement {
        const row = document.createElement("div");
        row.className = "xz-log-toolbar__row";
        row.append(label(labelText), element("span", hostClass));
        return row;
    }

    function label(text: string): HTMLElement {
        const node = document.createElement("span");
        node.className = "xz-log-toolbar__label";
        node.textContent = text;
        return node;
    }

    function buildScopeSettings(): HTMLElement {
        const host = document.createElement("div");
        host.className = "xz-log-scope-settings";
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "按来源调整记录级别（调试用）";
        const grid = element("div", "xz-log-scope-settings__grid");
        const note = document.createElement("p");
        note.className = "xz-log-scope-settings__note";
        note.textContent = "默认只记“警告与错误”。排查问题时把相关来源改成“详细”，复现一次后再导出日志；改动会写入插件设置并立即生效。";
        details.append(summary, grid, note);
        host.append(details);
        return host;
    }

    function buildList(): HTMLElement {
        return element("div", "xz-log-list", { tabindex: "0", "aria-label": "日志列表" });
    }

    function buildFoot(): HTMLElement {
        const foot = document.createElement("div");
        foot.className = "xz-log-foot";
        const count = element("span", "xz-log-count", { "aria-live": "polite" });
        const actions = document.createElement("span");
        actions.className = "xz-log-foot__actions";
        for (const [action, text] of [["self-test", "自检"], ["copy", "复制全部"], ["download-text", "下载 .txt"], ["download-json", "下载 .json"], ["clear", "清空"]] as const) {
            const button = element("button", "b3-button b3-button--outline", { type: "button" });
            button.dataset.action = action;
            button.textContent = text;
            actions.append(button);
        }
        foot.append(count, actions);
        return foot;
    }

    function buildStatus(): HTMLElement {
        return element("p", "xz-log-status", { role: "status", "aria-live": "polite" });
    }

    const requireElement = <TElement extends Element>(selector: string): TElement => {
        const element = root.querySelector<TElement>(selector);
        if (!element) throw new Error(`日志面板缺少必要控件：${selector}`);
        return element;
    };

    const levelsHost = requireElement<HTMLElement>(".xz-log-levels");
    const scopesHost = requireElement<HTMLElement>(".xz-log-scopes");
    const levelSelect = requireElement<HTMLSelectElement>(".xz-log-level-select");
    const searchInput = requireElement<HTMLInputElement>(".xz-log-search");
    const onlyProblemsInput = requireElement<HTMLInputElement>(".xz-log-only-problems");
    const followHint = requireElement<HTMLElement>(".xz-log-follow-hint");
    const scopeSettings = requireElement<HTMLElement>(".xz-log-scope-settings__grid");
    const listHost = requireElement<HTMLElement>(".xz-log-list");
    const countLabel = requireElement<HTMLElement>(".xz-log-count");
    const statusLabel = requireElement<HTMLElement>(".xz-log-status");

    // 级别筛选：四个复选按钮
    const levelButtons = new Map<LogLevel, HTMLButtonElement>();
    for (const level of LOG_LEVELS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `xz-log-level xz-log-level--${level}`;
        button.setAttribute("aria-pressed", "true");
        button.textContent = `${LOG_LEVEL_LABELS[level]} ${level}`;
        button.addEventListener("click", () => {
            if (levels.has(level)) levels.delete(level);
            else levels.add(level);
            button.setAttribute("aria-pressed", String(levels.has(level)));
            renderList();
        });
        levelsHost.append(button);
        levelButtons.set(level, button);
    }

    // 来源筛选：只列出现过的 scope，避免工具栏被空 scope 占满
    function renderScopeChips(): void {
        const present = new Set(log.entries().map((entry) => entry.scope));
        const known = LOG_SCOPES.map((scope) => scope.id).filter((id) => present.has(id));
        const unknown = [...present].filter((scope) => !LOG_SCOPES.some((item) => item.id === scope)).sort();
        const ids = [...known, ...unknown];
        scopesHost.replaceChildren();
        for (const id of ids) {
            const label = LOG_SCOPES.find((scope) => scope.id === id)?.label ?? id;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "xz-log-scope";
            button.dataset.scope = id;
            button.setAttribute("aria-pressed", String(scopes.has(id)));
            button.textContent = label;
            button.addEventListener("click", () => {
                if (scopes.has(id)) scopes.delete(id);
                else scopes.add(id);
                button.setAttribute("aria-pressed", String(scopes.has(id)));
                renderList();
            });
            scopesHost.append(button);
        }
        if (ids.length === 0) {
            const empty = document.createElement("span");
            empty.className = "xz-log-scope-empty";
            empty.textContent = "还没有记录";
            scopesHost.append(empty);
        }
    }

    // 全局级别下拉
    for (const level of LOG_LEVELS) {
        const option = document.createElement("option");
        option.value = level;
        option.textContent = `全局：${LOG_LEVEL_LABELS[level]}`;
        levelSelect.append(option);
    }
    levelSelect.value = log.getConfig().minLevel;
    levelSelect.addEventListener("change", () => {
        const level = levelSelect.value as LogLevel;
        log.setMinLevel(level);
        applyConfigChange();
        log.verbose("ui", "log.panel.level.changed", { minLevel: level });
        renderScopeSettings();
        renderList();
    });

    // 逐 scope 级别
    function renderScopeSettings(): void {
        const current = log.getConfig();
        scopeSettings.replaceChildren();
        for (const scope of LOG_SCOPES) {
            const row = document.createElement("label");
            row.className = "xz-log-scope-setting";
            const name = document.createElement("span");
            name.textContent = scope.label;
            name.title = scope.description;
            const select = document.createElement("select");
            select.className = "b3-select";
            select.dataset.scope = scope.id;
            const follow = document.createElement("option");
            follow.value = "";
            follow.textContent = `跟随全局（${LOG_LEVEL_LABELS[current.minLevel]}）`;
            select.append(follow);
            for (const level of LOG_LEVELS) {
                const option = document.createElement("option");
                option.value = level;
                option.textContent = LOG_LEVEL_LABELS[level];
                select.append(option);
            }
            select.value = current.scopes[scope.id] ?? "";
            select.addEventListener("change", () => {
                const value = select.value as LogLevel | "";
                log.setScopeLevel(scope.id, value === "" ? null : value);
                applyConfigChange();
                log.verbose("ui", "log.panel.scope.changed", { scope: scope.id, level: value === "" ? "follow" : value });
                renderScopeSettings();
                renderList();
            });
            row.append(name, select);
            scopeSettings.append(row);
        }
    }

    function applyConfigChange(): void {
        options.onConfigChange(log.getConfig());
    }

    let renderQueued = false;

    /**
     * 合并渲染：打开 verbose 后日志会成批到来，
     * 每条都重建列表会白白浪费，这里一帧最多重建一次。
     */
    function scheduleRender(): void {
        if (renderQueued) return;
        renderQueued = true;
        setTimeout(() => {
            renderQueued = false;
            if (!root.isConnected) return;
            renderList();
        }, 0);
    }

    function renderList(): void {
        const all = log.entries();
        const filtered = all.filter((entry) => entryMatches(entry, levels, scopes, keyword.trim().toLowerCase(), onlyProblems));
        const visible = filtered.slice(-RENDER_LIMIT);
        const fragment = document.createDocumentFragment();
        for (const entry of visible) fragment.append(renderRow(entry));
        listHost.replaceChildren(fragment);
        const stats = log.stats();
        const hiddenOlder = filtered.length - visible.length;
        countLabel.textContent = `显示 ${visible.length} / 匹配 ${filtered.length} / 缓冲 ${stats.size} 条`
            + (hiddenOlder > 0 ? `（较早的 ${hiddenOlder} 条已折叠，可下载完整日志）` : "");
        if (follow) listHost.scrollTop = listHost.scrollHeight;
        updateFollowHint();
    }

    function renderRow(entry: LogEntry): HTMLElement {
        const row = document.createElement("div");
        row.className = `xz-log-row xz-log-row--${entry.level}`;
        row.dataset.level = entry.level;
        row.dataset.scope = entry.scope;

        const time = document.createElement("span");
        time.className = "xz-log-row__time";
        time.textContent = formatTime(entry.time);

        const seq = document.createElement("span");
        seq.className = "xz-log-row__seq";
        seq.textContent = `#${entry.seq}`;

        const level = document.createElement("span");
        level.className = `xz-log-row__level xz-log-level--${entry.level}`;
        level.textContent = entry.level.toUpperCase();

        const scope = document.createElement("span");
        scope.className = "xz-log-row__scope";
        scope.textContent = entry.scope;

        const event = document.createElement("span");
        event.className = "xz-log-row__event";
        event.textContent = entry.event;

        row.append(time, seq, level, scope, event);

        if (entry.ms !== undefined) {
            const ms = document.createElement("span");
            ms.className = "xz-log-row__ms";
            ms.textContent = `${entry.ms} ms`;
            row.append(ms);
        }

        const preview = detailPreview(entry.detail);
        if (preview) {
            const detail = document.createElement("button");
            detail.type = "button";
            detail.className = "xz-log-row__detail";
            detail.textContent = preview;
            detail.title = "点击展开完整字段";
            detail.addEventListener("click", () => {
                if (detail.dataset.expanded === "true") {
                    detail.dataset.expanded = "false";
                    detail.textContent = preview;
                    return;
                }
                detail.dataset.expanded = "true";
                detail.textContent = JSON.stringify(entry.detail, null, 2);
            });
            row.append(detail);
        }
        return row;
    }

    function updateFollowHint(): void {
        followHint.textContent = follow ? "" : "已暂停跟随（列表停在当前位置）";
    }

    listHost.addEventListener("scroll", () => {
        const atBottom = listHost.scrollHeight - listHost.scrollTop - listHost.clientHeight <= FOLLOW_THRESHOLD_PX;
        if (atBottom === follow) return;
        follow = atBottom;
        updateFollowHint();
        if (follow) listHost.scrollTop = listHost.scrollHeight;
    });

    searchInput.addEventListener("input", () => {
        keyword = searchInput.value;
        renderList();
    });
    onlyProblemsInput.addEventListener("change", () => {
        onlyProblems = onlyProblemsInput.checked;
        renderList();
    });

    function setStatus(message: string, kind: "ok" | "fail" = "ok"): void {
        statusLabel.textContent = message;
        statusLabel.className = `xz-log-status xz-log-status--${kind}`;
    }

    requireElement<HTMLButtonElement>('[data-action="self-test"]').addEventListener("click", () => {
        log.info("ui", "log.selftest", { at: new Date().toISOString() });
        options.onSelfTest?.("uncaught");
        // 同步重建一次列表：新增的日志立刻可见，不必等下一次渲染合并
        renderScopeChips();
        renderList();
        setStatus("已写入自检日志；若这条链路正常，关闭面板后头部「日志」按钮会出现红色未读数");
    });
    requireElement<HTMLButtonElement>('[data-action="copy"]').addEventListener("click", () => {
        void copyAll();
    });
    requireElement<HTMLButtonElement>('[data-action="download-text"]').addEventListener("click", () => {
        download("txt");
    });
    requireElement<HTMLButtonElement>('[data-action="download-json"]').addEventListener("click", () => {
        download("json");
    });
    requireElement<HTMLButtonElement>('[data-action="clear"]').addEventListener("click", () => {
        const removed = log.stats().size;
        // 先记"清空"再清缓冲：清掉的日志确实不再保留，但"谁在什么时候清空了日志"必须可追溯
        log.info("ui", "log.cleared", { removed });
        const kept = log.entries().filter((entry) => entry.event === "log.cleared");
        log.clear();
        log.restore(kept);
        renderScopeChips();
        renderList();
        setStatus(`已清空 ${removed} 条日志`);
    });

    async function copyAll(): Promise<void> {
        const text = log.exportText(options.meta?.() ?? {});
        log.info("ui", "log.export.copy", { length: text.length, entries: log.stats().size });
        const copied = await writeClipboard(text);
        if (copied) setStatus(`已复制 ${log.stats().size} 条日志到剪贴板`);
        else setStatus("自动复制被系统拒绝：请手动全选下方日志后复制，或改用“下载 .txt”", "fail");
    }

    function download(kind: "txt" | "json"): void {
        const text = kind === "json" ? log.exportJson(options.meta?.() ?? {}) : log.exportText(options.meta?.() ?? {});
        const name = `xingzhou-logs-${fileStamp()}.${kind}`;
        log.info("ui", "log.export.download", { kind, bytes: text.length, entries: log.stats().size });
        try {
            const blob = new Blob([text], { type: kind === "json" ? "application/json" : "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = name;
            anchor.rel = "noopener";
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
            setStatus(`已开始下载 ${name}`);
        } catch (error) {
            setStatus(`下载失败：${error instanceof Error ? error.message : String(error)}，可改用“复制全部”`, "fail");
        }
    }

    function refresh(): void {
        renderScopeChips();
        renderScopeSettings();
        renderList();
    }

    unsubscribe = log.subscribe(() => scheduleRender());
    log.markRead();
    refresh();

    return {
        element: root,
        refresh,
        destroy: () => dialog.destroy(),
    };
}

async function writeClipboard(text: string): Promise<boolean> {
    try {
        const clipboard = navigator.clipboard;
        if (clipboard && typeof clipboard.writeText === "function") {
            await clipboard.writeText(text);
            return true;
        }
    } catch {
        // 继续走 execCommand 兜底
    }
    try {
        const helper = document.createElement("textarea");
        helper.value = text;
        helper.setAttribute("readonly", "readonly");
        helper.className = "xz-log-clipboard-helper";
        document.body.append(helper);
        helper.select();
        const command = (document as Document & { execCommand?: (name: string) => boolean }).execCommand;
        const copied = typeof command === "function" ? command.call(document, "copy") : false;
        helper.remove();
        return copied;
    } catch {
        return false;
    }
}

function fileStamp(time = Date.now()): string {
    const date = new Date(time);
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
