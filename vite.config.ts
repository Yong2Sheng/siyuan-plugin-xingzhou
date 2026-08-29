import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import fg from "fast-glob";
import livereload from "rollup-plugin-livereload";
import { viteStaticCopy } from "vite-plugin-static-copy";
import zipPack from "vite-plugin-zip-pack";

const isDev = process.env.NODE_ENV === "development";
const outputDir = isDev ? "dev" : "dist";

export default defineConfig({
    publicDir: false,
    resolve: {
        alias: { "@": resolve(__dirname, "src") },
    },
    plugins: [
        svelte(),
        viteStaticCopy({
            targets: [
                { src: "./README.md", dest: "./" },
                { src: "./README.en.md", dest: "./" },
                { src: "./CHANGELOG.md", dest: "./" },
                { src: "./CHANGELOG.en.md", dest: "./" },
                { src: "./LICENSE", dest: "./" },
                { src: "./plugin.json", dest: "./" },
                { src: "./preview.png", dest: "./" },
                { src: "./icon.png", dest: "./" },
                { src: "./public/i18n/*.json", dest: "./i18n" },
            ],
        }),
    ],
    build: {
        outDir: outputDir,
        emptyOutDir: true,
        minify: true,
        sourcemap: isDev ? "inline" : false,
        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            fileName: () => "index.js",
            formats: ["cjs"],
        },
        rollupOptions: {
            plugins: isDev
                ? [livereload(outputDir), watchExternalFiles(["public/i18n/*.json", "README*.md", "CHANGELOG*.md", "plugin.json"])]
                : [zipPack({ inDir: "./dist", outDir: "./", outFileName: "package.zip" })],
            external: ["siyuan", "process"],
            output: {
                entryFileNames: "index.js",
                assetFileNames: (assetInfo) => assetInfo.name === "style.css" ? "index.css" : (assetInfo.name ?? "assets/[name]-[hash][extname]"),
            },
        },
    },
    test: {
        environment: "jsdom",
        include: ["tests/**/*.test.ts"],
        alias: { siyuan: resolve(__dirname, "tests/siyuan-mock.ts") },
    },
});

function watchExternalFiles(patterns: string[]): Plugin {
    return {
        name: "watch-external-files",
        async buildStart() {
            for (const file of await fg(patterns)) this.addWatchFile(file);
        },
    };
}
