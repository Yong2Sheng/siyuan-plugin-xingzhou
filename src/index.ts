import { openTab, Plugin, Setting, showMessage, type Custom, type Tab } from "siyuan";
import XingzhouApp from "./XingzhouApp.svelte";
import { DEFAULT_SETTINGS, normalizeSettings, type XingzhouSettings } from "./config";
import { loadWorkItems } from "./work-items";
import "./index.scss";

const SETTINGS_FILE = "settings.json";
const TAB_TYPE = "xingzhou-center";
const ICON_ID = "iconXingzhou";
const ICON = `<symbol id="${ICON_ID}" viewBox="0 0 24 24">
    <path d="M3 13.5h18l-3.2 5H6.2L3 13.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M12 3v10M12 4.2l5.2 6H12M10 19.5c1.2 1 2.8 1.5 4.5 1.5 1.8 0 3.4-.6 4.5-1.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</symbol>`;

type AppInstance = {
    component: XingzhouApp;
};

export default class XingzhouPlugin extends Plugin {
    private settings: XingzhouSettings = { ...DEFAULT_SETTINGS };
    private readonly instances = new Map<Custom, AppInstance>();
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
        this.currentTab?.close();
        this.currentTab = undefined;
    }

    private registerTab(): void {
        const plugin = this;
        this.addTab({
            type: TAB_TYPE,
            init(this: Custom) {
                if (!(this.element instanceof HTMLElement) || plugin.stopped) return;
                const component = new XingzhouApp({
                    target: this.element,
                    props: {
                        load: () => loadWorkItems(plugin.settings.attributeViewId),
                        openDocument: (blockId: string) => plugin.openBlock(blockId),
                        openDatabase: () => plugin.openNativeDatabase(),
                    },
                });
                plugin.instances.set(this, { component });
                plugin.currentTab = this.tab;
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
                id: `${this.name}-${TAB_TYPE}`,
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
