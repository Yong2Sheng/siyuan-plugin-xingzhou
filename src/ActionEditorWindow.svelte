<script lang="ts">
    /**
     * 行动长文的大编辑窗口内容。
     *
     * 为什么单独做一个窗口：内联编辑时，编辑框挂载会改变卡片内部的版面，
     * 用户点击的那一行位置会先被挪走，再按新位置反推光标必然有偏差，看起来就是"跳一下"。
     * 放进浮层后，卡片完全不动，编辑框的坐标稳定，落点可以做到精确。
     *
     * 输入链路沿用已经验证过的规则：
     * - 值只在打开时写一次，输入期间不做任何程序化回写（保留拼音合成与原生撤销）；
     * - 列表编号只做最小就地替换；
     * - 支持粘贴/拖入图片。
     */
    import { formatImageBytes } from "./action-images";

    type EditorImageRow = {
        key: string;
        status: "uploading" | "done" | "failed";
        src: string;
        syntax: string;
        label: string;
        bytes: number | null;
        error: string;
    };

    export let label: string;
    export let initialValue: string;
    export let saving = false;
    export let error = "";
    export let restoredNotice = "";
    export let dragging = false;
    export let imageRows: EditorImageRow[] = [];
    export let imageTotal = 0;
    export let pendingUploads = 0;

    export let onInput: (value: string, selectionStart: number, composing: boolean) => void;
    export let onKeydown: (event: KeyboardEvent) => void;
    export let onPaste: (event: ClipboardEvent) => void;
    export let onDragover: (event: DragEvent) => void;
    export let onDragleave: (event: DragEvent) => void;
    export let onDrop: (event: DragEvent) => void;
    export let onRemoveImage: (syntax: string) => void;
    export let onSave: () => void;
    export let onCancel: () => void;
    export let onExplainImages: () => void;
    export let onImageContextMenu: (event: MouseEvent) => void;

    let node: HTMLTextAreaElement;
    let composing = false;
    let dropActive = false;
    /** 内容只在打开时写一次：输入期间不做任何程序化回写。 */
    let initialised = false;

    /**
     * 挂载即写入初始内容并把光标放到事先算好的落点。
     * 高度由 CSS 决定（填满窗口、内部滚动），组件不做任何测量，因此没有强制重排。
     */
    function setupEditor(element: HTMLTextAreaElement) {
        node = element;
        element.value = initialValue;
        const position = caretOffset === null ? element.value.length : Math.min(Math.max(caretOffset, 0), element.value.length);
        element.setSelectionRange(position, position);
        initialised = true;
        // 聚焦时禁止滚动：否则浏览器可能为了"显示光标"去滚动外层容器
        queueMicrotask(() => {
            element.focus({ preventScroll: true });
            element.setSelectionRange(position, position);
        });
    }

    export let caretOffset: number | null = null;

    /** 供窗口在需要时重新定位光标（例如诊断或外部变更后）。 */
    export function focusAt(offset: number | null) {
        if (!node) return;
        const position = offset === null ? node.value.length : Math.min(Math.max(offset, 0), node.value.length);
        node.setSelectionRange(position, position);
        node.focus({ preventScroll: true });
    }

    /** 程序化写入（插入图片、上传回填）：显式调用，输入期间不会有任何隐式回写。 */
    export function applyValue(value: string, caret: number) {
        if (!node || node.value === value) return;
        node.value = value;
        const position = Math.min(Math.max(caret, 0), value.length);
        node.setSelectionRange(position, position);
    }

    export function currentValue(): string {
        return node ? node.value : initialValue;
    }

    export function currentCaret(): number {
        return node ? node.selectionStart ?? 0 : 0;
    }

    function handleInput(event: Event) {
        if (!(event.target instanceof HTMLTextAreaElement)) return;
        onInput(event.target.value, event.target.selectionStart ?? 0, (event as InputEvent).isComposing);
    }
</script>

<div class="xz-action-editor-window">
    <div class="xz-action-editor-window__head">
        <strong>{label}</strong>
        <span>
            {saving ? "正在保存并复核…" : `${(node?.value ?? initialValue).length} 字 · ⌘/Ctrl+Enter 保存 · Esc 取消`}
        </span>
    </div>
    {#if restoredNotice}
        <p class="xz-action-hint xz-action-hint--restored">{restoredNotice}</p>
    {/if}
    <p class="xz-action-hint">
        {#if dragging}
            松开即可插入图片
        {:else}
            可直接粘贴截图或拖入图片，图片按原分辨率存入思源资源库。{pendingUploads > 0 ? `（${pendingUploads} 张上传中）` : ""}
        {/if}
    </p>
    <div
        class="xz-action-editor-window__dropzone"
        class:xz-action-editor-window__dropzone--active={dragging || dropActive}
        role="presentation"
        on:dragover={(event) => { dropActive = true; onDragover(event); }}
        on:dragleave={(event) => { dropActive = false; onDragleave(event); }}
        on:drop={(event) => { dropActive = false; onDrop(event); }}
    >
        <textarea
            use:setupEditor
            class="b3-text-field xz-action-editor-window__input"
            aria-label={label}
            spellcheck="false"
            on:input={handleInput}
            on:keydown={onKeydown}
            on:paste={onPaste}
            on:compositionstart={() => { composing = true; }}
            on:compositionend={() => { composing = false; }}
        ></textarea>
    </div>
    {#if error}<p class="xz-action-error" role="alert">{error}</p>{/if}
    {#if imageRows.length > 0}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="xz-action-images" on:contextmenu={onImageContextMenu}>
            {#each imageRows as row (row.key)}
                <div class="xz-action-images__item" class:xz-action-images__item--pending={row.status !== "done"} class:xz-action-images__item--failed={row.status === "failed"} title={row.error || row.label}>
                    {#if row.status === "done" && row.src}
                        <img class="xz-action-thumb" src={row.src} alt={row.label} loading="lazy" />
                    {:else if row.status === "failed"}
                        <span class="xz-action-images__state">上传失败</span>
                    {:else}
                        <span class="xz-action-images__state"><i class="xz-spinner"></i>上传中…</span>
                    {/if}
                    <button class="xz-action-images__remove" type="button" aria-label={`移除图片 ${row.label}`} title="从细则中移除" on:mousedown|preventDefault on:click|stopPropagation={() => onRemoveImage(row.syntax)}>×</button>
                    <small>{row.status === "failed" ? "重试请重新粘贴" : formatImageBytes(row.bytes ?? 0)}</small>
                </div>
            {/each}
        </div>
    {/if}
    <div class="xz-action-editor-window__foot">
        <span>🖼 {imageTotal} 张图 · 点别处不会关闭，保存请按 ⌘/Ctrl+Enter</span>
        <span class="xz-action-editor-window__actions">
            <button class="b3-button b3-button--outline" type="button" on:click={onExplainImages}>如何插入图片？</button>
            <button class="b3-button b3-button--outline" type="button" disabled={saving} on:click={onCancel}>取消</button>
            <button class="b3-button" type="button" disabled={saving} on:click={onSave}>{saving ? "保存中…" : "保存"}</button>
        </span>
    </div>
</div>
