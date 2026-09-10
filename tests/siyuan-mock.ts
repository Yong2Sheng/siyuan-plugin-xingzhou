export async function fetchSyncPost(): Promise<{ code: number; msg: string; data: unknown }> {
    return { code: 0, msg: "", data: null };
}

/** 测试用的对话框替身：在 document.body 中建立与思源一致的最小 DOM 结构。 */
export class Dialog {
    readonly element: HTMLElement;
    readonly dialogElement: HTMLElement;
    private readonly backdrop: HTMLDivElement;

    constructor(options: { title?: string; content?: string } = {}) {
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
        header.append(title, close);

        const body = document.createElement("div");
        body.className = "b3-dialog__body";
        body.innerHTML = options.content ?? "";

        this.dialogElement.append(header, body);
        this.element.append(this.dialogElement);
        this.backdrop = document.createElement("div");
        this.backdrop.className = "b3-dialog__backdrop";
        this.backdrop.append(this.element);
        document.body.append(this.backdrop);
    }

    destroy(): void {
        this.backdrop.remove();
    }
}

export function showMessage(message: string, timeout = 6000): void {
    const node = document.createElement("div");
    node.className = "b3-snackbar";
    node.dataset.message = message;
    node.dataset.timeout = String(timeout);
    document.body.append(node);
}
