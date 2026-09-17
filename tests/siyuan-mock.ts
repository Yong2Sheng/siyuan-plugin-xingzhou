export async function fetchSyncPost(): Promise<{ code: number; msg: string; data: unknown }> {
    return { code: 0, msg: "", data: null };
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
