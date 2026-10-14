#!/usr/bin/env node
/**
 * 起一个"真实组件预览"：一条命令完成构建 + 起服务 + 打印地址。
 *
 * 用法：node scripts/preview.mjs <预览名> [--port 8137]
 *   预览名对应 design/vite.<名>-preview.config.mjs 与 design/<名>-preview.html，
 *   例如 `node scripts/preview.mjs phase`。
 *
 * 为什么存在这个脚本（见 AGENTS.md《UI 预览：必须渲染真实组件》）：
 * 手抄 HTML 做界面预览会漂、会掩盖真问题，属于无效预览。这里保证每次给用户看的界面
 * 都是真实 Svelte 组件 + 构建产物 dist/index.css 渲染出来的。
 *
 * 它不写任何用户数据：预览入口用内存对象充当 load/save（见 design/*-preview.ts）。
 */
/*
 * 每一步都带超时：卡住就失败退出。
 * 真实事故：这两段构建用的是同步调用、又没有超时，某次卡住之后整个脚本不返回，
 * 白白等了两小时。任何"可能不返回"的调用都必须有上限，这不只是性能问题，是不要在无人值守时烧时间。
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const name = args.find((value) => !value.startsWith("--"));
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8137;

if (!name) {
    console.error("用法：node scripts/preview.mjs <预览名> [--port 8137]");
    console.error("可用预览：");
    for (const file of fs.readdirSync(path.join(ROOT, "design"))) {
        const match = /^vite\.(.+)-preview\.config\.mjs$/.exec(file);
        if (match) console.error(`  - ${match[1]}`);
    }
    process.exit(2);
}

const config = path.join(ROOT, "design", `vite.${name}-preview.config.mjs`);
const page = path.join(ROOT, "design", `${name}-preview.html`);
if (!fs.existsSync(config) || !fs.existsSync(page)) {
    console.error(`没有找到 ${name} 的预览配置或页面：${path.relative(ROOT, config)} / ${path.relative(ROOT, page)}`);
    process.exit(2);
}

try {
console.log("① 生成生产样式（预览必须引用构建产物 dist/index.css，不能引用源码样式）");
execFileSync("pnpm", ["build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, CI: "true" }, timeout: 180000 });

console.log(`② 构建 ${name} 预览（真实组件 + 真实样式）`);
execFileSync("npx", ["--yes", "vite", "build", "--config", path.relative(ROOT, config)], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], timeout: 180000 });

/*
 * 构建完成后把 HTML 的 script src 指到**本次真实产物**（文件名带内容指纹）。
 * 之前靠 ?v= 时间戳，DSH 内置预览窗口不吃这套、一直给旧界面；改成指纹文件名后缓存无从命中。
 */
const builtFiles = fs.readdirSync(path.join(ROOT, "design")).filter((file) => /^phase-preview\.[A-Za-z0-9_-]+\.js$/.test(file));
if (!builtFiles.length) {
    console.error("✗ 没有找到本次构建的预览脚本（期望 design/phase-preview.<hash>.js）");
    process.exit(1);
}
/*
 * 必须按修改时间取最新产物，不能按文件名排序：
 * 文件名里的哈希是随机的，字母序与新旧无关——之前就因此每次都挑中旧文件，
 * 于是"我构建了、用户看到的还是旧界面"（真实事故）。
 */
const built = builtFiles
    .map((file) => ({ file, at: fs.statSync(path.join(ROOT, "design", file)).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0].file;
// 清掉其它历史产物，避免目录里堆一堆同名旧脚本
for (const file of builtFiles) {
    if (file !== built) fs.rmSync(path.join(ROOT, "design", file), { force: true });
}
const pageHtml = fs.readFileSync(page, "utf8");
const rewritten = pageHtml.replace(/src="\.\/[^"]+"/, `src="./${built}"`);
if (rewritten !== pageHtml) fs.writeFileSync(page, rewritten);
console.log(`   预览脚本：design/${built}`);

/**
 * 产物自检：把"这次改动应当从界面上消失的文案"列在这里，
 * 只要还出现在预览脚本或插件产物里就直接失败——不允许再出现
 * "源码改了就说改好了"的情况（真实事故：用户看到的仍是旧界面）。
 */
const REMOVED_UI_STRINGS = ["今天仍在紧急期", "展开完整记录"];
const bundleFiles = [
    path.join(ROOT, "design", "dist-phase-preview.js"),
    path.join(ROOT, "dist", "index.js"),
];
for (const file of bundleFiles) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    for (const removed of REMOVED_UI_STRINGS) {
        if (content.includes(removed)) {
            console.error(`✗ 产物自检失败：${path.relative(ROOT, file)} 里仍然存在已删除的界面文案「${removed}」`);
            process.exit(1);
        }
    }
}

} catch (error) {
    console.error(`构建失败或超时（180 秒上限）：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}

const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: ROOT, stdio: ["ignore", "ignore", "ignore"], detached: true,
});

const url = `http://127.0.0.1:${port}/design/${name}-preview.html`;
const ready = await new Promise((resolve) => {
    let attempt = 0;
    const probe = () => {
        attempt += 1;
        const request = http.get({ host: "127.0.0.1", port, path: `/design/${name}-preview.html` }, (response) => {
            response.resume();
            resolve(true);
        });
        request.on("error", () => (attempt > 40 ? resolve(false) : setTimeout(probe, 200)));
        request.setTimeout(800, () => { request.destroy(); });
    };
    probe();
});

if (!ready) {
    console.error("静态服务未能就绪");
    try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
    process.exit(1);
}

console.log(`\n③ 预览已就绪：${url}`);
console.log("   · 框里的界面是真实组件渲染的；外壳（容器宽度与按钮条）与思源标签页不同");
console.log("   · 数据只在页面内存里，不会写入你的行舟数据");
console.log("   · 跨天用页面上的「推进一天」，不要改系统时间");
console.log(`\n   截图：node scripts/shot-preview.mjs "${url}" /tmp/preview.png 1460 1200`);
console.log(`   停掉：kill ${server.pid}`);
