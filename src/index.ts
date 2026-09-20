import { Dialog, Menu, openTab, Plugin, Setting, showMessage, type Custom, type Tab } from "siyuan";
import AppShell from "./AppShell.svelte";
import { showCaptureDialog, type CaptureDialogRequest } from "./capture-dialog";
import {
    CHECKLIST_STORE_FILE,
    checklistBackupFileForRevision,
    checklistStoresMatch,
    cloneChecklistStore,
    createDefaultChecklistStore,
    parseChecklistStore,
    type ChecklistStore,
} from "./checklist";
import { DEFAULT_SETTINGS, normalizeSettings, type XingzhouSettings } from "./config";
import {
    DAILY_RUBRICS,
    DAILY_STORE_FILE,
    cloneDailyRecord,
    createEmptyDailyStore,
    dailyBackupFileForRevision,
    dailyStoresMatch,
    parseDailyStore,
    upsertDailyRecord,
    type DailyRecord,
    type DailyRecordStore,
    type DailyRubric,
} from "./daily-records";
import { applyDependencyStorage, DEPENDENCIES_FILE, normalizeDependencyStorage } from "./dependency-storage";
import {
    copyImagePathToClipboard,
    copyImageToClipboard,
    imageCopyMessage,
    imagePathCopyMessage,
    type ActionImageCopyTarget,
} from "./image-clipboard";
import {
    addStoredWorkItem,
    backupFileForRevision,
    createEmptyInternalStore,
    describeStoreMismatch,
    INTERNAL_STORE_FILE,
    isAbsentInternalStore,
    MIGRATION_SNAPSHOT_FILE,
    migrateWorkItemData,
    parseInternalStore,
    removeStoredWorkItem,
    reorderStoredWorkItems,
    storesMatch,
    toInternalWorkItemData,
    updateStoredWorkItem,
    type InternalWorkItemStore,
} from "./internal-store";
import { getXingzhouTabId, XINGZHOU_TAB_TYPE } from "./tab-id";
import { describeError, log } from "./log";
import { openLogPanel, type LogPanelHandle } from "./log-viewer";
import { normalizeLogConfig } from "./log-config";
import {
    NUTRITION_STORE_FILE,
    cloneNutritionStore,
    createEmptyNutritionStore,
    nutritionBackupFileForRevision,
    nutritionStoresMatch,
    parseNutritionStore,
    type NutritionStore,
} from "./nutrition";
import { loadWorkItems, type InboxCaptureOptions, type WorkItem, type WorkItemChanges, type WorkItemData, type WorkItemViewState } from "./work-items";
import { UI_STATE_FILE, parseViewStateFile, wrapViewStateFile } from "./ui-state";
import { TREND_VIEW_FILE, parseTrendViewFile, wrapTrendViewFile } from "./trend-view";
import type { TrendViewSettings } from "./trend-metrics";
import { requestSiYuan } from "./siyuan-api";
import "./index.scss";

const SETTINGS_FILE = "settings.json";
const ICON_ID = "iconXingzhou";
const ICON = `<symbol id="${ICON_ID}" viewBox="0 0 24 24">
    <g transform="rotate(-8 8.5 16.5)">
        <path d="M2.6 18.2c2.2.6 4.3.5 6.2-.1" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" opacity=".7"/>
        <path d="M4.3 15.9c2.5.4 5.3.2 8.1-.6-.8 1.8-2.3 2.8-4.4 3.2-1.6-.2-2.9-1.1-3.7-2.6Z" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/>
        <path d="M6.6 15.2c1.6 0 3.2-.2 4.7-.6" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>
        <path d="M12 14.8c1-.4 1.9-1 2.8-1.7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    </g>
    <path d="m17.6 2.2 1.05 2.25 2.45.23-1.85 1.61.53 2.41-2.18-1.27-2.17 1.27.52-2.41-1.84-1.61 2.44-.23 1.05-2.25Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
    <path d="M16 10c1.8 1.2 3 2.6 3.6 4.2" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
    <path d="M3 21c4 .7 7.8-.1 11.2-2.3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".65"/>
</symbol>`;

type AppInstance = {
    component: AppShell;
    mount: HTMLDivElement;
};

export default class XingzhouPlugin extends Plugin {
    private settings: XingzhouSettings = { ...DEFAULT_SETTINGS, log: { ...DEFAULT_SETTINGS.log } };
    private readonly instances = new Map<Custom, AppInstance>();
    private readonly dialogs = new Set<Dialog>();
    private currentTab?: Tab;
    private opening?: Promise<Tab>;
    private topBar?: HTMLElement;
    private stopped = false;
    private settingsReady: Promise<void> = Promise.resolve();
    private mutationQueue: Promise<void> = Promise.resolve();
    private viewStateSaveQueue: Promise<void> = Promise.resolve();
    private trendViewSaveQueue: Promise<void> = Promise.resolve();
    private logPanel?: LogPanelHandle;
    /** 思源内核版本：导出日志时带上，便于按版本比对行为。 */
    private kernelVersion = "";
    private settingsSaveTimer: number | null = null;
    private handleWindowError?: (event: ErrorEvent) => void;
    private handleUnhandledRejection?: (event: PromiseRejectionEvent) => void;

    onload(): void {
        this.installGlobalErrorHandlers();
        log.info("lifecycle", "plugin.load", { name: this.name });
        this.addIcons(ICON);
        this.registerTab();
        this.configureSettings();
        this.settingsReady = this.loadSettings();
    }

    onLayoutReady(): void {
        this.topBar = this.addTopBar({
            icon: ICON_ID,
            title: this.i18n.openCenter || "打开行舟",
            position: "right",
            callback: () => void this.openCenter(),
        });
        log.info("lifecycle", "plugin.layout.ready", { topBar: Boolean(this.topBar) });
    }

    onunload(): void {
        this.stopped = true;
        log.info("lifecycle", "plugin.unload", { dialogs: this.dialogs.size, tabs: this.instances.size });
        this.removeGlobalErrorHandlers();
        this.closeLogPanel();
        if (this.settingsSaveTimer !== null) window.clearTimeout(this.settingsSaveTimer);
        this.settingsSaveTimer = null;
        this.topBar?.remove();
        this.topBar = undefined;
        for (const instance of this.instances.values()) instance.component.$destroy();
        this.instances.clear();
        for (const dialog of this.dialogs) dialog.destroy();
        this.dialogs.clear();
        this.currentTab?.close();
        this.currentTab = undefined;
        // 缓冲只活在内存里：卸载即清空，不给下次加载留下过期上下文
        log.reset();
    }

    /**
     * 全局异常入口：插件内部 catch 住的错误会各自留痕，"没被任何人接住"的错误只能在这里兜住。
     * 不看 DevTools 的使用者因此也能在日志面板里看到原始错误信息与栈（已截断）。
     */
    private installGlobalErrorHandlers(): void {
        if (this.handleWindowError || this.handleUnhandledRejection) return;
        this.handleWindowError = (event: ErrorEvent) => this.reportWindowError(event);
        this.handleUnhandledRejection = (event: PromiseRejectionEvent) => this.reportUnhandledRejection(event);
        window.addEventListener("error", this.handleWindowError);
        window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
    }

    private reportWindowError(event: ErrorEvent): void {
        log.error("lifecycle", "window.onerror", {
            message: event.message,
            source: event.filename,
            line: event.lineno,
            column: event.colno,
            err: event.error ? describeError(event.error) : undefined,
        });
    }

    private reportUnhandledRejection(event: PromiseRejectionEvent): void {
        log.error("lifecycle", "window.unhandledrejection", { err: describeError(event.reason) });
    }

    private removeGlobalErrorHandlers(): void {
        if (this.handleWindowError) window.removeEventListener("error", this.handleWindowError);
        if (this.handleUnhandledRejection) window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
        this.handleWindowError = undefined;
        this.handleUnhandledRejection = undefined;
    }

    /** 日志面板入口：设置写回、销毁收尾与重复打开都在这里统一处理。 */
    private openLog(): void {
        if (this.logPanel) return;
        const entries = log.stats().size;
        const panel = openLogPanel({
            config: this.settings.log,
            meta: () => ({
                pluginName: this.name,
                kernelVersion: this.kernelVersion || "未知",
                entries: log.stats().size,
            }),
            onConfigChange: (next) => {
                this.settings = { ...this.settings, log: normalizeLogConfig(next) };
                this.scheduleSettingsSave();
            },
            onSelfTest: (kind) => this.runLogSelfTest(kind),
            onDestroy: () => {
                if (this.logPanel === panel) this.logPanel = undefined;
            },
        });
        this.logPanel = panel;
        log.info("ui", "log.panel.open", { entries });
    }

    /**
     * 自检：使用者没有 DevTools，也要能确认"记录 → 未读角标 → 导出"这条链路是通的。
     * uncaught 分支刻意抛一次未被任何代码接住的异常，走到真实的 window.onerror 入口。
     */
    private runLogSelfTest(kind: "log" | "uncaught"): void {
        log.warn("lifecycle", "log.selftest", { kind, at: new Date().toISOString() });
        if (kind !== "uncaught") return;
        setTimeout(() => {
            console.error("行舟日志自检：这条未捕获异常是为了验证日志链路，可忽略。");
            throw new Error("行舟日志自检：未捕获异常链路正常");
        }, 0);
    }

    private closeLogPanel(): void {
        const panel = this.logPanel;
        this.logPanel = undefined;
        panel?.destroy();
    }

    /** 日志级别改动即时生效，但要像设置对话框一样持久化；合并写，避免连续点选时反复写盘。 */
    private scheduleSettingsSave(): void {
        if (this.settingsSaveTimer !== null) return;
        this.settingsSaveTimer = window.setTimeout(() => {
            this.settingsSaveTimer = null;
            void this.saveSettings();
        }, 300);
    }

    private registerTab(): void {
        const plugin = this;
        this.addTab({
            type: XINGZHOU_TAB_TYPE,
            init(this: Custom) {
                if (plugin.stopped) return;
                log.info("lifecycle", "tab.init");

                const target = this.element;
                if (!target || typeof target.replaceChildren !== "function") {
                    log.error("lifecycle", "tab.init.failed", { reason: "思源没有提供可用的挂载容器", hasElement: Boolean(target) });
                    console.error("行舟页签初始化失败：思源没有提供可用的挂载容器。", target);
                    return;
                }

                const mount = document.createElement("div");
                mount.className = "xingzhou-tab-mount";
                mount.setAttribute("aria-label", "行舟 · 个人行动与生活系统");
                mount.textContent = "行舟正在启动……";
                target.replaceChildren(mount);

                try {
                    mount.textContent = "";
                    const previous = plugin.instances.get(this);
                    if (previous) previous.component.$destroy();
                    const component = new AppShell({
                        target: mount,
                        props: {
                            load: () => plugin.loadWorkItemData(),
                            captureInbox: (title: string, options?: InboxCaptureOptions) => plugin.captureInternalItem(title, options),
                            saveItem: (data: WorkItemData, item: WorkItem, changes: WorkItemChanges) => plugin.saveWorkItemData(data, item, changes),
                            deleteItem: (data: WorkItemData, item: WorkItem) => plugin.deleteWorkItemData(data, item),
                            reorderItems: (data: WorkItemData, parentId: string | null, orderedIds: string[]) => plugin.reorderWorkItemData(data, parentId, orderedIds),
                            openCaptureDialog: (request: CaptureDialogRequest) => {
                                let dialog!: Dialog;
                                dialog = showCaptureDialog({
                                    ...request,
                                    onDestroy: () => plugin.dialogs.delete(dialog),
                                });
                                plugin.dialogs.add(dialog);
                            },
                            openItemMenu: (
                                event: MouseEvent,
                                onDelete: () => void,
                                addChild?: { label: string; onClick: () => void },
                                actions: Array<{ label: string; icon?: string; onClick: () => void }> = [],
                            ) => {
                                event.preventDefault();
                                event.stopPropagation();
                                const menu = new Menu("xingzhou-work-item-actions-menu");
                                if (addChild) {
                                    menu.addItem({
                                        icon: "iconAdd",
                                        label: addChild.label,
                                        click: addChild.onClick,
                                    });
                                }
                                for (const action of actions) {
                                    menu.addItem({
                                        icon: action.icon,
                                        label: action.label,
                                        click: action.onClick,
                                    });
                                }
                                if (addChild || actions.length > 0) menu.addSeparator();
                                menu.addItem({
                                    icon: "iconTrashcan",
                                    label: "删除工作项…",
                                    warning: true,
                                    click: () => onDelete(),
                                });
                                menu.open({ x: event.clientX, y: event.clientY });
                            },
                            openImageMenu: (event: MouseEvent, image: ActionImageCopyTarget) => {
                                event.preventDefault();
                                event.stopPropagation();
                                const menu = new Menu("xingzhou-action-image-menu");
                                menu.addItem({
                                    icon: "iconCopy",
                                    label: "复制原图",
                                    click: () => void copyActionImage(image),
                                });
                                menu.addItem({
                                    icon: "iconLink",
                                    label: "复制资源路径",
                                    click: () => void copyActionImagePath(image),
                                });
                                menu.open({ x: event.clientX, y: event.clientY });
                            },
                            openDocument: (blockId: string) => plugin.openBlock(blockId),
                            loadDaily: () => plugin.getDailyRecordsSnapshot(),
                            saveDaily: (record: DailyRecord) => plugin.saveDailyRecord(record),
                            loadChecklist: () => plugin.getChecklistSnapshot(),
                            saveChecklist: (store: ChecklistStore) => plugin.saveChecklistStore(store),
                            loadNutrition: () => plugin.getNutritionSnapshot(),
                            saveNutrition: (store: NutritionStore) => plugin.saveNutritionStore(store),
                            loadProjectViewState: () => plugin.loadProjectViewState(),
                            saveProjectViewState: (state: WorkItemViewState) => plugin.saveProjectViewState(state),
                            loadTrendViewState: () => plugin.loadTrendViewState(),
                            saveTrendViewState: (state: TrendViewSettings) => plugin.saveTrendViewState(state),
                            openLog: () => plugin.openLog(),
                        },
                    });
                    plugin.instances.set(this, { component, mount });
                    plugin.currentTab = this.tab;
                } catch (error) {
                    log.error("lifecycle", "ui.mount.failed", { err: describeError(error) });
                    console.error("行舟界面挂载失败。", error);
                    renderMountError(mount, error);
                }
            },
            beforeDestroy(this: Custom) {
                log.info("lifecycle", "tab.beforeDestroy");
                plugin.instances.get(this)?.component.$destroy();
                plugin.instances.delete(this);
                if (plugin.currentTab === this.tab) plugin.currentTab = undefined;
            },
            destroy(this: Custom) {
                log.info("lifecycle", "tab.destroy");
                plugin.instances.get(this)?.component.$destroy();
                plugin.instances.delete(this);
                if (plugin.currentTab === this.tab) plugin.currentTab = undefined;
            },
        });
    }

    private async openCenter(): Promise<void> {
        if (this.currentTab) {
            log.verbose("ui", "ui.tab.focus", { reused: true });
            this.currentTab.parent.switchTab(this.currentTab.headElement);
            return;
        }
        if (this.opening) {
            await this.opening;
            return;
        }
        this.opening = openTab({
            app: this.app,
            custom: {
                id: getXingzhouTabId(this.name),
                icon: ICON_ID,
                title: this.i18n.centerTitle || "行舟 · 个人行动与生活系统",
            },
            keepCursor: false,
        });
        try {
            this.currentTab = await this.opening;
            log.info("ui", "ui.tab.opened", { tabId: getXingzhouTabId(this.name) });
        } finally {
            this.opening = undefined;
        }
    }

    private async openBlock(blockId: string): Promise<void> {
        log.verbose("ui", "ui.block.open", { blockId });
        await openTab({
            app: this.app,
            doc: { id: blockId, action: ["cb-get-focus", "cb-get-hl"] },
            keepCursor: false,
        });
    }

    private async loadWorkItemData(): Promise<WorkItemData> {
        await this.settingsReady;
        await this.mutationQueue;
        const store = await this.loadInternalStoreOrMigrate();
        log.verbose("store", "store.load.ok", { revision: store.revision, items: store.items.length });
        return toInternalWorkItemData(store);
    }

    private async captureInternalItem(title: string, options: InboxCaptureOptions = {}): Promise<WorkItemData> {
        return this.enqueueMutation(async () => {
            const current = await this.loadInternalStoreOrMigrate();
            const next = addStoredWorkItem(current, title, createInternalItemId(), options);
            await this.persistStore(current, next);
            return toInternalWorkItemData(next);
        }, "capture");
    }

    private async saveWorkItemData(_data: WorkItemData, item: WorkItem, changes: WorkItemChanges): Promise<WorkItemData> {
        return this.enqueueMutation(async () => {
            const current = await this.loadInternalStoreOrMigrate();
            const next = updateStoredWorkItem(current, item.id, changes);
            await this.persistStore(current, next);
            return toInternalWorkItemData(next);
        }, "save");
    }

    private async deleteWorkItemData(_data: WorkItemData, item: WorkItem): Promise<WorkItemData> {
        return this.enqueueMutation(async () => {
            const current = await this.loadInternalStoreOrMigrate();
            const next = removeStoredWorkItem(current, item.id);
            await this.persistStore(current, next);
            return toInternalWorkItemData(next);
        }, "delete");
    }

    private async reorderWorkItemData(_data: WorkItemData, parentId: string | null, orderedIds: string[]): Promise<WorkItemData> {
        return this.enqueueMutation(async () => {
            const current = await this.loadInternalStoreOrMigrate();
            const next = reorderStoredWorkItems(current, parentId, orderedIds);
            await this.persistStore(current, next);
            return toInternalWorkItemData(next);
        }, "reorder");
    }

    /** Read-only integration point for future weekly, monthly, or AI analysis. */
    public async getDailyRecordsSnapshot(options: { from?: string; to?: string } = {}): Promise<DailyRecordStore> {
        await this.settingsReady;
        await this.mutationQueue;
        const store = await this.loadDailyStore();
        const records = store.records
            .filter((record) => !options.from || record.date >= options.from)
            .filter((record) => !options.to || record.date <= options.to)
            .map(cloneDailyRecord);
        return { ...store, records };
    }

    /** Stable scoring-rule integration point; callers receive a detached copy. */
    public getDailyRubrics(): DailyRubric[] {
        return DAILY_RUBRICS.map((rubric) => ({ ...rubric, levels: [...rubric.levels] as DailyRubric["levels"] }));
    }

    public async getChecklistSnapshot(): Promise<ChecklistStore> {
        await this.settingsReady;
        await this.mutationQueue;
        return cloneChecklistStore(await this.loadChecklistStore());
    }

    public async getNutritionSnapshot(): Promise<NutritionStore> {
        await this.settingsReady;
        await this.mutationQueue;
        return cloneNutritionStore(await this.loadNutritionStore());
    }

    private async saveNutritionStore(incoming: NutritionStore): Promise<NutritionStore> {
        return this.enqueueMutation(async () => {
            const current = await this.loadNutritionStore();
            const next = parseNutritionStore(incoming);
            if (!next) throw new Error("营养记录无法识别，已停止保存。");
            if (next.revision <= current.revision) next.revision = current.revision + 1;
            next.updatedAt = Date.now();
            log.verbose("nutrition", "nutrition.backup.rotate", { revision: current.revision, nextRevision: next.revision });
            await this.saveNutritionAndVerify(nutritionBackupFileForRevision(current.revision), current, "backup");
            await this.saveNutritionAndVerify(NUTRITION_STORE_FILE, next);
            return cloneNutritionStore(next);
        }, "save-nutrition");
    }

    private async saveChecklistStore(incoming: ChecklistStore): Promise<ChecklistStore> {
        return this.enqueueMutation(async () => {
            const current = await this.loadChecklistStore();
            const next = parseChecklistStore(incoming);
            if (!next) throw new Error("Checklist 配置无法识别，已停止保存。");
            if (next.revision <= current.revision) next.revision = current.revision + 1;
            next.updatedAt = Date.now();
            log.verbose("checklist", "checklist.backup.rotate", { revision: current.revision, nextRevision: next.revision });
            await this.saveChecklistAndVerify(checklistBackupFileForRevision(current.revision), current, "backup");
            await this.saveChecklistAndVerify(CHECKLIST_STORE_FILE, next);
            return cloneChecklistStore(next);
        }, "save-checklist");
    }

    private async saveDailyRecord(record: DailyRecord): Promise<DailyRecordStore> {
        return this.enqueueMutation(async () => {
            const current = await this.loadDailyStore();
            const next = upsertDailyRecord(current, record);
            log.verbose("daily", "daily.backup.rotate", { revision: current.revision, nextRevision: next.revision });
            await this.saveDailyAndVerify(dailyBackupFileForRevision(current.revision), current, "backup");
            await this.saveDailyAndVerify(DAILY_STORE_FILE, next);
            return next;
        }, "save-daily");
    }

    /**
     * 串行写队列：所有写操作依次经过这里，避免并发保存互相覆盖。
     * 队列本身只记"入队/完成"两个事件（verbose），出问题时能看出是不是排队或失败拖慢了保存。
     */
    private enqueueMutation<T>(action: () => Promise<T>, label = "mutation"): Promise<T> {
        log.verbose("store", "store.queue.enqueue", { action: label });
        const result = this.mutationQueue.then(action, action);
        this.mutationQueue = result.then(() => undefined, () => undefined);
        return result.then(
            (value) => {
                log.verbose("store", "store.queue.done", { action: label, ok: true });
                return value;
            },
            (error) => {
                log.warn("store", "store.queue.done", { action: label, ok: false, err: describeError(error) });
                throw error;
            },
        );
    }

    private async loadInternalStoreOrMigrate(): Promise<InternalWorkItemStore> {
        await this.settingsReady;
        let raw: unknown;
        try {
            raw = await this.loadData(INTERNAL_STORE_FILE);
        } catch (error) {
            log.error("store", "store.load.fail", { file: INTERNAL_STORE_FILE, err: describeError(error) });
            throw new Error(`插件内部数据读取失败：${errorMessage(error)}`);
        }
        const primary = parseInternalStore(raw);
        if (primary) {
            log.verbose("store", "store.load.ok", { file: INTERNAL_STORE_FILE, revision: primary.revision, items: primary.items.length });
            return primary;
        }
        log.warn("store", "store.parse.failed", { file: INTERNAL_STORE_FILE, absent: isAbsentInternalStore(raw) });

        const slots = [1, 2, 3];
        const backups = await Promise.all(slots.map(async (slot) => {
            const file = `work-items.backup-${slot}.json`;
            try {
                const parsed = parseInternalStore(await this.loadData(file));
                log.verbose("store", "store.backup.read", { file, usable: Boolean(parsed), revision: parsed?.revision ?? null });
                return parsed ? { file, store: parsed } : null;
            } catch (error) {
                log.verbose("store", "store.backup.read", { file, usable: false, err: describeError(error) });
                return null;
            }
        }));
        const valid = backups.filter((candidate): candidate is { file: string; store: InternalWorkItemStore } => Boolean(candidate))
            .sort((a, b) => b.store.revision - a.store.revision);
        const recovered = valid[0];
        if (recovered) {
            log.warn("store", "store.recover.fromBackup", {
                file: INTERNAL_STORE_FILE,
                backup: recovered.file,
                revision: recovered.store.revision,
                items: recovered.store.items.length,
                candidates: valid.length,
            });
            await this.saveAndVerify(INTERNAL_STORE_FILE, recovered.store);
            console.warn(`行舟已从第 ${recovered.store.revision} 版内部备份恢复数据。`);
            return recovered.store;
        }

        if (!isAbsentInternalStore(raw)) {
            // 最关键的一条：主文件与三个备份都不可识别时停止写入，绝不能静默覆盖
            log.error("store", "store.write.stopped", {
                file: INTERNAL_STORE_FILE,
                reason: "主文件与三个轮换备份均不可识别，为避免覆盖已停止写入",
                backupsChecked: slots.length,
            });
            throw new Error("插件内部数据文件无法识别，且三个轮换备份均不可用。为避免覆盖，行舟已停止写入。");
        }

        const initial = await this.importLegacyData();
        await this.saveAndVerify(MIGRATION_SNAPSHOT_FILE, initial);
        await this.saveAndVerify(INTERNAL_STORE_FILE, initial);
        return initial;
    }

    private async importLegacyData(): Promise<InternalWorkItemStore> {
        let legacy: WorkItemData;
        try {
            legacy = await loadWorkItems(this.settings.attributeViewId);
        } catch (error) {
            log.warn("store", "store.legacy.missing", {
                attributeViewId: this.settings.attributeViewId,
                err: describeError(error),
            });
            console.warn("未找到可导入的旧属性视图，行舟将建立空的内部数据仓库。", error);
            return createEmptyInternalStore();
        }
        let dependencyStorage = normalizeDependencyStorage(null);
        try {
            dependencyStorage = normalizeDependencyStorage(await this.loadData(DEPENDENCIES_FILE));
        } catch (error) {
            log.warn("store", "store.legacy.dependencies.failed", { err: describeError(error) });
            console.warn("旧版跨项目依赖读取失败；其余工作项仍会迁移。", error);
        }
        const migrated = migrateWorkItemData(applyDependencyStorage(legacy, dependencyStorage));
        log.info("store", "store.legacy.imported", { items: migrated.items.length, source: this.settings.attributeViewId });
        console.info(`行舟已将旧属性视图中的 ${migrated.items.length} 个工作项一次性迁移到插件内部。`);
        return migrated;
    }

    /**
     * 内部数据的固定写序：先轮换上一版到备份槽位，再写主文件，最后各自复核。
     * 每一步都留日志，出问题时能看出是哪一步没走完。
     */
    private async persistStore(previous: InternalWorkItemStore, next: InternalWorkItemStore): Promise<void> {
        const backupFile = backupFileForRevision(previous.revision);
        log.verbose("store", "store.backup.rotate", {
            file: backupFile,
            revision: previous.revision,
            items: previous.items.length,
        });
        await this.saveAndVerify(backupFile, previous, "backup");
        await this.saveAndVerify(INTERNAL_STORE_FILE, next, "primary");
    }

    private async loadDailyStore(): Promise<DailyRecordStore> {
        let raw: unknown;
        try {
            raw = await this.loadData(DAILY_STORE_FILE);
        } catch (error) {
            log.error("daily", "daily.load.fail", { file: DAILY_STORE_FILE, err: describeError(error) });
            throw new Error(`生活节律数据读取失败：${errorMessage(error)}`);
        }
        const primary = parseDailyStore(raw);
        if (primary) {
            log.verbose("daily", "daily.load.ok", { file: DAILY_STORE_FILE, revision: primary.revision, records: primary.records.length });
            return primary;
        }
        log.warn("daily", "daily.parse.failed", { file: DAILY_STORE_FILE, absent: isAbsentInternalStore(raw) });

        const slots = [1, 2, 3];
        const backups = await Promise.all(slots.map(async (slot) => {
            const file = `daily-records.backup-${slot}.json`;
            try {
                const parsed = parseDailyStore(await this.loadData(file));
                log.verbose("daily", "daily.backup.read", { file, usable: Boolean(parsed), revision: parsed?.revision ?? null });
                return parsed ? { file, store: parsed } : null;
            } catch (error) {
                log.verbose("daily", "daily.backup.read", { file, usable: false, err: describeError(error) });
                return null;
            }
        }));
        const valid = backups.filter((candidate): candidate is { file: string; store: DailyRecordStore } => Boolean(candidate))
            .sort((a, b) => b.store.revision - a.store.revision);
        const recovered = valid[0];
        if (recovered) {
            log.warn("daily", "daily.recover.fromBackup", {
                file: DAILY_STORE_FILE,
                backup: recovered.file,
                revision: recovered.store.revision,
                records: recovered.store.records.length,
                candidates: valid.length,
            });
            await this.saveDailyAndVerify(DAILY_STORE_FILE, recovered.store);
            console.warn(`行舟已从第 ${recovered.store.revision} 版生活节律备份恢复数据。`);
            return recovered.store;
        }
        if (!isAbsentInternalStore(raw)) {
            log.error("daily", "daily.write.stopped", {
                file: DAILY_STORE_FILE,
                reason: "主文件与三个轮换备份均不可识别，为避免覆盖已停止写入",
                backupsChecked: slots.length,
            });
            throw new Error("生活节律数据文件无法识别，且三个轮换备份均不可用。为避免覆盖，行舟已停止写入。");
        }
        const initial = createEmptyDailyStore();
        await this.saveDailyAndVerify(DAILY_STORE_FILE, initial);
        return initial;
    }

    private async loadChecklistStore(): Promise<ChecklistStore> {
        let raw: unknown;
        try {
            raw = await this.loadData(CHECKLIST_STORE_FILE);
        } catch (error) {
            log.error("checklist", "checklist.load.fail", { file: CHECKLIST_STORE_FILE, err: describeError(error) });
            throw new Error(`Checklist 配置读取失败：${errorMessage(error)}`);
        }
        const primary = parseChecklistStore(raw);
        if (primary) {
            log.verbose("checklist", "checklist.load.ok", {
                file: CHECKLIST_STORE_FILE,
                revision: primary.revision,
                templates: primary.templates.length,
                days: primary.dayStates.length,
            });
            return primary;
        }
        log.warn("checklist", "checklist.parse.failed", { file: CHECKLIST_STORE_FILE, absent: isAbsentInternalStore(raw) });

        const slots = [1, 2, 3];
        const backups = await Promise.all(slots.map(async (slot) => {
            const file = `checklist.backup-${slot}.json`;
            try {
                const parsed = parseChecklistStore(await this.loadData(file));
                log.verbose("checklist", "checklist.backup.read", { file, usable: Boolean(parsed), revision: parsed?.revision ?? null });
                return parsed ? { file, store: parsed } : null;
            } catch (error) {
                log.verbose("checklist", "checklist.backup.read", { file, usable: false, err: describeError(error) });
                return null;
            }
        }));
        const valid = backups.filter((candidate): candidate is { file: string; store: ChecklistStore } => Boolean(candidate))
            .sort((a, b) => b.store.revision - a.store.revision);
        const recovered = valid[0];
        if (recovered) {
            log.warn("checklist", "checklist.recover.fromBackup", {
                file: CHECKLIST_STORE_FILE,
                backup: recovered.file,
                revision: recovered.store.revision,
                candidates: valid.length,
            });
            await this.saveChecklistAndVerify(CHECKLIST_STORE_FILE, recovered.store);
            console.warn(`行舟已从第 ${recovered.store.revision} 版 Checklist 备份恢复配置。`);
            return recovered.store;
        }
        if (!isAbsentInternalStore(raw)) {
            log.error("checklist", "checklist.write.stopped", {
                file: CHECKLIST_STORE_FILE,
                reason: "主文件与三个轮换备份均不可识别，为避免覆盖已停止写入",
                backupsChecked: slots.length,
            });
            throw new Error("Checklist 配置文件无法识别，且三个轮换备份均不可用。为避免覆盖，行舟已停止写入。");
        }
        const initial = createDefaultChecklistStore();
        await this.saveChecklistAndVerify(CHECKLIST_STORE_FILE, initial);
        return initial;
    }

    private async loadNutritionStore(): Promise<NutritionStore> {
        let raw: unknown;
        try {
            raw = await this.loadData(NUTRITION_STORE_FILE);
        } catch (error) {
            log.error("nutrition", "nutrition.load.fail", { file: NUTRITION_STORE_FILE, err: describeError(error) });
            throw new Error(`营养记录读取失败：${errorMessage(error)}`);
        }
        const primary = parseNutritionStore(raw);
        if (primary) {
            log.verbose("nutrition", "nutrition.load.ok", { file: NUTRITION_STORE_FILE, revision: primary.revision });
            return primary;
        }
        log.warn("nutrition", "nutrition.parse.failed", { file: NUTRITION_STORE_FILE, absent: isAbsentInternalStore(raw) });

        const slots = [1, 2, 3];
        const backups = await Promise.all(slots.map(async (slot) => {
            const file = `nutrition.backup-${slot}.json`;
            try {
                const parsed = parseNutritionStore(await this.loadData(file));
                log.verbose("nutrition", "nutrition.backup.read", { file, usable: Boolean(parsed), revision: parsed?.revision ?? null });
                return parsed ? { file, store: parsed } : null;
            } catch (error) {
                log.verbose("nutrition", "nutrition.backup.read", { file, usable: false, err: describeError(error) });
                return null;
            }
        }));
        const valid = backups.filter((candidate): candidate is { file: string; store: NutritionStore } => Boolean(candidate))
            .sort((a, b) => b.store.revision - a.store.revision);
        const recovered = valid[0];
        if (recovered) {
            log.warn("nutrition", "nutrition.recover.fromBackup", {
                file: NUTRITION_STORE_FILE,
                backup: recovered.file,
                revision: recovered.store.revision,
                candidates: valid.length,
            });
            await this.saveNutritionAndVerify(NUTRITION_STORE_FILE, recovered.store);
            console.warn(`行舟已从第 ${recovered.store.revision} 版营养记录备份恢复数据。`);
            return recovered.store;
        }
        if (!isAbsentInternalStore(raw)) {
            log.error("nutrition", "nutrition.write.stopped", {
                file: NUTRITION_STORE_FILE,
                reason: "主文件与三个轮换备份均不可识别，为避免覆盖已停止写入",
                backupsChecked: slots.length,
            });
            throw new Error("营养记录文件无法识别，且三个轮换备份均不可用。为避免覆盖，行舟已停止写入。");
        }
        const initial = createEmptyNutritionStore();
        await this.saveNutritionAndVerify(NUTRITION_STORE_FILE, initial);
        return initial;
    }

    /**
     * 写后复核的统一实现：写 → 重新读取 → 解析 → 完整比对，任何一步失败都留下日志。
     * role 区分主文件与轮换备份，便于看出"备份写成功但主文件没写"这类半途状态。
     */
    private async writeAndVerify<TStore>(options: {
        scope: string;
        file: string;
        role: "primary" | "backup";
        store: TStore;
        revision: number;
        parse: (value: unknown) => TStore | null;
        matches: (expected: TStore, actual: TStore) => boolean;
        describeMismatch?: (expected: TStore, actual: TStore) => string;
    }): Promise<void> {
        const { scope, file, role, store, revision } = options;
        let bytes = 0;
        try {
            bytes = JSON.stringify(store)?.length ?? 0;
        } catch {
            bytes = 0;
        }
        log.verbose(scope, `${scope}.write.start`, { file, role, revision, bytes });
        const response = await this.saveData(file, store);
        if (response.code !== 0) {
            log.error(scope, `${scope}.write.fail`, { file, role, revision, code: response.code, err: response.msg || "保存被思源拒绝" });
            throw new Error(response.msg || `无法保存 ${file}。`);
        }
        log.verbose(scope, `${scope}.write.ok`, { file, role, revision, bytes });
        const verified = options.parse(await this.loadData(file));
        if (!verified) {
            log.error(scope, `${scope}.verify.fail`, { file, role, revision, reason: "写回内容无法解析" });
            throw new Error(reasonForMissingVerify(scope, file));
        }
        if (!options.matches(store, verified)) {
            // 差异描述只在真的需要记录时才计算
            const diff = log.isEnabled(scope, "error") && options.describeMismatch
                ? options.describeMismatch(store, verified)
                : "";
            log.error(scope, `${scope}.verify.fail`, {
                file,
                role,
                revision,
                reason: "写回内容与写入值不一致",
                ...(diff ? { diff } : {}),
            });
            throw new Error(reasonForVerifyMismatch(scope, file, diff));
        }
        log.verbose(scope, `${scope}.verify.pass`, { file, role, revision, bytes });
    }

    private async saveAndVerify(file: string, store: InternalWorkItemStore, role: "primary" | "backup" = "primary"): Promise<void> {
        await this.writeAndVerify({
            scope: "store",
            file,
            role,
            store,
            revision: store.revision,
            parse: parseInternalStore,
            matches: storesMatch,
            describeMismatch: describeStoreMismatch,
        });
    }

    private async saveDailyAndVerify(file: string, store: DailyRecordStore, role: "primary" | "backup" = "primary"): Promise<void> {
        await this.writeAndVerify({
            scope: "daily",
            file,
            role,
            store,
            revision: store.revision,
            parse: parseDailyStore,
            matches: dailyStoresMatch,
        });
    }

    private async saveChecklistAndVerify(file: string, store: ChecklistStore, role: "primary" | "backup" = "primary"): Promise<void> {
        await this.writeAndVerify({
            scope: "checklist",
            file,
            role,
            store,
            revision: store.revision,
            parse: parseChecklistStore,
            matches: checklistStoresMatch,
        });
    }

    private async saveNutritionAndVerify(file: string, store: NutritionStore, role: "primary" | "backup" = "primary"): Promise<void> {
        await this.writeAndVerify({
            scope: "nutrition",
            file,
            role,
            store,
            revision: store.revision,
            parse: parseNutritionStore,
            matches: nutritionStoresMatch,
        });
    }

    private configureSettings(): void {
        let avInput: HTMLInputElement | undefined;
        let blockInput: HTMLInputElement | undefined;
        this.setting = new Setting({
            width: "640px",
            confirmCallback: () => {
                const previous = this.settings;
                this.settings = normalizeSettings({
                    attributeViewId: avInput?.value,
                    databaseBlockId: blockInput?.value,
                    log: previous.log,
                });
                log.info("settings", "settings.changed", {
                    attributeViewId: this.settings.attributeViewId,
                    databaseBlockId: this.settings.databaseBlockId,
                    changed: this.settings.attributeViewId !== previous.attributeViewId || this.settings.databaseBlockId !== previous.databaseBlockId,
                });
                void this.saveSettings().then(() => {
                    showMessage(this.i18n.saved || "设置已保存");
                });
            },
        });
        this.setting.addItem({
            title: this.i18n.attributeViewId || "旧属性视图 ID",
            description: this.i18n.attributeViewIdDescription || "仅在尚未建立内部数据时，用作一次性旧数据导入来源。",
            createActionElement: () => {
                avInput = createTextInput(this.settings.attributeViewId);
                return avInput;
            },
        });
        this.setting.addItem({
            title: this.i18n.databaseBlockId || "旧数据库块 ID",
            description: this.i18n.databaseBlockIdDescription || "仅保留旧数据来源位置；迁移完成后不参与数据读写。",
            createActionElement: () => {
                blockInput = createTextInput(this.settings.databaseBlockId);
                return blockInput;
            },
        });
    }

    private async loadSettings(): Promise<void> {
        try {
            this.settings = normalizeSettings(await this.loadData(SETTINGS_FILE));
            log.configure(this.settings.log);
            log.info("settings", "settings.load.ok", {
                minLevel: this.settings.log.minLevel,
                bufferSize: this.settings.log.bufferSize,
                scopes: Object.keys(this.settings.log.scopes).length,
            });
            await this.loadKernelVersion();
        } catch (error) {
            log.warn("settings", "settings.load.failed", { err: describeError(error) });
            console.warn("行舟设置读取失败，将使用默认的旧数据导入来源。", error);
            this.settings = { ...DEFAULT_SETTINGS, log: { ...DEFAULT_SETTINGS.log } };
            log.configure(this.settings.log);
        }
    }

    /**
     * 记录思源内核版本：导出的日志要能说明"当时跑在哪个版本上"。
     * 拿不到也不影响任何功能，只记一条 verbose。
     */
    private async loadKernelVersion(): Promise<void> {
        try {
            const version = await requestSiYuan<string>("/api/system/version", {});
            this.kernelVersion = typeof version === "string" ? version : String(version ?? "");
            log.verbose("lifecycle", "kernel.version", { version: this.kernelVersion });
        } catch (error) {
            log.verbose("lifecycle", "kernel.version.failed", { err: describeError(error) });
        }
    }

    /** 设置（含日志级别）统一写回：调用方负责何时触发，失败要留痕。 */
    private async saveSettings(): Promise<void> {
        try {
            const response = await this.saveData(SETTINGS_FILE, this.settings);
            if (response.code !== 0) {
                log.warn("settings", "settings.save.failed", { code: response.code, err: response.msg || "保存被思源拒绝" });
                return;
            }
            log.info("settings", "settings.save.ok", {
                minLevel: this.settings.log.minLevel,
                bufferSize: this.settings.log.bufferSize,
            });
        } catch (error) {
            log.warn("settings", "settings.save.failed", { err: describeError(error) });
        }
    }

    /** 项目视图状态（非关键 UI 数据）：损坏/缺失时返回 null，由界面回落默认。 */
    private async loadProjectViewState(): Promise<WorkItemViewState | null> {
        try {
            // 等待挂起中的保存完成，避免“关闭页签→立即重开”时读到旧文件
            await this.viewStateSaveQueue;
            const raw: unknown = await this.loadData(UI_STATE_FILE);
            const state = parseViewStateFile(raw);
            log.verbose("ui", "ui.viewState.load", { usable: Boolean(state), page: state?.page ?? null });
            return state;
        } catch (error) {
            log.verbose("ui", "ui.viewState.load", { usable: false, err: describeError(error) });
            return null;
        }
    }

    private async saveProjectViewState(state: WorkItemViewState): Promise<void> {
        this.viewStateSaveQueue = this.viewStateSaveQueue.then(async () => {
            try {
                await this.saveData(UI_STATE_FILE, wrapViewStateFile(state));
                log.verbose("ui", "ui.viewState.save", { page: state.page, filter: state.filter });
            } catch (error) {
                // UI 状态非关键数据，保存失败不影响其他功能，但要留下痕迹
                log.verbose("ui", "ui.viewState.save.failed", { err: describeError(error) });
            }
        }).catch(() => undefined);
        return this.viewStateSaveQueue;
    }

    /** 趋势视图设置（非关键 UI 数据）：独立文件，损坏或字段非法时逐字段回落默认。 */
    private async loadTrendViewState(): Promise<TrendViewSettings | null> {
        try {
            await this.trendViewSaveQueue;
            const raw: unknown = await this.loadData(TREND_VIEW_FILE);
            const state = parseTrendViewFile(raw);
            log.verbose("ui", "ui.trendView.load", { usable: Boolean(state), metrics: state?.metricIds.length ?? 0 });
            return state;
        } catch (error) {
            log.verbose("ui", "ui.trendView.load", { usable: false, err: describeError(error) });
            return null;
        }
    }

    private async saveTrendViewState(state: TrendViewSettings): Promise<void> {
        this.trendViewSaveQueue = this.trendViewSaveQueue.then(async () => {
            try {
                await this.saveData(TREND_VIEW_FILE, wrapTrendViewFile(state));
                log.verbose("ui", "ui.trendView.save", { metrics: state.metricIds.length, range: state.range });
            } catch (error) {
                // 非关键数据：失败只留痕，不影响任何正式数据写入
                log.verbose("ui", "ui.trendView.save.failed", { err: describeError(error) });
            }
        }).catch(() => undefined);
        return this.trendViewSaveQueue;
    }
}

function createTextInput(value: string): HTMLInputElement {
    const input = document.createElement("input");
    input.className = "b3-text-field fn__size200";
    input.value = value;
    input.spellcheck = false;
    return input;
}

function createInternalItemId(): string {
    const lute = (globalThis as typeof globalThis & { Lute?: { NewNodeID?: () => string } }).Lute;
    if (typeof lute?.NewNodeID === "function") return lute.NewNodeID();
    const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 9).padEnd(7, "0");
    return `${timestamp}-${random}`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const VERIFY_REASONS: Record<string, { parse: string; mismatch: string }> = {
    store: { parse: "内部数据", mismatch: "内部数据" },
    daily: { parse: "生活节律数据", mismatch: "生活节律数据" },
    checklist: { parse: "Checklist 配置", mismatch: "Checklist 配置" },
    nutrition: { parse: "营养记录", mismatch: "营养记录" },
};

function reasonForMissingVerify(scope: string, file: string): string {
    const label = VERIFY_REASONS[scope]?.parse ?? scope;
    return `${label}写入 ${file} 后无法重新读取解析。`;
}

function reasonForVerifyMismatch(scope: string, file: string, diff: string): string {
    const label = VERIFY_REASONS[scope]?.mismatch ?? scope;
    return `${label}写入 ${file} 后未通过完整性复核。${diff ? ` ${diff}` : ""}`;
}

/** 右键菜单：复制原图，并按结果给出精确反馈（成功带尺寸与体积，失败说明原因）。 */
async function copyActionImage(image: ActionImageCopyTarget): Promise<void> {
    const result = await copyImageToClipboard(image);
    showMessage(imageCopyMessage(result), result.ok ? 4000 : 6000);
}

/** 右键菜单：复制 assets/… 资源路径，便于在文字里引用同一张图。 */
async function copyActionImagePath(image: ActionImageCopyTarget): Promise<void> {
    const result = await copyImagePathToClipboard(image.src);
    showMessage(imagePathCopyMessage(result), result.ok ? 4000 : 6000);
}

function renderMountError(target: HTMLElement, error: unknown): void {
    const panel = document.createElement("div");
    panel.className = "xingzhou-mount-error";

    const title = document.createElement("h2");
    title.textContent = "行舟界面启动失败";
    const description = document.createElement("p");
    description.textContent = "请重新加载插件；如果问题仍然存在，请把下面的错误信息发给开发者。";
    const details = document.createElement("code");
    details.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    panel.append(title, description, details);
    target.replaceChildren(panel);
}
