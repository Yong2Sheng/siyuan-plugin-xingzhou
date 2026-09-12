import { describe, expect, it, vi } from "vitest";
import {
    assetPathFromSource,
    copyImagePathToClipboard,
    copyImageToClipboard,
    imageCopyMessage,
    imagePathCopyMessage,
    type ImageCopyEnvironment,
} from "../src/image-clipboard";

const encoder = new TextEncoder();

function blobOf(content: string, type: string): Blob {
    return new Blob([encoder.encode(content)], { type });
}

function okResponse(blob: Blob): Response {
    return { ok: true, status: 200, blob: async () => blob } as unknown as Response;
}

class FakeClipboardItem {
    readonly items: Record<string, Blob>;

    constructor(items: Record<string, Blob>) {
        this.items = items;
    }
}

/** 默认是"PNG + 可写剪贴板"的成功环境，各用例只覆盖自己关心的那一层。 */
function environment(overrides: Partial<ImageCopyEnvironment> = {}) {
    const png = blobOf("original-png-bytes", "image/png");
    const written: FakeClipboardItem[][] = [];
    const texts: string[] = [];
    const fetchImpl = vi.fn(async () => okResponse(png));
    const transcode = vi.fn(async () => ({ png: blobOf("transcoded-png", "image/png"), width: 1280, height: 800 }));
    const env: Partial<ImageCopyEnvironment> = {
        fetchImpl,
        clipboard: {
            write: async (items) => {
                written.push(items as FakeClipboardItem[]);
            },
            writeText: async (text) => {
                texts.push(text);
            },
        },
        clipboardItem: FakeClipboardItem,
        transcode,
        ...overrides,
    };
    return { env, png, written, texts, fetchImpl, transcode };
}

const absolute = "http://127.0.0.1:6806/assets/xz-2f17bf982caf-20260911010326-5hxz11i.png";

describe("copyImageToClipboard", () => {
    it("PNG 直通：写进剪贴板的就是资源库原文件字节，不经过画布", async () => {
        const { env, png, written, transcode } = environment();

        const result = await copyImageToClipboard({ src: absolute, width: 1280, height: 800 }, env);

        expect(result).toEqual({ ok: true, bytes: png.size, width: 1280, height: 800, converted: false });
        expect(transcode).not.toHaveBeenCalled();
        expect(written).toHaveLength(1);
        // 同一个 Blob 实例：字节级原图，没有解码再编码
        expect(written[0][0].items["image/png"]).toBe(png);
    });

    it("服务端没给 content-type 时按扩展名判断 PNG，仍走直通", async () => {
        const blob = blobOf("png-without-type", "");
        const { env, written, transcode } = environment({ fetchImpl: vi.fn(async () => okResponse(blob)) });

        const result = await copyImageToClipboard({ src: absolute }, env);

        expect(result.ok).toBe(true);
        expect(transcode).not.toHaveBeenCalled();
        expect(written[0][0].items["image/png"]).toBe(blob);
    });

    it("非 PNG 先转码成 PNG 再写入，并带回真实像素尺寸", async () => {
        const jpeg = blobOf("jpeg-bytes", "image/jpeg");
        const transcode = vi.fn(async () => ({ png: blobOf("transcoded-png", "image/png"), width: 1170, height: 2532 }));
        const { env, written } = environment({
            fetchImpl: vi.fn(async () => okResponse(jpeg)),
            transcode,
        });

        const result = await copyImageToClipboard({ src: "http://127.0.0.1:6806/assets/shot.jpg", width: 1, height: 1 }, env);

        expect(transcode).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ ok: true, width: 1170, height: 2532, converted: true });
        expect(written[0][0].items["image/png"].type).toBe("image/png");
    });

    it("剪贴板 API 不可用时给出明确原因，且不请求图片", async () => {
        const { env, fetchImpl } = environment({ clipboard: undefined, clipboardItem: undefined });

        const result = await copyImageToClipboard({ src: absolute }, env);

        expect(result.ok).toBe(false);
        expect(result.ok === false && result.message).toContain("剪贴板");
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("没有图片地址时直接失败，不发请求", async () => {
        const { env, fetchImpl } = environment();

        const result = await copyImageToClipboard({ src: "   " }, env);

        expect(result).toMatchObject({ ok: false });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("读取原图返回非 2xx 时说明状态码", async () => {
        const { env } = environment({
            fetchImpl: vi.fn(async () => ({ ok: false, status: 404, blob: async () => blobOf("", "text/html") }) as unknown as Response),
        });

        const result = await copyImageToClipboard({ src: absolute }, env);

        expect(result.ok === false && result.message).toContain("404");
    });

    it("网络异常与原图为空都有可读原因", async () => {
        const broken = environment({ fetchImpl: vi.fn(async () => { throw new Error("offline"); }) });
        expect((await copyImageToClipboard({ src: absolute }, broken.env))).toMatchObject({ ok: false });
        expect((await copyImageToClipboard({ src: absolute }, broken.env)).ok === false).toBe(true);

        const empty = environment({ fetchImpl: vi.fn(async () => okResponse(blobOf("", "image/png"))) });
        const emptyResult = await copyImageToClipboard({ src: absolute }, empty.env);
        expect(emptyResult.ok === false && emptyResult.message).toContain("为空");
    });

    it("转码失败时不写剪贴板，并提示改用 PNG 截图", async () => {
        const { env, written } = environment({
            fetchImpl: vi.fn(async () => okResponse(blobOf("webp-bytes", "image/webp"))),
            transcode: vi.fn(async () => { throw new Error("canvas failed"); }),
        });

        const result = await copyImageToClipboard({ src: "http://127.0.0.1:6806/assets/a.webp" }, env);

        expect(result.ok === false && result.message).toContain("PNG");
        expect(written).toHaveLength(0);
    });

    it("系统拒绝写入时报错而不是抛出", async () => {
        const { env } = environment({
            clipboard: { write: async () => { throw new Error("NotAllowedError"); } },
        });

        const result = await copyImageToClipboard({ src: absolute }, env);

        expect(result.ok === false && result.message).toContain("拒绝");
    });

    it("用同源凭证读取资源库图片", async () => {
        const { env, fetchImpl } = environment();

        await copyImageToClipboard({ src: absolute }, env);

        expect(fetchImpl).toHaveBeenCalledWith(absolute, { credentials: "same-origin" });
    });
});

describe("assetPathFromSource", () => {
    it("把各种地址还原成可直接写进 Markdown 的资源路径", () => {
        expect(assetPathFromSource("http://127.0.0.1:6806/assets/xz-2f17.png")).toBe("assets/xz-2f17.png");
        expect(assetPathFromSource("/assets/xz-2f17.png?v=2")).toBe("assets/xz-2f17.png");
        expect(assetPathFromSource("assets/xz-2f17.png")).toBe("assets/xz-2f17.png");
        expect(assetPathFromSource("http://127.0.0.1:6806/assets/a%20b.png#hash")).toBe("assets/a%20b.png");
    });

    it("非资源库地址不返回路径", () => {
        expect(assetPathFromSource("http://127.0.0.1:6806/api/asset/x.png")).toBe("");
        expect(assetPathFromSource("")).toBe("");
    });
});

describe("copyImagePathToClipboard", () => {
    it("复制 assets/… 路径", async () => {
        const { env, texts } = environment();

        const result = await copyImagePathToClipboard(absolute, env);

        expect(result).toEqual({ ok: true, path: "assets/xz-2f17bf982caf-20260911010326-5hxz11i.png" });
        expect(texts).toEqual(["assets/xz-2f17bf982caf-20260911010326-5hxz11i.png"]);
    });

    it("不在资源库里的图片给出原因，不写剪贴板", async () => {
        const { env, texts } = environment();

        const result = await copyImagePathToClipboard("https://example.com/a.png", env);

        expect(result).toMatchObject({ ok: false });
        expect(texts).toHaveLength(0);
    });

    it("没有 writeText 时退路不可用也不抛异常", async () => {
        const { env } = environment({ clipboard: {} });

        const result = await copyImagePathToClipboard(absolute, env);

        expect(result).toMatchObject({ ok: false });
    });
});

describe("提示文案", () => {
    it("成功文案带尺寸与体积，转码时标明", () => {
        expect(imageCopyMessage({ ok: true, bytes: 625_664, width: 1280, height: 800, converted: false }))
            .toBe("已复制原图 · 1280×800 · 611 KB");
        expect(imageCopyMessage({ ok: true, bytes: 2048, width: 0, height: 0, converted: true }))
            .toBe("已复制原图 · 2 KB（已转为 PNG）");
    });

    it("失败文案带上具体原因", () => {
        expect(imageCopyMessage({ ok: false, message: "读取原图失败（HTTP 404）" })).toBe("复制失败：读取原图失败（HTTP 404）");
        expect(imagePathCopyMessage({ ok: true, path: "assets/a.png" })).toBe("已复制资源路径 assets/a.png");
        expect(imagePathCopyMessage({ ok: false, message: "复制路径失败，请重试" })).toBe("复制失败：复制路径失败，请重试");
    });
});
