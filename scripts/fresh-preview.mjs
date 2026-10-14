#!/usr/bin/env node
/**
 * 一步到位：构建预览 → 改写 HTML 指向新产物 → 校验页面真的指向它 → 校验产物含最新标记。
 *
 * 为什么存在（真实事故）：我多次改完源码忘记重建沙盒，用户在新代码上看到的仍是旧界面，
 * 于是"你改了但我这里没变"反复发生、信任被耗尽。
 * 从今以后不要手敲 build + 改 HTML：一律运行本脚本，它会在任一步失败时**大声报错并返回非 0**。
 *
 * 用法：node scripts/fresh-preview.mjs phase          # 沙盒
 *      node scripts/fresh-preview.mjs rungs          # 归航各级自测页
 *      node scripts/fresh-preview.mjs phase rungs   # 两个都做
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = {
    phase: { config: "design/vite.phase-preview.config.mjs", html: "design/phase-preview.html", prefix: "phase-preview." },
    rungs: { config: "design/vite.phase-rungs.config.mjs", html: "design/phase-rungs.html", prefix: "phase-rungs." },
    twodays: { config: "design/vite.phase-two-days.config.mjs", html: "design/phase-two-days.html", prefix: "phase-two-days." },
};

/** 本次修复必须出现在产物里的标记：产物里找不到就说明我改的源码没进构建。 */
const REQUIRED_MARKERS = ["data-wake-only", "data-form-block", "rungForDate"];

const names = process.argv.slice(2).filter((name) => name in TARGETS);
if (names.length === 0) {
    console.error("用法：node scripts/fresh-preview.mjs phase|rungs|twodays [更多目标]");
    process.exit(2);
}

let failed = false;
for (const name of names) {
    const target = TARGETS[name];
    console.log(`\n=== ${name} ===`);
    try {
        execFileSync("npx", ["--yes", "vite", "build", "--config", target.config], {
            cwd: ROOT, stdio: "inherit", timeout: 180_000,
        });
    } catch {
        console.error(`构建失败（${target.config}）——停止，不更新页面`);
        failed = true;
        continue;
    }

    const bundle = fs.readdirSync(path.join(ROOT, "design"))
        .filter((file) => file.startsWith(target.prefix) && file.endsWith(".js"))
        .map((file) => ({ file, at: fs.statSync(path.join(ROOT, "design", file)).mtimeMs }))
        .sort((a, b) => b.at - a.at)[0];
    if (!bundle) {
        console.error("没有找到构建产物——停止");
        failed = true;
        continue;
    }

    const htmlPath = path.join(ROOT, target.html);
    const html = fs.readFileSync(htmlPath, "utf-8");
    const rewritten = html.replace(/src="\.\/[^"]+"/, `src="./${bundle.file}"`);
    fs.writeFileSync(htmlPath, rewritten);

    // 校验 1：页面确实指向这个产物
    const pointsTo = /src="\.\/([^"]+)"/.exec(rewritten)?.[1];
    const okPointer = pointsTo === bundle.file;
    // 校验 2：产物里确实含本次改动
    const content = fs.readFileSync(path.join(ROOT, "design", bundle.file), "utf-8");
    const missing = REQUIRED_MARKERS.filter((marker) => !content.includes(marker));

    console.log(`产物：${bundle.file}（${(fs.statSync(path.join(ROOT, "design", bundle.file)).size / 1024).toFixed(0)} KB）`);
    console.log(`页面指向：${pointsTo} ${okPointer ? "✓" : "✗ 不一致"}`);
    console.log(`产物含最新标记：${missing.length === 0 ? "✓ " + REQUIRED_MARKERS.join(" / ") : "✗ 缺少 " + missing.join(" / ")}`);
    if (!okPointer || missing.length > 0) failed = true;
}

if (failed) {
    console.error("\n❌ 校验未通过：页面可能在展示旧产物，请勿交给用户验证。");
    process.exit(1);
}
console.log("\n✅ 预览已重建并校验：页面指向最新产物，且产物含本次改动。");
