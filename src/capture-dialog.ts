import { Dialog } from "siyuan";

export type CaptureDialogMode = "global" | "child" | "areaOrIdea" | "topProject" | "transaction";

export type CaptureDialogItem = {
    id: string;
    title: string;
    type: string;
};

export type CaptureDialogValues = {
    title: string;
    type?: string;
    areaId?: string;
};

export type CaptureDialogRequest = {
    mode: CaptureDialogMode;
    parent?: CaptureDialogItem;
    areas: CaptureDialogItem[];
    onSubmit: (values: CaptureDialogValues) => Promise<void>;
};

type NativeCaptureDialogOptions = CaptureDialogRequest & {
    onDestroy?: () => void;
};

const DIALOG_COPY: Record<CaptureDialogMode, { title: string; description: string; submit: string }> = {
    global: {
        title: "添加到收件箱",
        description: "这里只需要一个名称；类型、层级和日期可以稍后再补。",
        submit: "加入收件箱",
    },
    child: {
        title: "添加下级工作项",
        description: "上层工作项已经自动带入；新条目仍从收件箱状态开始，之后可以继续整理。",
        submit: "创建下级",
    },
    areaOrIdea: {
        title: "添加长期领域或想法",
        description: "选择这是持续关注的长期领域，还是暂时独立保存的想法。",
        submit: "创建",
    },
    topProject: {
        title: "添加顶层项目",
        description: "“项目”是数据库类型；没有项目型上层工作项时，它在行舟中就是顶层项目。",
        submit: "创建顶层项目",
    },
    transaction: {
        title: "添加独立事务",
        description: "直接建立一个没有上层工作项的事务。",
        submit: "创建独立事务",
    },
};

export function showCaptureDialog(options: NativeCaptureDialogOptions): Dialog {
    const copy = DIALOG_COPY[options.mode];
    const dialog = new Dialog({
        title: copy.title,
        width: "520px",
        disableClose: true,
        hideCloseIcon: true,
        content: `<form class="xz-native-capture-form">
            <p class="xz-native-capture-form__description" data-field="description"></p>
            <label class="b3-label">
                <span>名称</span>
                <input class="b3-text-field fn__block" data-field="title" type="text" autocomplete="off" placeholder="现在想到什么？">
            </label>
            <label class="b3-label fn__none" data-row="type">
                <span>工作项类型</span>
                <select class="b3-select fn__block" data-field="type"></select>
            </label>
            <div class="b3-label fn__none" data-row="role">
                <span>层级角色</span>
                <div class="xz-native-capture-form__value" data-field="role"></div>
            </div>
            <label class="b3-label fn__none" data-row="area">
                <span>所属长期领域（可选）</span>
                <select class="b3-select fn__block" data-field="area"></select>
            </label>
            <div class="b3-label fn__none" data-row="parent">
                <span>上层工作项</span>
                <div class="xz-native-capture-form__value" data-field="parent"></div>
            </div>
            <div class="b3-label fn__none xz-native-capture-form__error" data-field="error" role="alert"></div>
            <div class="b3-dialog__action">
                <button class="b3-button b3-button--cancel" data-action="cancel" type="button">取消</button>
                <button class="b3-button b3-button--text" data-action="submit" type="submit"></button>
            </div>
        </form>`,
        destroyCallback: options.onDestroy,
    });

    const form = requireElement<HTMLFormElement>(dialog.element, ".xz-native-capture-form");
    const description = requireElement<HTMLElement>(form, '[data-field="description"]');
    const titleInput = requireElement<HTMLInputElement>(form, '[data-field="title"]');
    const typeRow = requireElement<HTMLElement>(form, '[data-row="type"]');
    const typeSelect = requireElement<HTMLSelectElement>(form, '[data-field="type"]');
    const roleRow = requireElement<HTMLElement>(form, '[data-row="role"]');
    const roleValue = requireElement<HTMLElement>(form, '[data-field="role"]');
    const areaRow = requireElement<HTMLElement>(form, '[data-row="area"]');
    const areaSelect = requireElement<HTMLSelectElement>(form, '[data-field="area"]');
    const parentRow = requireElement<HTMLElement>(form, '[data-row="parent"]');
    const parentValue = requireElement<HTMLElement>(form, '[data-field="parent"]');
    const errorElement = requireElement<HTMLElement>(form, '[data-field="error"]');
    const cancelButton = requireElement<HTMLButtonElement>(form, '[data-action="cancel"]');
    const submitButton = requireElement<HTMLButtonElement>(form, '[data-action="submit"]');

    description.textContent = copy.description;
    submitButton.textContent = copy.submit;

    if (options.mode === "child") {
        show(typeRow);
        setOptions(typeSelect, ["项目", "任务", "事务", "想法"]);
        typeSelect.value = options.parent?.type === "长期领域" ? "项目" : "事务";
        show(parentRow);
        parentValue.textContent = options.parent?.title ?? "未指定";
    } else if (options.mode === "areaOrIdea") {
        show(typeRow);
        setOptions(typeSelect, ["长期领域", "想法"]);
    } else if (options.mode === "topProject") {
        show(roleRow);
        roleValue.textContent = "顶层项目（数据库类型：项目）";
        show(areaRow);
        appendOption(areaSelect, "", "不指定");
        for (const area of options.areas) appendOption(areaSelect, area.id, area.title);
    } else if (options.mode === "transaction") {
        show(roleRow);
        roleValue.textContent = "独立事务（数据库类型：事务）";
    }

    cancelButton.addEventListener("click", () => dialog.destroy());
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        void submit();
    });

    async function submit(): Promise<void> {
        const title = titleInput.value.trim();
        if (!title) {
            showError(errorElement, "请先填写名称。");
            titleInput.focus();
            return;
        }

        setDisabled(form, true);
        hideError(errorElement);
        submitButton.textContent = "正在保存并复核…";
        try {
            await options.onSubmit({
                title,
                type: options.mode === "child" || options.mode === "areaOrIdea" ? typeSelect.value : undefined,
                areaId: options.mode === "topProject" ? areaSelect.value : undefined,
            });
            dialog.destroy();
        } catch (error) {
            setDisabled(form, false);
            submitButton.textContent = copy.submit;
            showError(errorElement, error instanceof Error ? error.message : String(error));
        }
    }

    titleInput.focus();
    return dialog;
}

function requireElement<TElement extends Element>(root: ParentNode, selector: string): TElement {
    const element = root.querySelector<TElement>(selector);
    if (!element) throw new Error(`新增窗口缺少必要控件：${selector}`);
    return element;
}

function show(element: HTMLElement): void {
    element.classList.remove("fn__none");
}

function setOptions(select: HTMLSelectElement, values: string[]): void {
    for (const value of values) appendOption(select, value, value);
}

function appendOption(select: HTMLSelectElement, value: string, label: string): void {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
}

function setDisabled(form: HTMLFormElement, disabled: boolean): void {
    for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) {
        control.disabled = disabled;
    }
}

function hideError(element: HTMLElement): void {
    element.textContent = "";
    element.classList.add("fn__none");
}

function showError(element: HTMLElement, message: string): void {
    element.textContent = message;
    element.classList.remove("fn__none");
}
