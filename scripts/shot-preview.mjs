#!/usr/bin/env node
/**
 * 给一个本机预览 URL 拍一张截图（开发核对用，交付永远是 HTML 链接本身）。
 *
 * 用法：node scripts/shot-preview.mjs <url> <输出 png> [宽] [高]
 *
 * 实现刻意保持最稳的形态：独立临时 profile + mock keychain（绝不碰用户正在运行的 Chrome 与钥匙串），
 * 并带重试——headless 偶发拿不到响应时换一个 profile 再试，不把偶发失败当成结论。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [url, out, width = "1460", height = "1000"] = process.argv.slice(2);
if (!url || !out) {
    console.error("用法：node scripts/shot-preview.mjs <url> <输出 png> [宽] [高]");
    process.exit(2);
}
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!fs.existsSync(CHROME)) {
    console.error(`找不到 Chrome：${CHROME}`);
    process.exit(2);
}

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
let done = false;
for (let attempt = 0; attempt < 3 && !done; attempt += 1) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "xz-shot-"));
    fs.rmSync(out, { force: true });
    try {
        execFileSync(CHROME, [
            "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
            "--no-first-run", "--no-default-browser-check", "--disable-crash-reporter",
            "--disable-extensions", "--disable-background-networking", "--disable-sync",
            "--use-mock-keychain", "--password-store=basic", `--user-data-dir=${profile}`,
            "--hide-scrollbars", "--virtual-time-budget=4000",
            `--window-size=${width},${height}`, `--screenshot=${out}`,
            `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`,
        ], { timeout: 120000, stdio: ["ignore", "ignore", "ignore"] });
    } catch {
        /* Chrome 收尾常以非 0 退出，图通常已写好 */
    } finally {
        fs.rmSync(profile, { recursive: true, force: true });
    }
    done = fs.existsSync(out) && fs.statSync(out).size > 0;
}

if (!done) {
    console.error("截图失败（重试 3 次仍未生成文件）");
    process.exit(1);
}
console.log(`已生成 ${out}（${fs.statSync(out).size} 字节）`);
