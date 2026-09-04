import { Dialog, Menu, openTab, Plugin, Setting, showMessage, type Custom, type Tab } from "siyuan";
import AppShell from "./AppShell.svelte";
import { showCaptureDialog, type CaptureDialogRequest } from "./capture-dialog";
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
    addStoredWorkItem,
    backupFileForRevision,
    createEmptyInternalStore,
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
import { loadWorkItems, type InboxCaptureOptions, type WorkItem, type WorkItemChanges, type WorkItemData } from "./work-items";
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
    private settings: XingzhouSettings = { ...DEFAULT_SETTINGS };
    private readonly instances = new Map<Custom, AppInstance>();
    private readonly dialogs = new Set<Dialog>();
    private currentTab?: Tab;
    private opening?: Promise<Tab>;
    private topBar?: HTMLElement;
    private stopped = false;
    private settingsReady: Promise<void> = Promise.resolve();
    private mutationQueue: Promise<void> = Promise.resolve();

    onload(): void {
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
    }

    onunload(): void {
        this.stopped = true;
        this.topBar?.remove();
        this.topBar = undefined;
        for (const instance of this.instances.values()) instance.component.$destroy();
        this.instances.clear();
        for (const dialog of this.dialogs) dialog.destroy();
        this.dialogs.clear();
        this.currentTab?.close();
        this.currentTab = undefined;
    }

    private registerTab(): void {
        const plugin = this;
        this.addTab({
            type: XINGZHOU_TAB_TYPE,
            init(this: Custom) {
                if (plugin.stopped) return;

                const target = this.element;
                if (!target || typeof target.replaceChildren !== "function") {
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
                            openItemMenu: (event: MouseEvent, onDelete: () => void, addChild?: { label: string; onClick: () => void }) => {
                                event.preventDefault();
                                event.stopPropagation();
                                const menu = new Menu("xingzhou-work-item-actions-menu");
                                if (addChild) {
                                    menu.addItem({
                                        icon: "iconAdd",
                                        label: addChild.label,
                                        click: addChild.onClick,
                                    });
                                    menu.addSeparator();
                                }
                                menu.addItem({
                                    icon: "iconTrashcan",
                                    label: "删除工作项…",
                                    warning: true,
                                    click: () => onDelete(),
                                });
                                menu.open({ x: event.clientX, y: event.clientY });
                            },
                            openDocument: (blockId: string) => plugin.openBlock(blockId),
                            loadDaily: () => plugin.getDailyRecordsSnapshot(),
                            saveDaily: (record: DailyRecord) => plugin.saveDailyRecord(record),
                        },
                    });
                    plugin.instances.set(this, { component, mount });
                    plugin.currentTab = this.tab;
                } catch (error) {
                    console.error("行舟界面挂载失败。", error);
                    renderMountError(mount, error);
                }
            },
            destroy(this: Custom) {
                plugin.instances.get(this)?.component.$destroy();
                plugin.instances.delete(this);
                if (plugin.currentTab === this.tab) plugin.currentTab = undefined;
            },
        });
    }

    private async openCenter(): Promise<void> {
        if (this.currentTab) {
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
        } finally {
            this.opening = undefined;
        }
    }

    private async openBlock(blockId: string): Promise<void> {
        await openTab({
            app: this.app,
            doc: { id: blockId, action: ["cb-get-focus", "cb-get-hl"] },
            keepCursor: false,
        });
    }

    private async loadWorkItemData(): Promise<WorkItemData> {
        await this.settingsReady;
        await this.mutationQueue;
        return toInternalWorkItemData(await this.loadInternalStoreOrMigrate());
    }

    private async captureInternalItem(title: string, options: InboxCaptureOptions = {}): Promise<WorkItemData> {
        return this.enqueueMutation(async () => {
            const current = await this.loadInternalStoreOrMigrate();
            const next = addStoredWorkItem(current, title, createInternalItemId(), options);
            await this.persistStore(current, next);
            return toInternalWorkItemData(next);
        });
    }

    private async saveWorkItemData(_data: WorkItemData, item: WorkItem, changes: WorkItemChanges): Promise<WorkItemData> {
        return this.enqueueMutation(async () => {
            const current = await this.loadInternalStoreOrMigrate();
            const next = updateStoredWorkItem(current, item.id, changes);
            await this.persistStore(current, next);
            return toInternalWorkItemData(next);
        });
    }

    private async deleteWorkItemData(_data: WorkItemData, item: WorkItem): Promise<WorkItemData> {
        return this.enqueueMutation(async () => {
            const current = await this.loadInternalStoreOrMigrate();
            const next = removeStoredWorkItem(current, item.id);
            await this.persistStore(current, next);
            return toInternalWorkItemData(next);
        });
    }

    private async reorderWorkItemData(_data: WorkItemData, parentId: string | null, orderedIds: string[]): Promise<WorkItemData> {
        return this.enqueueMutation(async () => {
            const current = await this.loadInternalStoreOrMigrate();
            const next = reorderStoredWorkItems(current, parentId, orderedIds);
            await this.persistStore(current, next);
            return toInternalWorkItemData(next);
        });
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

    private async saveDailyRecord(record: DailyRecord): Promise<DailyRecordStore> {
        return this.enqueueMutation(async () => {
            const current = await this.loadDailyStore();
            const next = upsertDailyRecord(current, record);
            await this.saveDailyAndVerify(dailyBackupFileForRevision(current.revision), current);
            await this.saveDailyAndVerify(DAILY_STORE_FILE, next);
            return next;
        });
    }

    private enqueueMutation<T>(action: () => Promise<T>): Promise<T> {
        const result = this.mutationQueue.then(action, action);
        this.mutationQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    private async loadInternalStoreOrMigrate(): Promise<InternalWorkItemStore> {
        await this.settingsReady;
        let raw: unknown;
        try {
            raw = await this.loadData(INTERNAL_STORE_FILE);
        } catch (error) {
            throw new Error(`插件内部数据读取失败：${errorMessage(error)}`);
        }
        const primary = parseInternalStore(raw);
        if (primary) return primary;

        const backups = await Promise.all([1, 2, 3].map(async (slot) => {
            try {
                return parseInternalStore(await this.loadData(`work-items.backup-${slot}.json`));
            } catch {
                return null;
            }
        }));
        const recovered = backups.filter((candidate): candidate is InternalWorkItemStore => Boolean(candidate))
            .sort((a, b) => b.revision - a.revision)[0];
        if (recovered) {
            await this.saveAndVerify(INTERNAL_STORE_FILE, recovered);
            console.warn(`行舟已从第 ${recovered.revision} 版内部备份恢复数据。`);
            return recovered;
        }

        if (!isAbsentInternalStore(raw)) {
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
            console.warn("未找到可导入的旧属性视图，行舟将建立空的内部数据仓库。", error);
            return createEmptyInternalStore();
        }
        let dependencyStorage = normalizeDependencyStorage(null);
        try {
            dependencyStorage = normalizeDependencyStorage(await this.loadData(DEPENDENCIES_FILE));
        } catch (error) {
            console.warn("旧版跨项目依赖读取失败；其余工作项仍会迁移。", error);
        }
        const migrated = migrateWorkItemData(applyDependencyStorage(legacy, dependencyStorage));
        console.info(`行舟已将旧属性视图中的 ${migrated.items.length} 个工作项一次性迁移到插件内部。`);
        return migrated;
    }

    private async persistStore(previous: InternalWorkItemStore, next: InternalWorkItemStore): Promise<void> {
        await this.saveAndVerify(backupFileForRevision(previous.revision), previous);
        await this.saveAndVerify(INTERNAL_STORE_FILE, next);
    }

    private async loadDailyStore(): Promise<DailyRecordStore> {
        let raw: unknown;
        try {
            raw = await this.loadData(DAILY_STORE_FILE);
        } catch (error) {
            throw new Error(`生活节律数据读取失败：${errorMessage(error)}`);
        }
        const primary = parseDailyStore(raw);
        if (primary) return primary;

        const backups = await Promise.all([1, 2, 3].map(async (slot) => {
            try {
                return parseDailyStore(await this.loadData(`daily-records.backup-${slot}.json`));
            } catch {
                return null;
            }
        }));
        const recovered = backups.filter((candidate): candidate is DailyRecordStore => Boolean(candidate))
            .sort((a, b) => b.revision - a.revision)[0];
        if (recovered) {
            await this.saveDailyAndVerify(DAILY_STORE_FILE, recovered);
            console.warn(`行舟已从第 ${recovered.revision} 版生活节律备份恢复数据。`);
            return recovered;
        }
        if (!isAbsentInternalStore(raw)) {
            throw new Error("生活节律数据文件无法识别，且三个轮换备份均不可用。为避免覆盖，行舟已停止写入。");
        }
        const initial = createEmptyDailyStore();
        await this.saveDailyAndVerify(DAILY_STORE_FILE, initial);
        return initial;
    }

    private async saveAndVerify(file: string, store: InternalWorkItemStore): Promise<void> {
        const response = await this.saveData(file, store);
        if (response.code !== 0) throw new Error(response.msg || `无法保存 ${file}。`);
        const verified = parseInternalStore(await this.loadData(file));
        if (!verified || !storesMatch(store, verified)) {
            throw new Error(`内部数据写入 ${file} 后未通过完整性复核。`);
        }
    }

    private async saveDailyAndVerify(file: string, store: DailyRecordStore): Promise<void> {
        const response = await this.saveData(file, store);
        if (response.code !== 0) throw new Error(response.msg || `无法保存 ${file}。`);
        const verified = parseDailyStore(await this.loadData(file));
        if (!verified || !dailyStoresMatch(store, verified)) {
            throw new Error(`生活节律数据写入 ${file} 后未通过完整性复核。`);
        }
    }

    private configureSettings(): void {
        let avInput: HTMLInputElement | undefined;
        let blockInput: HTMLInputElement | undefined;
        this.setting = new Setting({
            width: "640px",
            confirmCallback: () => {
                this.settings = normalizeSettings({
                    attributeViewId: avInput?.value,
                    databaseBlockId: blockInput?.value,
                });
                void this.saveData(SETTINGS_FILE, this.settings).then(() => {
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
        } catch (error) {
            console.warn("行舟设置读取失败，将使用默认的旧数据导入来源。", error);
            this.settings = { ...DEFAULT_SETTINGS };
        }
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
