import { fetchSyncPost, type IWebSocketData } from "siyuan";

export class SiYuanApiError extends Error {
    constructor(
        public readonly endpoint: string,
        public readonly code: number,
        message: string,
    ) {
        super(message);
        this.name = "SiYuanApiError";
    }
}

export async function requestSiYuan<T>(endpoint: string, payload: unknown): Promise<T> {
    const response: IWebSocketData = await fetchSyncPost(endpoint, payload);
    if (response.code !== 0) {
        throw new SiYuanApiError(endpoint, response.code, response.msg || "思源 API 请求失败");
    }
    return response.data as T;
}
