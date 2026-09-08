#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$script_dir/.." && pwd)"
plugin_dir="${XINGZHOU_PLUGIN_DIR:-/Users/shengyong/SiYuan/data/plugins/siyuan-plugin-xingzhou}"

cd "$project_dir"

if ! command -v pnpm >/dev/null 2>&1; then
    echo "错误：未找到 pnpm。" >&2
    exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
    echo "错误：未找到 rsync。" >&2
    exit 1
fi

if [[ ! -d "$(dirname -- "$plugin_dir")" ]]; then
    echo "错误：思源插件目录的上级路径不存在：$(dirname -- "$plugin_dir")" >&2
    exit 1
fi

echo "正在生成生产构建……"
CI=true pnpm build

for asset in index.js index.css; do
    if [[ ! -f "dist/$asset" ]]; then
        echo "错误：生产构建缺少 dist/$asset。" >&2
        exit 1
    fi
done

echo "正在部署到：$plugin_dir"
mkdir -p "$plugin_dir"
rsync -a dist/ "$plugin_dir/"

echo "正在校验部署文件……"
for asset in index.js index.css; do
    source_hash="$(shasum -a 256 "dist/$asset" | awk '{print $1}')"
    deployed_hash="$(shasum -a 256 "$plugin_dir/$asset" | awk '{print $1}')"
    if [[ "$source_hash" != "$deployed_hash" ]]; then
        echo "错误：$asset 部署后的校验值不一致。" >&2
        exit 1
    fi
    echo "✓ $asset  $source_hash"
done

echo "完成：生产构建已部署。请重新加载或重启行舟插件。"
