import { Dialog, Menu, openTab, Plugin, Setting, showMessage, type Custom, type Tab } from "siyuan";
import XingzhouApp from "./XingzhouApp.svelte";
import { showCaptureDialog, type CaptureDialogRequest } from "./capture-dialog";
import { DEFAULT_SETTINGS, normalizeSettings, type XingzhouSettings } from "./config";
import { getXingzhouTabId, XINGZHOU_TAB_TYPE } from "./tab-id";
import { captureInboxItem, deleteWorkItem, loadWorkItems, updateWorkItem, type InboxCaptureOptions } from "./work-items";
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
    component: XingzhouApp;
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

    onload(): void {
        this.addIcons(ICON);
        this.registerTab();
        this.configureSettings();
        void this.loadSettings();
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
                mount.setAttribute("aria-label", "行舟 · 个人项目与事务中心");
                mount.textContent = "行舟正在启动……";
                target.replaceChildren(mount);

                try {
                    mount.textContent = "";
                    const component = new XingzhouApp({
                        target: mount,
                        props: {
                            load: () => loadWorkItems(plugin.settings.attributeViewId),
                            captureInbox: (title: string, options?: InboxCaptureOptions) => captureInboxItem(
                                plugin.settings.attributeViewId,
                                plugin.settings.databaseBlockId,
                                title,
                                undefined,
                                options,
                            ),
                            saveItem: updateWorkItem,
                            deleteItem: deleteWorkItem,
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
                            openDatabase: () => plugin.openNativeDatabase(),
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
                title: this.i18n.centerTitle || "行舟 · 个人项目与事务中心",
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

    private async openNativeDatabase(): Promise<void> {
        if (!this.settings.databaseBlockId) {
            showMessage("尚未配置数据库块 ID。", 5000, "error");
            return;
        }
        await this.openBlock(this.settings.databaseBlockId);
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
            title: this.i18n.attributeViewId || "属性视图 ID",
            description: this.i18n.attributeViewIdDescription || "行舟只读取这个属性视图。",
            createActionElement: () => {
                avInput = createTextInput(this.settings.attributeViewId);
                return avInput;
            },
        });
        this.setting.addItem({
            title: this.i18n.databaseBlockId || "数据库块 ID",
            description: this.i18n.databaseBlockIdDescription || "用于打开原始数据库。",
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
            console.warn("行舟设置读取失败，将使用默认属性视图。", error);
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
