export async function fetchSyncPost(): Promise<{ code: number; msg: string; data: unknown }> {
    return { code: 0, msg: "", data: null };
}

/**
 * 插件基类替身：只保留测试需要的可写字段。
 * 真实宿主会注入 app/name/i18n；测试里由用例自行赋值或覆写 loadData/saveData。
 */
export class Plugin {
    app: unknown = {};
    name = "siyuan-plugin-xingzhou";
    i18n: Record<string, string> = {};
    version = "0.0.0-test";
    setting: unknown;
    eventBus: unknown;

    constructor(options: unknown = {}) {
        Object.assign(this, options);
    }

    addIcons(): void {}
    addTopBar(): HTMLElement {
        return document.createElement("div");
    }
    addTab(): void {}
    addStatusBar(): void {}
    async loadData(): Promise<unknown> {
        return undefined;
    }
    async saveData(): Promise<{ code: number; msg: string; data: null }> {
        return { code: 0, msg: "", data: null };
    }
    async removeData(): Promise<{ code: number; msg: string; data: null }> {
        return { code: 0, msg: "", data: null };
    }
}

/** 设置对话框替身：只记录注册项，供设置相关断言使用。 */
export class Setting {
    readonly items: unknown[] = [];
    constructor(public readonly options: unknown = {}) {}
    addItem(item: unknown): void {
        this.items.push(item);
    }
    open(): void {}
}

/** 右键菜单替身：记录新增项，便于断言入口是否存在。 */
export class Menu {
    readonly items: Array<{ label?: string; click?: () => void }> = [];
    constructor(public readonly id = "") {}
    addItem(item: { label?: string; click?: () => void }): void {
        this.items.push(item);
    }
    addSeparator(): void {}
    open(): void {}
}

export function openTab(): Promise<unknown> {
    return Promise.resolve({});
}

/** 测试用的对话框替身：在 document.body 中建立与思源一致的最小 DOM 结构。 */
export class Dialog {
    readonly element: HTMLElement;
    readonly dialogElement: HTMLElement;
    private readonly backdrop: HTMLDivElement;
    private readonly options: { destroyCallback?: () => void };

    constructor(options: { title?: string; content?: string | HTMLElement; destroyCallback?: () => void } = {}) {
        this.options = options;
        this.element = document.createElement("div");
        this.element.className = "b3-dialog";
        this.dialogElement = document.createElement("div");
        this.dialogElement.className = "b3-dialog__container";

        const header = document.createElement("div");
        header.className = "b3-dialog__header";
        const title = document.createElement("span");
        title.textContent = options.title ?? "";
        const close = document.createElement("button");
        close.className = "b3-dialog__close";
        close.type = "button";
        // 与思源一致：关闭按钮会销毁对话框（进而触发 destroyCallback）
        close.addEventListener("click", () => this.destroy());
        header.append(title, close);

        const body = document.createElement("div");
        body.className = "b3-dialog__body";
        if (typeof options.content === "string") body.innerHTML = options.content;
        else if (options.content) body.append(options.content);

        this.dialogElement.append(header, body);
        this.element.append(this.dialogElement);
        this.backdrop = document.createElement("div");
        this.backdrop.className = "b3-dialog__backdrop";
        this.backdrop.append(this.element);
        document.body.append(this.backdrop);
    }

    destroy(): void {
        if (!this.backdrop.isConnected) return;
        this.backdrop.remove();
        // 与思源一致：销毁时通知调用方（点窗口外关闭也走这里）
        this.options.destroyCallback?.();
    }
}

export function showMessage(message: string, timeout = 6000): void {
    const node = document.createElement("div");
    node.className = "b3-snackbar";
    node.dataset.message = message;
    node.dataset.timeout = String(timeout);
    document.body.append(node);
}
