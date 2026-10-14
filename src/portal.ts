/**
 * 把浮层挂到 `document.body` 的 Svelte action。
 *
 * 为什么必须这么做（真实事故，两条都踩过）：
 * 1. 浮层如果留在页面布局容器里（例如 `.xz-daily-layout` 这个 grid），它会变成网格项被摆到某一栏，
 *    看起来"弹窗跑到右下角"；
 * 2. 即使写了 `position: fixed`，只要祖先里有 `container-type: inline-size`（行舟的 `.xz-app`
 *    与预览容器都有），固定定位就不再相对视口，遮罩只能盖住容器那一段，顶部会露出来。
 *
 * 因此：**任何模态浮层都挂到 body 上**，由 body 之外的层级保证它相对视口定位。
 * 卸载时把节点摘掉，避免反复打开弹窗时在 body 上堆积节点。
 */
export function portal(node: HTMLElement) {
    const parent = node.parentElement;
    const anchor = document.createComment("xz-portal");
    parent?.insertBefore(anchor, node);
    document.body.appendChild(node);
    return {
        destroy() {
            node.remove();
            anchor.remove();
        },
    };
}
