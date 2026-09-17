/**
 * 行动编辑器的现场诊断。
 *
 * 只做一件事：把所有可能移动光标或滚动位置的动作，按时间顺序记下来（含调用来源）。
 * 目的是在「我这台机器复现不出来」的情况下，拿到出问题那台机器上真实的事件序列。
 *
 * 记录内容：编辑框挂载／卸载、focus/blur、程序化写入 value、程序化修改选区、
 * 输入法合成、滚动位置变化，以及每条记录对应的调用栈（截断到最有用的三层）。
 */

export type ActionEditorDiagnosticEntry = {
    at: number;
    event: string;
    detail: string;
    stack?: string;
};

const MAX_ENTRIES = 600;
const entries: ActionEditorDiagnosticEntry[] = [];
let installed = false;
let startedAt = 0;

function isActionEditor(node: unknown): node is HTMLTextAreaElement {
    return node instanceof HTMLTextAreaElement && node.classList.contains("xz-action-editor");
}

function currentField(node: HTMLTextAreaElement): string {
    const label = node.getAttribute("aria-label") ?? "";
    return label === "下一步行动" ? "nextAction" : "currentAction";
}

function stackOf(depth = 4): string {
    const lines = (new Error().stack ?? "").split("\n").slice(2, 2 + depth);
    return lines.map((line) => line.trim().replace(/https?:\/\/[^)]+\//g, "")).join(" ⟵ ");
}

export function recordActionEditorEvent(event: string, detail = "", stack?: string) {
    entries.push({ at: startedAt === 0 ? 0 : Math.round(performance.now() - startedAt), event, detail, stack });
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

/** 幂等安装：只挂钩一次，只处理行动编辑器这两个 textarea。 */
export function installActionEditorDiagnostics() {
    if (installed || typeof window === "undefined") return;
    installed = true;
    startedAt = performance.now();

    const textareaPrototype = HTMLTextAreaElement.prototype;
    const valueDescriptor = Object.getOwnPropertyDescriptor(textareaPrototype, "value");
    if (valueDescriptor?.get && valueDescriptor.set) {
        Object.defineProperty(textareaPrototype, "value", {
            configurable: true,
            get() { return valueDescriptor.get!.call(this); },
            set(next) {
                if (isActionEditor(this)) {
                    recordActionEditorEvent("value 写入", `字段=${currentField(this)} 新长度=${String(next).length} 旧长度=${String(valueDescriptor.get!.call(this)).length}`, stackOf());
                }
                valueDescriptor.set!.call(this, next);
            },
        });
    }

    const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    if (scrollDescriptor?.get && scrollDescriptor.set) {
        Object.defineProperty(Element.prototype, "scrollTop", {
            configurable: true,
            get(this: Element) { return scrollDescriptor.get!.call(this); },
            set(this: Element, next: number) {
                const target = this;
                const isEditor = isActionEditor(target);
                const isPanel = target instanceof HTMLElement && target.classList.contains("xz-detail");
                if (isEditor || isPanel) {
                    const previous = scrollDescriptor.get!.call(this);
                    if (Math.abs(Number(next) - Number(previous)) >= 1) {
                        recordActionEditorEvent("滚动被设置", `${isEditor ? "编辑框" : "详情面板"} ${Math.round(Number(previous))} → ${Math.round(Number(next))}`, stackOf(5));
                    }
                }
                scrollDescriptor.set!.call(this, next);
            },
        });
    }

    const realSetSelectionRange = textareaPrototype.setSelectionRange;
    textareaPrototype.setSelectionRange = function (this: HTMLTextAreaElement, start: number, end: number, ...rest: unknown[]) {
        if (isActionEditor(this)) {
            recordActionEditorEvent("选区被设置", `字段=${currentField(this)} ${start}-${end}`, stackOf());
        }
        return (realSetSelectionRange as unknown as (...args: unknown[]) => void).call(this, start, end, ...rest);
    } as typeof textareaPrototype.setSelectionRange;

    const realFocus = HTMLTextAreaElement.prototype.focus;
    HTMLTextAreaElement.prototype.focus = function (this: HTMLTextAreaElement, ...args: unknown[]) {
        if (isActionEditor(this)) recordActionEditorEvent("focus()", `字段=${currentField(this)}`, stackOf());
        return (realFocus as unknown as (...a: unknown[]) => void).apply(this, args);
    };

    document.addEventListener("focusin", (event) => {
        const target = event.target;
        if (isActionEditor(target)) recordActionEditorEvent("focusin", `字段=${currentField(target)} 光标=${target.selectionStart}`);
    }, true);
    document.addEventListener("focusout", (event) => {
        const target = event.target;
        if (isActionEditor(target)) recordActionEditorEvent("focusout", `字段=${currentField(target)} 光标=${target.selectionStart}`);
    }, true);

    // 编辑框被创建／销毁 = 重新挂载：这是「光标落到末尾 + 视图回顶」的头号嫌疑
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of Array.from(mutation.addedNodes)) {
                if (isActionEditor(node)) recordActionEditorEvent("编辑框挂载", `字段=${currentField(node)} 初始长度=${node.value.length}`, stackOf(6));
            }
            for (const node of Array.from(mutation.removedNodes)) {
                if (isActionEditor(node)) recordActionEditorEvent("编辑框卸载", `字段=${currentField(node)}`);
            }
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

export function actionEditorDiagnostics(): ActionEditorDiagnosticEntry[] {
    return entries.slice();
}

export function clearActionEditorDiagnostics() {
    entries.length = 0;
    startedAt = performance.now();
}

export function formatActionEditorDiagnostics(): string {
    if (entries.length === 0) return "暂无记录：先复现一次问题，再回来复制。";
    return entries
        .map((entry) => {
            const head = `[${String(entry.at).padStart(6, " ")}ms] ${entry.event}${entry.detail ? ` · ${entry.detail}` : ""}`;
            return entry.stack ? `${head}\n        ${entry.stack}` : head;
        })
        .join("\n");
}
