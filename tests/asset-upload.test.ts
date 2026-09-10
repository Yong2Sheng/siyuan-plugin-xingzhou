import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { listUnusedAssetPaths, readAssetLibrarySize, readAssetSizes, removeUnusedAsset, uploadActionImage } from "../src/asset-upload";
import { imageFileNameFor, readFileBytes } from "../src/action-images";

const textEncoder = new TextEncoder();

type FetchCall = { url: string; body: unknown; headers: Record<string, string> };

function jsonResponse(payload: unknown, status = 200): Response {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => payload,
    } as unknown as Response;
}

function mockFetch(handler: (call: FetchCall) => Response) {
    const calls: FetchCall[] = [];
    const impl = async (url: string, init: RequestInit = {}) => {
        const call: FetchCall = { url: String(url), body: init.body, headers: (init.headers ?? {}) as Record<string, string> };
        calls.push(call);
        return handler(call);
    };
    vi.stubGlobal("fetch", impl);
    return { calls, uploadCalls: () => calls.filter((call) => call.url.includes("/api/asset/upload")) };
}

function imageFile(name = "截图.png", content = "bytes"): File {
    return new File([textEncoder.encode(content)], name, { type: "image/png" });
}

async function hashOf(file: File): Promise<string> {
    return createHash("sha256").update(Buffer.from(await readFileBytes(file))).digest("hex");
}

afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { siyuan?: unknown }).siyuan;
});

describe("uploadActionImage", () => {
    it("以内容指纹命名并上传到资源库，返回可直接引用的路径与体积", async () => {
        const file = imageFile("截图.png", "payload-a");
        const hash = await hashOf(file);
        const expectedName = imageFileNameFor(hash, file);
        const { calls, uploadCalls } = mockFetch((call) => {
            if (call.url.includes("/api/asset/statAsset")) return jsonResponse({ code: 0, msg: "", data: { size: 2048 } });
            return jsonResponse({ code: 0, msg: "", data: { succMap: { [expectedName]: `assets/${expectedName}` }, succFiles: [{ index: 0, name: expectedName, path: `assets/${expectedName}` }], failedFiles: [] } });
        });

        const result = await uploadActionImage(file, hash);
        expect(result.path).toBe(`assets/${expectedName}`);
        expect(result.name).toBe(expectedName);
        expect(result.bytes).toBe(2048);
        expect(result.reused).toBe(false);

        expect(uploadCalls()).toHaveLength(1);
        const form = uploadCalls()[0].body as FormData;
        expect(form).toBeInstanceOf(FormData);
        expect(form.get("assetsDirPath")).toBe("assets");
        const uploaded = form.get("file[]") as File;
        expect(uploaded).toBeInstanceOf(File);
        expect(uploaded.name).toBe(expectedName);

        expect(calls.some((call) => call.url.includes("/api/asset/statAsset"))).toBe(true);
        const statCall = calls.find((call) => call.url.includes("/api/asset/statAsset"))!;
        expect(JSON.parse(String(statCall.body))).toEqual({ path: `assets/${expectedName}` });
    });

    it("携带思源 API token，便于设置锁屏密码时也能上传", async () => {
        const file = imageFile("a.png", "payload-b");
        const hash = await hashOf(file);
        (window as unknown as { siyuan: unknown }).siyuan = { config: { api: { token: "token-123" } } };
        const { uploadCalls } = mockFetch(() => jsonResponse({ code: 0, msg: "", data: { succMap: {}, succFiles: [{ path: `assets/xz-${hash.slice(0, 12)}.png` }] } }));

        await uploadActionImage(file, hash);
        expect(uploadCalls()[0].headers).toMatchObject({ Authorization: "Token token-123" });
    });

    it("思源返回已有资源时标记为复用（内容相同不会新增文件）", async () => {
        const file = imageFile("相同内容.png", "payload-c");
        const hash = await hashOf(file);
        mockFetch((call) => {
            if (call.url.includes("/api/asset/statAsset")) return jsonResponse({ code: 0, msg: "", data: { size: 4096 } });
            return jsonResponse({ code: 0, msg: "", data: { succMap: { "相同内容.png": "assets/xz-existing0001.png" }, succFiles: [] } });
        });

        const result = await uploadActionImage(file, hash);
        expect(result.path).toBe("assets/xz-existing0001.png");
        expect(result.name).toBe("xz-existing0001.png");
        expect(result.reused).toBe(true);
    });

    it("思源报错时抛出可读错误，不返回空路径", async () => {
        const file = imageFile("bad.png", "payload-d");
        const hash = await hashOf(file);
        mockFetch(() => jsonResponse({ code: -1, msg: "Path is not in workspace", data: null }));

        await expect(uploadActionImage(file, hash)).rejects.toThrow("图片上传失败：Path is not in workspace");
    });

    it("响应无法解析或缺少路径时抛出错误", async () => {
        const file = imageFile("empty.png", "payload-e");
        const hash = await hashOf(file);
        mockFetch(() => ({ status: 500, ok: false, json: async () => { throw new Error("bad json"); } } as unknown as Response));
        await expect(uploadActionImage(file, hash)).rejects.toThrow(/无法解析的响应（HTTP 500）/);

        mockFetch(() => jsonResponse({ code: 0, msg: "", data: { succMap: {}, succFiles: [] } }));
        await expect(uploadActionImage(file, hash)).rejects.toThrow("图片上传失败：思源没有返回资源路径");
    });

    it("取不到体积时回退到本地文件大小", async () => {
        const file = imageFile("size.png", "payload-f");
        const hash = await hashOf(file);
        mockFetch((call) => {
            if (call.url.includes("/api/asset/statAsset")) return jsonResponse({ code: 0, msg: "", data: {} });
            return jsonResponse({ code: 0, msg: "", data: { succMap: { "size.png": `assets/xz-${hash.slice(0, 12)}.png` } } });
        });

        const result = await uploadActionImage(file, hash);
        expect(result.bytes).toBe(file.size);
    });
});

describe("未引用资源的查询与删除", () => {
    it("读取未引用资源路径，并识别结果被截断", async () => {
        const calls: FetchCall[] = [];
        vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
            calls.push({ url: String(url), body: init.body, headers: (init.headers ?? {}) as Record<string, string> });
            return jsonResponse({ code: 0, msg: "", data: [{ item: "assets/xz-a.png" }, { item: "assets/other.pdf" }] });
        });

        const result = await listUnusedAssetPaths();
        expect(calls[0].url).toContain("/api/asset/getUnusedAssets");
        expect([...result.paths].sort()).toEqual(["assets/other.pdf", "assets/xz-a.png"]);
        expect(result.truncated).toBe(false);
    });

    it("达到 512 条上限时标记截断", async () => {
        vi.stubGlobal("fetch", async () => jsonResponse({
            code: 0,
            msg: "",
            data: Array.from({ length: 512 }, (_, index) => ({ item: `assets/xz-${index}.png` })),
        }));
        const result = await listUnusedAssetPaths();
        expect(result.truncated).toBe(true);
        expect(result.paths.size).toBe(512);
    });

    it("接口报错时抛出可读错误", async () => {
        vi.stubGlobal("fetch", async () => jsonResponse({ code: -1, msg: "kernel busy", data: null }));
        await expect(listUnusedAssetPaths()).rejects.toThrow("读取未引用资源失败：kernel busy");
    });

    it("删除单张资源时带上路径并返回结果", async () => {
        const calls: FetchCall[] = [];
        vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
            calls.push({ url: String(url), body: init.body, headers: (init.headers ?? {}) as Record<string, string> });
            return jsonResponse({ code: 0, msg: "", data: { path: "assets/xz-a.png" } });
        });

        const result = await removeUnusedAsset("/assets/xz-a.png");
        expect(result).toEqual({ path: "assets/xz-a.png", removed: true, reason: "" });
        expect(calls[0].url).toContain("/api/asset/removeUnusedAsset");
        expect(JSON.parse(String(calls[0].body))).toEqual({ path: "assets/xz-a.png" });
    });

    it("思源拒绝删除时返回原因而不是抛错", async () => {
        vi.stubGlobal("fetch", async () => jsonResponse({ code: -1, msg: "asset is referenced", data: null }));
        await expect(removeUnusedAsset("assets/xz-a.png")).resolves.toEqual({
            path: "assets/xz-a.png", removed: false, reason: "asset is referenced",
        });
    });

    it("空路径直接拒绝，不发请求", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        await expect(removeUnusedAsset("   ")).resolves.toEqual({ path: "   ", removed: false, reason: "路径无效" });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("图库体检的体积统计", () => {
    it("批量查询体积，只保留成功的结果", async () => {
        const calls: FetchCall[] = [];
        vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
            calls.push({ url: String(url), body: init.body, headers: (init.headers ?? {}) as Record<string, string> });
            const path = JSON.parse(String(init.body)).path as string;
            if (path.endsWith("missing.png")) return jsonResponse({ code: -1, msg: "not found", data: null });
            return jsonResponse({ code: 0, msg: "", data: { size: path.endsWith("big.png") ? 4096 : 512 } });
        });

        const sizes = await readAssetSizes(["assets/big.png", "assets/small.png", "assets/missing.png", "assets/big.png"]);
        expect(sizes.get("assets/big.png")).toBe(4096);
        expect(sizes.get("assets/small.png")).toBe(512);
        expect(sizes.has("assets/missing.png")).toBe(false);
        // 去重后只查 3 个
        expect(calls).toHaveLength(3);
    });

    it("统计资源库总量：列出目录后逐个取体积", async () => {
        vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
            if (String(url).includes("/api/file/readDir")) {
                return jsonResponse({ code: 0, msg: "", data: [
                    { name: "a.png", isDir: false, isSymlink: false },
                    { name: "b.png", isDir: false, isSymlink: false },
                    { name: "sub", isDir: true, isSymlink: false },
                ] });
            }
            const path = JSON.parse(String(init.body)).path as string;
            return jsonResponse({ code: 0, msg: "", data: { size: path.endsWith("a.png") ? 1000 : 2000 } });
        });

        const library = await readAssetLibrarySize();
        expect(library).toEqual({ totalBytes: 3000, fileCount: 2 });
    });

    it("目录接口失败时返回 null，不抛错", async () => {
        vi.stubGlobal("fetch", async () => jsonResponse({ code: -1, msg: "nope", data: null }));
        await expect(readAssetLibrarySize()).resolves.toBeNull();
    });
});
