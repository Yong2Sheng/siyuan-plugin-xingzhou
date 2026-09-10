export type ActionFieldName = "currentAction" | "nextAction";

export type ActionImageItem = {
    /** 图片在细则文本中的完整 Markdown 语法。 */
    syntax: string;
    /** 已上传图片的源路径；上传中为空字符串。 */
    src: string;
    /** 文件名，用于展示与去重比较。 */
    name: string;
    /** 上传占位符标识；已上传图片为 null。 */
    uploadId: string | null;
};

export type ActionEdit = {
    value: string;
    cursor: number;
};

const UPLOAD_PLACEHOLDER_PREFIX = "xz-upload://";
const IMAGE_SYNTAX_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const PLACEHOLDER_PATTERN = /!\[[^\]]*\]\(xz-upload:\/\/([0-9a-z]+)(?:\s+"[^"]*")?\)/g;

const IMAGE_EXTENSIONS: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
    "image/avif": "avif",
    "image/heic": "heic",
    "image/tiff": "tif",
};

export function isImageFile(file: Pick<File, "type" | "name">): boolean {
    if (file.type && file.type.startsWith("image/")) return true;
    return /\.(?:png|jpe?g|webp|gif|bmp|svg|avif|heic|tif?f)$/i.test(file.name);
}

function isImageBlob(blob: Pick<File, "type" | "name">): boolean {
    if (blob.type) return blob.type.startsWith("image/");
    return isImageFile(blob);
}

type ClipboardLikeItem = { kind?: string; type?: string; getAsFile?: () => File | null };
type ClipboardLikeData = { items?: ArrayLike<ClipboardLikeItem> | null; files?: ArrayLike<File> | null };

/** 从剪贴板数据中取出图片文件，保持剪贴板中的原始顺序。 */
export function extractClipboardImages(data: ClipboardLikeData | null | undefined): File[] {
    if (!data) return [];

    const fromItems: File[] = [];
    if (data.items) {
        for (const item of Array.from(data.items)) {
            if (item.kind !== "file") continue;
            const file = item.getAsFile?.();
            if (file && isImageBlob(file)) fromItems.push(file);
        }
    }
    if (fromItems.length > 0) return fromItems;

    if (!data.files) return [];
    return Array.from(data.files).filter((file) => isImageBlob(file));
}

/** 从拖拽数据中取出图片文件；拖入的目录或非图片文件会被忽略。 */
export function extractDroppedImages(data: ClipboardLikeData | null | undefined): File[] {
    return extractClipboardImages(data);
}

export function imageExtensionFor(file: Pick<File, "type" | "name">): string {
    const byType = IMAGE_EXTENSIONS[file.type?.toLowerCase() ?? ""];
    if (byType) return byType;
    const byName = /\.([a-z0-9]+)$/i.exec(file.name ?? "");
    return byName ? byName[1].toLowerCase() : "png";
}

export function imageFileNameFor(hash: string, file: Pick<File, "type" | "name">): string {
    return `xz-${hash.slice(0, 12).toLowerCase()}.${imageExtensionFor(file)}`;
}

/** 读取图片字节；优先用 Blob.arrayBuffer，缺失时回退到 FileReader。 */
export async function readFileBytes(file: Blob): Promise<ArrayBuffer> {
    if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
    if (typeof FileReader === "undefined") throw new Error("当前环境无法读取图片数据");
    return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (result instanceof ArrayBuffer) resolve(result);
            else reject(new Error("图片读取结果不可用"));
        };
        reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
        reader.readAsArrayBuffer(file);
    });
}

/** 计算图片字节的 SHA-256 指纹，用于内容级去重与稳定命名。 */
export async function hashImageBytes(bytes: ArrayBuffer, cryptoSource: Crypto = globalThis.crypto): Promise<string> {
    if (!cryptoSource?.subtle) throw new Error("当前环境不支持计算图片指纹");
    const digest = await cryptoSource.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

/** 读取图片并计算内容指纹。 */
export async function hashImageFile(file: Blob, cryptoSource: Crypto = globalThis.crypto): Promise<string> {
    return hashImageBytes(await readFileBytes(file), cryptoSource);
}

export function placeholderIdFor(hash: string): string {
    return hash.slice(0, 8).toLowerCase();
}

export function uploadPlaceholderSyntax(id: string, name = ""): string {
    return `![](${UPLOAD_PLACEHOLDER_PREFIX}${id}${name ? ` "${name}"` : ""})`;
}

export function isUploadPlaceholder(src: string): boolean {
    return src.startsWith(UPLOAD_PLACEHOLDER_PREFIX);
}

export function placeholderIdOf(src: string): string | null {
    const match = /^xz-upload:\/\/([0-9a-z]+)(?:\s+"[^"]*")?$/.exec(src);
    return match ? match[1] : null;
}

export function markdownImageSyntax(src: string, alt = ""): string {
    return `![${alt}](${src})`;
}

/**
 * 取出细则里所有图片语法。上传占位符也会返回，便于界面显示"上传中"。
 */
export function listActionImages(text: string): ActionImageItem[] {
    if (!text) return [];
    const items: ActionImageItem[] = [];
    IMAGE_SYNTAX_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IMAGE_SYNTAX_PATTERN.exec(text)) !== null) {
        const src = match[2];
        const uploadId = placeholderIdOf(src);
        items.push({
            syntax: match[0],
            src: uploadId ? "" : src,
            name: fileNameFromSource(src),
            uploadId,
        });
    }
    return items;
}

export function listPendingActionImages(text: string): Array<{ uploadId: string; syntax: string }> {
    return listActionImages(text)
        .filter((item): item is ActionImageItem & { uploadId: string } => item.uploadId !== null)
        .map((item) => ({ uploadId: item.uploadId, syntax: item.syntax }));
}

export function countActionImages(text: string, sourceMatcher?: (src: string) => boolean): number {
    return listActionImages(text).filter((item) => item.src && (!sourceMatcher || sourceMatcher(item.src))).length;
}

/** 明细里已经引用过的图片文件名，用于同一条目内以及全局的内容级去重。 */
export function existingImageFileNames(texts: readonly string[]): Set<string> {
    const names = new Set<string>();
    for (const text of texts) {
        for (const item of listActionImages(text)) {
            if (item.name) names.add(item.name.toLowerCase());
        }
    }
    return names;
}

export function fileNameFromSource(src: string): string {
    const path = src.split("?")[0].split("#")[0];
    const segments = path.split("/");
    return segments[segments.length - 1] || "";
}

/** 合并连续空行，用于移除图片与保存前的规范化。 */
export function compactBlankLines(value: string): string {
    return value.replace(/\n{3,}/g, "\n\n").trim();
}

/** 把图片插入到细则文本的光标处，图片独占一行。 */
export function insertImageSyntax(value: string, selectionStart: number, selectionEnd: number, syntax: string): ActionEdit {
    const start = Math.max(0, Math.min(selectionStart, value.length));
    const end = Math.max(start, Math.min(selectionEnd, value.length));
    const before = value.slice(0, start).replace(/\n+$/, (matches) => (matches.length > 1 ? "\n" : matches));
    const after = value.slice(end).replace(/^\n+/, (matches) => (matches.length > 1 ? "\n" : matches));
    const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
    const inserted = `${prefix}${syntax}${suffix}`;
    return {
        value: `${before}${inserted}${after}`,
        cursor: start + inserted.length,
    };
}

/** 移除指定图片语法，并合并被它切开的多余空行。 */
export function removeImageSyntax(value: string, syntax: string): string {
    if (!syntax || !value.includes(syntax)) return value;
    return compactBlankLines(value.replace(syntax, ""));
}

/** 图片独占一行时，删除它留下的空行；行内图片只移除语法。 */
export function removeImageLine(value: string, syntax: string): string {
    const index = syntax ? value.indexOf(syntax) : -1;
    if (index === -1) return value;

    const lineStart = value.lastIndexOf("\n", index - 1) + 1;
    const newlineIndex = value.indexOf("\n", index + syntax.length);
    const lineEnd = newlineIndex === -1 ? value.length : newlineIndex;
    const line = value.slice(lineStart, lineEnd);
    const before = value.slice(0, index);
    const after = value.slice(index + syntax.length);

    if (line.trim() === syntax.trim()) {
        const head = before.replace(/\n+$/, "");
        const tail = after.replace(/^\n+/, "");
        if (head.length > 0 && tail.length > 0) return `${head}\n${tail}`;
        return head || tail;
    }
    return compactBlankLines(`${before}${after}`);
}

/**
 * 合并连续图片之间由插入顺序造成的空行：图片应当逐行紧密排列，
 * 而不是每张图之间夹一个空行。
 */
export function compactImageSpacing(value: string): string {
    const isImageLine = (line: string) => /^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(line);
    const lines = value.split("\n");
    const kept: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.trim() === "" && isImageLine(kept[kept.length - 1] ?? "") && isImageLine(lines[index + 1] ?? "")) continue;
        kept.push(line);
    }
    return kept.join("\n");
}

export type UploadOutcome = { path: string; bytes: number; reused: boolean };

/** 替换图片语法后同步光标：光标落在被替换片段之后时按长度差平移。 */
export function shiftCursorForReplacement(cursor: number, replacementStart: number, replacedLength: number, insertedLength: number): number {
    if (cursor <= replacementStart) return cursor;
    return Math.max(replacementStart, cursor + (insertedLength - replacedLength));
}

/** 上传成功后，把占位符替换为真实图片路径；上传失败则整段移除占位符。 */
export function resolveUploadPlaceholder(value: string, uploadId: string, outcome: UploadOutcome | null): string {
    const placeholder = findPlaceholderSyntax(value, uploadId);
    if (!placeholder) return value;
    if (!outcome) return removeImageLine(value, placeholder);
    return value.replace(placeholder, markdownImageSyntax(outcome.path));
}

export function findPlaceholderSyntax(value: string, uploadId: string): string | null {
    PLACEHOLDER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_PATTERN.exec(value)) !== null) {
        if (match[1] === uploadId) return match[0];
    }
    return null;
}
export function formatImageBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "大小未知";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
