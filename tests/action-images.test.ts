import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
    countActionImages,
    existingImageFileNames,
    extractClipboardImages,
    extractDroppedImages,
    fileNameFromSource,
    findPlaceholderSyntax,
    formatImageBytes,
    hashImageBytes,
    hashImageFile,
    imageExtensionFor,
    imageFileNameFor,
    insertImageSyntax,
    isImageFile,
    isUploadPlaceholder,
    listActionImages,
    listPendingActionImages,
    markdownImageSyntax,
    placeholderIdFor,
    readFileBytes,
    removeImageLine,
    removeImageSyntax,
    resolveUploadPlaceholder,
    uploadPlaceholderSyntax,
} from "../src/action-images";

const textEncoder = new TextEncoder();

function pngFile(name = "截图.png", content = "fake-png-bytes"): File {
    return new File([textEncoder.encode(content)], name, { type: "image/png" });
}

function clipboardOf(files: Array<{ file: File | null; kind?: string; type?: string }>) {
    return {
        items: files.map((entry) => ({
            kind: entry.kind ?? "file",
            type: entry.type ?? entry.file?.type ?? "",
            getAsFile: () => entry.file,
        })),
        files: files.map((entry) => entry.file).filter((file): file is File => file !== null),
    };
}

describe("剪贴板与拖拽取图", () => {
    it("按顺序取出剪贴板里的图片", () => {
        const first = pngFile("a.png", "first");
        const second = pngFile("b.png", "second");
        const images = extractClipboardImages(clipboardOf([{ file: first }, { file: second }]));
        expect(images.map((file) => file.name)).toEqual(["a.png", "b.png"]);
    });

    it("忽略文本项和非图片文件", () => {
        const text = new File([textEncoder.encode("hello")], "note.txt", { type: "text/plain" });
        const doc = new File([textEncoder.encode("x")], "report.pdf", { type: "application/pdf" });
        const images = extractClipboardImages(clipboardOf([
            { file: null, kind: "string", type: "text/plain" },
            { file: doc },
            { file: text },
        ]));
        expect(images).toEqual([]);
    });

    it("没有 items 时回退到 files，并可同时用于拖拽", () => {
        const image = pngFile();
        const data = { items: undefined, files: [image] } as unknown as Pick<DataTransfer, "items" | "files">;
        expect(extractClipboardImages(data)).toHaveLength(1);
        expect(extractDroppedImages(data)).toHaveLength(1);
    });

    it("空的剪贴板与拖拽数据不会抛错", () => {
        expect(extractClipboardImages(null)).toEqual([]);
        expect(extractDroppedImages(undefined)).toEqual([]);
    });

    it("按扩展名识别没有 MIME 类型的图片文件", () => {
        expect(isImageFile({ type: "", name: "扫描件.JPEG" })).toBe(true);
        expect(isImageFile({ type: "", name: "存档.zip" })).toBe(false);
        expect(isImageFile({ type: "image/webp", name: "no-extension" })).toBe(true);
    });
});

describe("图片指纹与命名", () => {
    it("在缺少 Blob.arrayBuffer 的环境里回退到 FileReader 读取字节", async () => {
        const file = pngFile("fallback.png", "fallback-bytes");
        const original = (file as unknown as { arrayBuffer?: unknown }).arrayBuffer;
        delete (file as unknown as { arrayBuffer?: unknown }).arrayBuffer;
        try {
            const expected = createHash("sha256").update(Buffer.from(textEncoder.encode("fallback-bytes"))).digest("hex");
            await expect(hashImageFile(file)).resolves.toBe(expected);
        } finally {
            if (original) (file as unknown as { arrayBuffer?: unknown }).arrayBuffer = original;
        }
    });

    it("按内容计算 SHA-256，并生成稳定的文件名", async () => {
        const bytes = textEncoder.encode("xingzhou-image").buffer;
        const expected = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
        const hash = await hashImageBytes(bytes);
        expect(hash).toBe(expected);

        const name = imageFileNameFor(hash, pngFile());
        expect(name).toBe(`xz-${expected.slice(0, 12)}.png`);
        expect(placeholderIdFor(hash)).toBe(expected.slice(0, 8));
    });

    it("相同字节得到相同指纹，可据此去重", async () => {
        const first = await hashImageBytes(textEncoder.encode("same").buffer);
        const second = await hashImageBytes(textEncoder.encode("same").buffer);
        const other = await hashImageBytes(textEncoder.encode("different").buffer);
        expect(first).toBe(second);
        expect(first).not.toBe(other);
    });

    it("按 MIME 或扩展名决定后缀", () => {
        expect(imageExtensionFor({ type: "image/jpeg", name: "x" })).toBe("jpg");
        expect(imageExtensionFor({ type: "", name: "x.WEBP" })).toBe("webp");
        expect(imageExtensionFor({ type: "", name: "noext" })).toBe("png");
    });
});

describe("上传占位符", () => {
    it("占位符可被识别，并且不会当成真实路径", () => {
        const syntax = uploadPlaceholderSyntax("1a2b3c4d", "截图.png");
        expect(syntax).toBe('![](xz-upload://1a2b3c4d "截图.png")');
        expect(isUploadPlaceholder("xz-upload://1a2b3c4d")).toBe(true);
        expect(isUploadPlaceholder("assets/xz-1a2b3c4d.png")).toBe(false);
    });

    it("上传成功后替换为真实路径", () => {
        const value = `说明文字\n${uploadPlaceholderSyntax("1a2b3c4d")}\n下一段`;
        const next = resolveUploadPlaceholder(value, "1a2b3c4d", { path: "assets/xz-1a2b3c4d.png", bytes: 2048, reused: false });
        expect(next).toBe(`说明文字\n${markdownImageSyntax("assets/xz-1a2b3c4d.png")}\n下一段`);
    });

    it("上传失败时整段移除占位符", () => {
        const value = `说明文字\n${uploadPlaceholderSyntax("1a2b3c4d")}\n下一段`;
        expect(resolveUploadPlaceholder(value, "1a2b3c4d", null)).toBe("说明文字\n下一段");
    });
    it("只替换目标占位符，其余保持原样", () => {
        const value = `${uploadPlaceholderSyntax("aaaaaaaa")}\n${uploadPlaceholderSyntax("bbbbbbbb")}`;
        const next = resolveUploadPlaceholder(value, "bbbbbbbb", { path: "assets/xz-bbbbbbbb.png", bytes: 1, reused: false });
        expect(next).toContain("xz-upload://aaaaaaaa");
        expect(next).toContain("assets/xz-bbbbbbbb.png");
        expect(findPlaceholderSyntax(next, "bbbbbbbb")).toBeNull();
    });
});

describe("插入与移除图片", () => {
    it("在光标处插入图片并让图片独占一行", () => {
        const edit = insertImageSyntax("第一行", 3, 3, markdownImageSyntax("assets/xz-1.png"));
        expect(edit.value).toBe("第一行\n![](assets/xz-1.png)");
        expect(edit.cursor).toBe(edit.value.length);

        const middle = insertImageSyntax("上行\n下行", 3, 3, markdownImageSyntax("assets/xz-2.png"));
        expect(middle.value).toBe("上行\n![](assets/xz-2.png)\n下行");
    });

    it("选中文本时替换选区", () => {
        const value = "保留这段删掉这段";
        const start = value.indexOf("这段", 2);
        const end = value.indexOf("这段", start + 2);
        const edit = insertImageSyntax(value, start, end, markdownImageSyntax("assets/xz-3.png"));
        expect(edit.value).toBe("保留\n![](assets/xz-3.png)\n这段");
    });

    it("移除图片时合并多余空行", () => {
        const value = "上行\n\n![](assets/xz-1.png)\n\n下行";
        expect(removeImageSyntax(value, "![](assets/xz-1.png)")).toBe("上行\n\n下行");
    });

    it("移除不存在的图片时保持原文本", () => {
        expect(removeImageSyntax("没有图片", "![](assets/xz-9.png)")).toBe("没有图片");
        expect(removeImageLine("没有图片", "![](assets/xz-9.png)")).toBe("没有图片");
    });

    it("删除独占一行的图片时整行移除，不留空行", () => {
        expect(removeImageLine("说明文字\n![](assets/xz-1.png)\n下一段", "![](assets/xz-1.png)")).toBe("说明文字\n下一段");
        expect(removeImageLine("![](assets/xz-1.png)", "![](assets/xz-1.png)")).toBe("");
        expect(removeImageLine("说明文字\n![](assets/xz-1.png)", "![](assets/xz-1.png)")).toBe("说明文字");
        expect(removeImageLine("![](assets/xz-1.png)\n下一段", "![](assets/xz-1.png)")).toBe("下一段");
    });

    it("删除行内图片时只移除语法并保留同段文字", () => {
        expect(removeImageLine("见图 ![](assets/xz-1.png) 说明", "![](assets/xz-1.png)")).toBe("见图  说明");
    });
});

describe("列举与统计细则里的图片", () => {
    it("区分已上传图片与上传中占位符", () => {
        const value = [
            "先看这张：",
            "![](assets/xz-aaaa1111.png)",
            uploadPlaceholderSyntax("bbbb2222", "待上传.png"),
            "![](assets/other.png?box=box1)",
        ].join("\n");

        const images = listActionImages(value);
        expect(images).toHaveLength(3);
        expect(images[0]).toMatchObject({ src: "assets/xz-aaaa1111.png", name: "xz-aaaa1111.png", uploadId: null });
        expect(images[1]).toMatchObject({ src: "", uploadId: "bbbb2222" });
        expect(images[2].name).toBe("other.png");

        expect(listPendingActionImages(value)).toEqual([{ uploadId: "bbbb2222", syntax: uploadPlaceholderSyntax("bbbb2222", "待上传.png") }]);
        // countActionImages 只统计已有真实路径的图片，上传中的占位符不计入
        expect(countActionImages(value)).toBe(2);
        expect(countActionImages(value, (src) => src.startsWith("assets/xz-"))).toBe(1);
    });

    it("收集已有图片文件名用于去重", () => {
        const names = existingImageFileNames(["![](assets/xz-AABB.png)", "![](assets/other.png?box=x)"]);
        expect(names.has("xz-aabb.png")).toBe(true);
        expect(names.has("other.png")).toBe(true);
        expect(fileNameFromSource("assets/xz-1.png?box=b#frag")).toBe("xz-1.png");
    });

    it("忽略普通链接与非图片语法", () => {
        expect(listActionImages("参考 [文档](assets/a.pdf) 和 ![图片](assets/b.png)")).toHaveLength(1);
        expect(listActionImages("")).toEqual([]);
    });
});

describe("体积显示", () => {
    it("按量级格式化", () => {
        expect(formatImageBytes(0)).toBe("大小未知");
        expect(formatImageBytes(Number.NaN)).toBe("大小未知");
        expect(formatImageBytes(512)).toBe("512 B");
        expect(formatImageBytes(2048)).toBe("2 KB");
        expect(formatImageBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
    });
});
