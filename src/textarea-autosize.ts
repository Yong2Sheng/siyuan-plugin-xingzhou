export function autoResizeTextarea(node: HTMLTextAreaElement, _value = "") {
    let observedWidth = 0;

    const resize = () => {
        const minimumHeight = Number.parseFloat(getComputedStyle(node).minHeight) || 0;
        node.style.height = "auto";
        node.style.height = `${Math.max(node.scrollHeight, minimumHeight)}px`;
    };

    const handleResize = () => resize();
    node.addEventListener("input", resize);
    window.addEventListener("resize", handleResize);
    resize();

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(([entry]) => {
        const width = entry?.contentRect.width ?? node.clientWidth;
        if (width === observedWidth) return;
        observedWidth = width;
        resize();
    });
    observer?.observe(node);

    return {
        update: resize,
        destroy() {
            observer?.disconnect();
            node.removeEventListener("input", resize);
            window.removeEventListener("resize", handleResize);
        },
    };
}
