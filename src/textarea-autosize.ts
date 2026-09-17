/** 高度余量：吸收行高舍入，避免可见高度比内容高度少 1–2px 导致的内部跟随滚动。 */
const LENGTH_TOLERANCE = 4;

export function autoResizeTextarea(node: HTMLTextAreaElement, _value = "") {
    let observedWidth = -1;

    /**
     * 测量并设置高度。
     * 关键点：`height = auto` 会让 textarea 立刻塌到 min-height，布局会抖动一帧——
     * 用户恰好在这一帧点击时，点到的是另一行。所以整个测量必须同步完成，并在同一个任务里
     * 还原高度；同时把编辑框自身的内部滚动强制归零，外层滚动容器的位置也要保持不变。
     */
    const measure = () => {
        const styles = getComputedStyle(node);
        const minimumHeight = Number.parseFloat(styles.minHeight) || 0;
        const scroller = node.parentElement;
        const previousScrollerTop = scroller ? scroller.scrollTop : 0;
        node.style.height = "auto";
        // 高度 = 内容高度 + 固定余量。
        // 余量是必要的：行高与内边距的舍入会让可见高度比内容高度少 1–2px，
        // 于是每次输入浏览器都"跟随光标"滚一点点（看起来像被拉到可见区底部）。
        // 这里用固定值而不是"实测差额"——差额会随测量时机变化，可能被重复计入而把高度撑成两倍。
        const nextHeight = Math.max(node.scrollHeight + LENGTH_TOLERANCE, minimumHeight);
        node.style.height = `${nextHeight}px`;

        // 编辑框一律不允许内部滚动：高度已经等于内容高度，任何内部滚动都只会让点击落点错位
        if (node.scrollTop !== 0) node.scrollTop = 0;
        if (scroller && scroller.scrollTop !== previousScrollerTop) scroller.scrollTop = previousScrollerTop;
    };

    // 兜底：即便被别处（浏览器跟随光标、宿主）改了内部滚动，也立刻归零
    const handleScroll = () => {
        if (node.scrollTop !== 0) node.scrollTop = 0;
    };

    const handleWindowResize = () => measure();
    node.addEventListener("scroll", handleScroll);
    node.addEventListener("input", measure);
    window.addEventListener("resize", handleWindowResize);
    measure();

    // 观测器只用于「宽度变化」（换行数变了才需要重新量高度）。
    // 回调里同步改高度会再次触发观测 → 无限重排，所以这里只按宽度判断，绝不回写。
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(([entry]) => {
        const width = entry?.contentRect.width ?? node.clientWidth;
        if (width === observedWidth) return;
        observedWidth = width;
        measure();
    });
    observer?.observe(node);

    return {
        update: measure,
        destroy() {
            observer?.disconnect();
            node.removeEventListener("scroll", handleScroll);
            node.removeEventListener("input", measure);
            window.removeEventListener("resize", handleWindowResize);
        },
    };
}
