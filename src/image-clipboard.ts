import { formatImageBytes } from "./action-images";

/**
 * 把行舟界面里的图片按原分辨率复制到系统剪贴板。
 *
 * 关键约定：
 * - PNG 直接写资源库原文件字节，不经过画布，与当初截图字节级一致 —— 这是"复制原图"的意义所在；
 * - 其它格式（jpg/webp/gif/svg）必须转成 PNG：Chromium 的异步剪贴板写入只接受 image/png，
 *   转码只换容器、不改像素（动图只保留首帧）；
 * - 环境能力（fetch / 剪贴板 / 解码 / 转码）可注入，便于在 jsdom 里覆盖各条失败路径；
 * - 失败一律返回结构化结果与中文原因，由调用方提示，不抛异常、不静默失败。
 */

/** 右键命中的图片：src 必须是已解析的绝对地址（img.currentSrc || img.src）。 */
export type ActionImageCopyTarget = {
    src: string;
    /** 界面上已知的原始尺寸，取不到时为 0。 */
    width?: number;
    height?: number;
};

export type CopyImageResult =
    | { ok: true; bytes: number; width: number; height: number; converted: boolean }
    | { ok: false; message: string };

export type CopyImagePathResult = { ok: true; path: string } | { ok: false; message: string };

type TranscodeResult = { png: Blob; width: number; height: number };

type ClipboardLike = {
    write?: (items: unknown[]) => Promise<void>;
    writeText?: (text: string) => Promise<void>;
};

export type ImageCopyEnvironment = {
    fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
    clipboard: ClipboardLike | undefined;
    clipboardItem: (new (items: Record<string, Blob>) => unknown) | undefined;
    /** 把非 PNG 图片转成 PNG；默认走画布，测试里注入假实现。 */
    transcode: (blob: Blob) => Promise<TranscodeResult>;
};

/** 画布上限：Chrome 单边 16384px、总面积约 2.68 亿像素，这里留一半余量。 */
const MAX_CANVAS_EDGE = 16384;
const MAX_CANVAS_PIXELS = 100_000_000;

function failure(message: string): { ok: false; message: string } {
    return { ok: false, message };
}

async function decodeImage(blob: Blob): Promise<{ source: ImageBitmap | HTMLImageElement; objectUrl: string }> {
    // SVG 没有固有像素尺寸时 createImageBitmap 会失败，交回 <img> 解码
    if (blob.type !== "image/svg+xml" && typeof createImageBitmap === "function") {
        return { source: await createImageBitmap(blob), objectUrl: "" };
    }
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return { source: image, objectUrl };
}

/** 默认转码实现：解码 → 画布原尺寸重绘 → PNG 编码（像素不变，只换容器）。 */
async function transcodeToPng(blob: Blob): Promise<TranscodeResult> {
    const { source, objectUrl } = await decodeImage(blob);
    try {
        const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
        const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
        if (!width || !height) throw new Error("无法读取图片尺寸");
        if (width > MAX_CANVAS_EDGE || height > MAX_CANVAS_EDGE || width * height > MAX_CANVAS_PIXELS) {
            throw new Error("图片尺寸超出画布上限");
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建画布");
        context.drawImage(source as CanvasImageSource, 0, 0, width, height);
        const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!png) throw new Error("图片转码失败");
        return { png, width, height };
    } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close();
    }
}

function navigatorClipboard(): ClipboardLike | undefined {
    try {
        return typeof navigator === "undefined" ? undefined : (navigator.clipboard as ClipboardLike | undefined);
    } catch {
        return undefined;
    }
}

export function resolveImageCopyEnvironment(overrides: Partial<ImageCopyEnvironment> = {}): ImageCopyEnvironment {
    const base: ImageCopyEnvironment = {
        fetchImpl: (input, init) => fetch(input, init),
        clipboard: navigatorClipboard(),
        clipboardItem: typeof ClipboardItem === "undefined" ? undefined : (ClipboardItem as ImageCopyEnvironment["clipboardItem"]),
        transcode: transcodeToPng,
    };
    return { ...base, ...overrides };
}

/** 资源库路径：把解析后的图片地址还原成可直接写进 Markdown 的 assets/… 形式。 */
export function assetPathFromSource(src: string): string {
    const clean = (src ?? "").split("?")[0].split("#")[0];
    const index = clean.indexOf("/assets/");
    if (index >= 0) return clean.slice(index + 1);
    return clean.startsWith("assets/") ? clean : "";
}

function looksLikePng(src: string, blob: Blob): boolean {
    if (blob.type) return blob.type === "image/png";
    return /\.png$/i.test((src ?? "").split("?")[0]);
}

export async function copyImageToClipboard(
    target: ActionImageCopyTarget,
    overrides: Partial<ImageCopyEnvironment> = {},
): Promise<CopyImageResult> {
    const src = (target?.src ?? "").trim();
    if (!src) return failure("没有拿到图片地址，请重新加载插件后再试");
    const env = resolveImageCopyEnvironment(overrides);
    if (!env.clipboard?.write || !env.clipboardItem) {
        return failure("当前环境不允许写入剪贴板（思源窗口可能未聚焦）");
    }

    let blob: Blob;
    try {
        const response = await env.fetchImpl(src, { credentials: "same-origin" });
        if (!response.ok) return failure(`读取原图失败（HTTP ${response.status}）`);
        blob = await response.blob();
    } catch {
        return failure("读取原图失败，请确认图片仍在思源资源库里");
    }
    if (!blob.size) return failure("原图内容为空，无法复制");

    let png = blob;
    let converted = false;
    let width = target.width && target.width > 0 ? target.width : 0;
    let height = target.height && target.height > 0 ? target.height : 0;
    if (!looksLikePng(src, blob)) {
        try {
            const transcoded = await env.transcode(blob);
            png = transcoded.png;
            width = transcoded.width;
            height = transcoded.height;
            converted = true;
        } catch {
            return failure("这张图片无法转成 PNG，请改用 PNG 截图");
        }
    }

    try {
        await env.clipboard.write([new env.clipboardItem({ "image/png": png })]);
    } catch {
        return failure("系统拒绝了剪贴板写入，请重试");
    }
    return { ok: true, bytes: png.size, width, height, converted };
}

/** 老内核或受限环境下的退路：临时文本域 + execCommand。 */
function copyTextDirectly(text: string): boolean {
    if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "true");
    field.style.position = "fixed";
    field.style.top = "-1000px";
    document.body.append(field);
    let copied = false;
    try {
        field.select();
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    } finally {
        field.remove();
    }
    return copied;
}

export async function copyImagePathToClipboard(
    src: string,
    overrides: Partial<ImageCopyEnvironment> = {},
): Promise<CopyImagePathResult> {
    const path = assetPathFromSource(src);
    if (!path) return failure("这张图片不在思源资源库里，没有可复制的路径");
    const env = resolveImageCopyEnvironment(overrides);
    try {
        if (env.clipboard?.writeText) {
            await env.clipboard.writeText(path);
            return { ok: true, path };
        }
    } catch {
        /* 落到下面的退路 */
    }
    return copyTextDirectly(path) ? { ok: true, path } : failure("复制路径失败，请重试");
}

export function imageCopyMessage(result: CopyImageResult): string {
    if (!result.ok) return `复制失败：${result.message}`;
    const size = result.width > 0 && result.height > 0 ? ` · ${result.width}×${result.height}` : "";
    return `已复制原图${size} · ${formatImageBytes(result.bytes)}${result.converted ? "（已转为 PNG）" : ""}`;
}

export function imagePathCopyMessage(result: CopyImagePathResult): string {
    return result.ok ? `已复制资源路径 ${result.path}` : `复制失败：${result.message}`;
}
