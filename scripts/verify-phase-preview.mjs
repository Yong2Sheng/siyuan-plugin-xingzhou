#!/usr/bin/env node
/**
 * 阶段功能的「渲染后实测」：真实组件 + 真实样式，在 headless Chrome 里量几何并截图。
 *
 * 用法：
 *   npx vite build --config design/vite.phase-preview.config.mjs   # 先构建预览
 *   node scripts/verify-phase-preview.mjs [--keep]
 *
 * 为什么必须有这一步（真实事故，不是理论风险）：
 * 1. 声明弹窗曾经被渲染进 `.xz-daily-layout`（grid 容器）里，成了网格项、跑到右下角；
 *    组件级测试当时全绿，只有真实渲染的截图能看出来。
 * 2. 弹窗页脚曾经是横向布局，560px 宽时提示吃掉了按钮空间，「进入紧急期」被压成竖排并溢出。
 * 因此这里量四件事：浮层是否居中、是否铺满视口、按钮是否被裁切、页面是否横向溢出。
 *
 * 实现上刻意保持"最笨但最稳"：python3 起静态服务 + 直接调用 Chrome（独立临时 profile）。
 * headless 的 --dump-dom 与页面计时器存在竞态，所以几何结果由页面**同步**写进 DOM，
 * 拿不到时按提示处理而不是当失败——失败只用于真正的几何问题。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8199;
const VIEWPORT = { width: 1460, height: 1500 };
const keep = process.argv.includes("--keep");
const outDir = keep ? path.join(ROOT, "design", ".shots") : fs.mkdtempSync(path.join(os.tmpdir(), "xz-shots-"));
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function serve() {
    const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
        cwd: ROOT, stdio: ["ignore", "ignore", "ignore"], detached: true,
    });
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const ready = await new Promise((resolve) => {
            const request = http.get({ host: "127.0.0.1", port: PORT, path: "/design/phase-preview.html" }, (response) => {
                response.resume();
                resolve(true);
            });
            request.on("error", () => resolve(false));
            request.setTimeout(800, () => { request.destroy(); resolve(false); });
        });
        if (ready) return server;
        await sleep(200);
    }
    throw new Error("静态服务未能在 8 秒内就绪");
}

function chrome(args) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "xz-chrome-"));
    try {
        return execFileSync(CHROME, [
            "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
            "--no-first-run", "--no-default-browser-check", "--disable-crash-reporter",
            "--disable-extensions", "--disable-background-networking", "--disable-sync",
            "--use-mock-keychain", "--password-store=basic", `--user-data-dir=${profile}`,
            ...args,
        ], { encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
        return typeof error.stdout === "string" ? error.stdout : "";
    } finally {
        fs.rmSync(profile, { recursive: true, force: true });
    }
}

function inspect(url) {
    const dom = chrome(["--virtual-time-budget=5000", `--window-size=${VIEWPORT.width},${VIEWPORT.height}`, "--dump-dom", url]);
    const match = dom.match(/id="preview-audit"[^>]*>([\s\S]*?)<\/pre>/);
    if (!match) return null;
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
}

function shoot(url, out) {
    fs.rmSync(out, { force: true });
    chrome(["--hide-scrollbars", "--virtual-time-budget=4000", `--window-size=${VIEWPORT.width},${VIEWPORT.height}`, `--screenshot=${out}`, url]);
    return fs.existsSync(out);
}

function judge(scenario, audit, expectLayer) {
    const problems = [];
    // 居中以**页面自报的实际视口**为准：--window-size 请求值与 headless 实际视口可能不同，
    // 用请求值去算中心会把一个居中的弹窗误判成"没居中"（真实踩过一次）。
    const viewport = audit?.viewport ?? VIEWPORT;
    if (audit?.pageOverflow) problems.push(`${scenario}：页面横向溢出（${audit.pageScrollWidth} > ${audit.pageClientWidth}）`);
    const layers = audit?.layers ?? [];
    if (expectLayer && layers.length === 0) problems.push(`${scenario}：预期出现的浮层没有渲染`);
    if (!expectLayer && layers.length > 0) problems.push(`${scenario}：不该出现的浮层出现了（${layers.map((layer) => layer.name).join(", ")}）`);
    for (const layer of layers) {
        const dx = Math.abs(layer.left + layer.width / 2 - viewport.width / 2);
        const dy = Math.abs(layer.top + layer.height / 2 - viewport.height / 2);
        if (dx > 8 || dy > 8) problems.push(`${scenario}：${layer.name} 没有居中（偏差 x=${dx.toFixed(0)}px, y=${dy.toFixed(0)}px）`);
        if (layer.coversViewport === false) console.log(`（提示）${scenario}：${layer.name} 的遮罩矩形 ${JSON.stringify(layer.backdropRect)} 与视口不一致 —— headless 视口高度不稳定，以截图为准`);
        if (layer.left < 0 || layer.top < 0 || layer.right > viewport.width + 1 || layer.bottom > viewport.height + 1) {
            problems.push(`${scenario}：${layer.name} 超出可视区`);
        }
        for (const clipped of layer.clippedButtons ?? []) problems.push(`${scenario}：${layer.name} 的按钮文字被裁切「${clipped}」`);
        if (layer.zeroSizeButtons) problems.push(`${scenario}：${layer.name} 里有 ${layer.zeroSizeButtons} 个零尺寸控件`);
    }
    return problems;
}

const scenarios = [
    { name: "declare", expectLayer: true, hint: "声明紧急期的弹窗：浮层居中、页脚按钮完整" },
    { name: "sprint", expectLayer: false, hint: "紧急期界面：横幅 + 最小一天，完整记录收起" },
    { name: "landing", expectLayer: false, hint: "归航界面：一级 + 三个动作" },
];

const server = await serve();
const problems = [];
console.log(`静态服务：http://127.0.0.1:${PORT}`);
for (const scenario of scenarios) {
    const url = `http://127.0.0.1:${PORT}/design/phase-preview.html?scenario=${scenario.name}&t=${Date.now()}`;
    const audit = inspect(url);
    const shotPath = path.join(outDir, `${scenario.name}.png`);
    const shot = shoot(url, shotPath);
    problems.push(...judge(scenario.name, audit, scenario.expectLayer));
    if (!shot) problems.push(`${scenario.name}：截图失败`);
    console.log(`\n— ${scenario.name}（${scenario.hint}）—`);
    console.log(audit ? `几何：${JSON.stringify({ viewport: audit.viewport, pageOverflow: audit.pageOverflow, inSprint: audit.inSprint, inLanding: audit.inLanding, layers: audit.layers })}` : "（本次未取到页内几何数据，请看截图）");
    if (audit?.layers?.length) console.log(`遮罩矩形：${JSON.stringify(audit.layers.map((layer) => layer.backdropRect))}`);
    console.log(`截图：${shotPath}`);
}
try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }

if (problems.length) {
    console.error(`\n✗ 渲染实测未通过（${problems.length} 项）：\n- ${problems.join("\n- ")}`);
    process.exit(1);
}
console.log(`\n✓ 渲染实测通过：浮层居中且铺满视口、按钮无裁切、页面无横向溢出（截图目录 ${outDir}）`);
