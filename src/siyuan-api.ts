import { fetchSyncPost, type IWebSocketData } from "siyuan";
import { describeError, log } from "./log";

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

const SCOPE = "siyuan-api";

/**
 * 思源 API 的统一入口：每次调用都留下"接口名 + 耗时 + 成功/失败 + 失败原因"。
 * 这里是全插件唯一的 HTTP 出口，因此埋点集中在此处即可覆盖所有接口。
 */
export async function requestSiYuan<T>(endpoint: string, payload: unknown): Promise<T> {
    // 默认级别（warn）下不付计时成本：measure 会直接返回原始 promise。
    const measured = log.measure(SCOPE, "verbose", () => fetchSyncPost(endpoint, payload));
    const timing = log.isMeasurement(measured) ? measured : null;
    try {
        const response: IWebSocketData = timing ? await timing.result : await (measured as Promise<IWebSocketData>);
        if (response.code !== 0) {
            const message = response.msg || "思源 API 请求失败";
            log.warn(SCOPE, "request.fail", {
                endpoint,
                code: response.code,
                err: message,
                ...(timing ? { ms: Math.round(timing.ms * 100) / 100 } : {}),
            });
            throw new SiYuanApiError(endpoint, response.code, message);
        }
        log.verbose(SCOPE, "request.ok", {
            endpoint,
            ...(timing ? { ms: Math.round(timing.ms * 100) / 100 } : {}),
        });
        return response.data as T;
    } catch (error) {
        if (error instanceof SiYuanApiError) throw error;
        // 网络异常 / 宿主抛错：同样要留下可读原因
        log.warn(SCOPE, "request.fail", {
            endpoint,
            err: describeError(error),
            ...(timing ? { ms: Math.round(timing.ms * 100) / 100 } : {}),
        });
        throw error;
    }
}
