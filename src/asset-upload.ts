import { imageFileNameFor, isUploadPlaceholder } from "./action-images";

type AssetUploadSuccess = {
    index?: number;
    name?: string;
    path?: string;
};

type AssetUploadResponse = {
    code: number;
    msg?: string;
    data?: {
        succMap?: Record<string, string>;
        succFiles?: AssetUploadSuccess[];
        errFiles?: string[] | null;
        failedFiles?: AssetUploadSuccess[] | null;
    } | null;
};

type AssetStatResponse = {
    code: number;
    msg?: string;
    data?: {
        size?: number;
        count?: number;
    } | null;
};

type SiYuanWindow = Window & {
    siyuan?: {
        config?: {
            api?: { token?: string };
        };
    };
};

export type UploadedActionImage = {
    /** 可直接写进 Markdown 的图片路径，例如 assets/xz-1a2b3c4d5e6f.png。 */
    path: string;
    /** 图片字节数，取不到时为 null。 */
    bytes: number | null;
    /** 文件名，用于与已有引用比较去重。 */
    name: string;
    /** 服务端按内容指纹判定为已存在时返回 true，此时不会新增文件。 */
    reused: boolean;
};

function apiToken(): string {
    try {
        return (globalThis as unknown as SiYuanWindow).siyuan?.config?.api?.token ?? "";
    } catch {
        return "";
    }
}

function normalizedAssetPath(path: string): string {
    const trimmed = path.trim().replace(/^\.?\//, "");
    if (!trimmed) return "";
    if (isUploadPlaceholder(trimmed)) return "";
    return trimmed.startsWith("assets/") ? trimmed : `assets/${trimmed}`;
}

function pickUploadedPath(payload: AssetUploadResponse, fileName: string): string {
    const succMap = payload.data?.succMap ?? {};
    const fromMap = succMap[fileName] ?? Object.values(succMap)[0];
    if (typeof fromMap === "string" && fromMap) return fromMap;

    const fromFiles = (payload.data?.succFiles ?? []).find((entry) => typeof entry?.path === "string" && entry.path);
    return fromFiles?.path ?? "";
}

async function statAssetBytes(path: string): Promise<number | null> {
    try {
        const response = await fetch("/api/asset/statAsset", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(apiToken() ? { Authorization: `Token ${apiToken()}` } : {}),
            },
            body: JSON.stringify({ path }),
        });
        const payload: AssetStatResponse = await response.json();
        if (payload.code !== 0) return null;
        const size = payload.data?.size;
        return typeof size === "number" && Number.isFinite(size) ? size : null;
    } catch {
        return null;
    }
}

/**
 * 把图片按原分辨率上传到思源资源库。
 *
 * 文件名使用图片内容指纹（xz-<指纹>.ext），因此同一张图片重复粘贴时思源会按内容
 * 复用已有资源，不会产生重复副本。
 */
export async function uploadActionImage(file: File, hash: string): Promise<UploadedActionImage> {
    const fileName = imageFileNameFor(hash, file);
    const payload = new FormData();
    payload.append("assetsDirPath", "assets");
    payload.append("file[]", file, fileName);

    let response: Response;
    try {
        response = await fetch("/api/asset/upload", {
            method: "POST",
            headers: apiToken() ? { Authorization: `Token ${apiToken()}` } : undefined,
            body: payload,
        });
    } catch (caught) {
        throw new Error(`图片上传失败：${caught instanceof Error ? caught.message : String(caught)}`);
    }

    let result: AssetUploadResponse;
    try {
        result = await response.json();
    } catch {
        throw new Error(`图片上传失败：思源返回了无法解析的响应（HTTP ${response.status}）`);
    }

    if (result.code !== 0) throw new Error(`图片上传失败：${result.msg || "思源未接受该文件"}`);

    const path = normalizedAssetPath(pickUploadedPath(result, fileName));
    if (!path) throw new Error("图片上传失败：思源没有返回资源路径");

    const byContent = path.toLowerCase() === `assets/${fileName}`.toLowerCase();
    const bytes = await statAssetBytes(path);
    return {
        path,
        bytes: bytes ?? (file.size || null),
        name: path.split("/").pop() ?? fileName,
        reused: !byContent,
    };
}

type UnusedAssetItem = { item?: string; name?: string; path?: string; hSize?: string };

type UnusedAssetsResponse = {
    code: number;
    msg?: string;
    data?: UnusedAssetItem[] | null;
};

export type AssetRemovalResult = {
    path: string;
    removed: boolean;
    /** 未被删除时的原因，用于在清理结果里说明。 */
    reason: string;
};

/** 未引用资源的路径按思源的相对路径原样使用，仅去掉开头的斜杠。 */
function normalizeUnusedAssetPath(path: string): string {
    return path.trim().replace(/^\.?\//, "");
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const token = apiToken();
    return token ? { ...extra, Authorization: `Token ${token}` } : extra;
}

/**
 * 思源认为"没有任何文档引用"的资源路径。
 *
 * 行舟只删除出现在这个列表里的图片：被文档、数据库或其它插件引用的图片一律保留，
 * 避免清理把用户笔记中的图删成裂图。
 */
export async function listUnusedAssetPaths(): Promise<{ paths: Set<string>; truncated: boolean }> {
    const response = await fetch("/api/asset/getUnusedAssets", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({}),
    });
    const payload: UnusedAssetsResponse = await response.json();
    if (payload.code !== 0) throw new Error(`读取未引用资源失败：${payload.msg || "思源未返回结果"}`);
    const items = payload.data ?? [];
    const paths = new Set<string>();
    for (const entry of items) {
        const value = entry?.item ?? entry?.path;
        if (typeof value === "string" && value) paths.add(normalizeUnusedAssetPath(value));
    }
    // 思源一次最多返回 512 条，达到上限时无法保证列表完整
    return { paths, truncated: items.length >= 512 };
}

/** 删除一张未被引用的资源；思源会先把它复制进历史目录，可找回。 */
export async function removeUnusedAsset(path: string): Promise<AssetRemovalResult> {
    const target = normalizeUnusedAssetPath(path);
    if (!target) return { path, removed: false, reason: "路径无效" };
    let response: Response;
    try {
        response = await fetch("/api/asset/removeUnusedAsset", {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ path: target }),
        });
    } catch (caught) {
        return { path: target, removed: false, reason: caught instanceof Error ? caught.message : String(caught) };
    }
    let payload: { code: number; msg?: string };
    try {
        payload = await response.json();
    } catch {
        return { path: target, removed: false, reason: `思源返回了无法解析的响应（HTTP ${response.status}）` };
    }
    if (payload.code !== 0) return { path: target, removed: false, reason: payload.msg || "思源拒绝删除" };
    return { path: target, removed: true, reason: "" };
}

type ReadDirEntry = { name?: string; isDir?: boolean; isSymlink?: boolean };

/**
 * 查询一批资源的字节数（并发受限）。
 * 思源的目录接口不返回大小，只能逐个查询；结果用于图库体检的体积统计。
 */
export async function readAssetSizes(paths: string[]): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();
    const unique = [...new Set(paths)];
    const batchSize = 16;
    for (let index = 0; index < unique.length; index += batchSize) {
        const batch = unique.slice(index, index + batchSize);
        const results = await Promise.all(batch.map(async (path) => [path, await statAssetBytes(path)] as const));
        for (const [path, bytes] of results) {
            if (typeof bytes === "number" && bytes > 0) sizes.set(path, bytes);
        }
    }
    return sizes;
}

/** 资源库整体占用：行舟图片 + 笔记里的其它资源，用于估算占云端配额的比例。 */
export async function readAssetLibrarySize(): Promise<{ totalBytes: number; fileCount: number } | null> {
    try {
        const response = await fetch("/api/file/readDir", {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ path: "data/assets" }),
        });
        const payload: { code: number; data?: ReadDirEntry[] | null } = await response.json();
        if (payload.code !== 0) return null;
        const files = (payload.data ?? []).filter((entry) => !entry.isDir && !entry.isSymlink && entry.name);
        const names = files.map((entry) => `assets/${entry.name}`);
        if (names.length === 0) return { totalBytes: 0, fileCount: 0 };
        const sizes = await readAssetSizes(names);
        let totalBytes = 0;
        for (const bytes of sizes.values()) totalBytes += bytes;
        return { totalBytes, fileCount: names.length };
    } catch {
        return null;
    }
}
