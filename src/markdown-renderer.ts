type LuteInstance = {
    SetBlockRef?: (enabled: boolean) => void;
    SetGFMStrikethrough?: (enabled: boolean) => void;
    SetInlineMath?: (enabled: boolean) => void;
    SetSoftBreak2HardBreak?: (enabled: boolean) => void;
    SetTag?: (enabled: boolean) => void;
    Md2HTML: (markdown: string) => string;
};

type LuteConstructor = {
    New: () => LuteInstance;
    Sanitize: (html: string) => string;
};

export function renderActionMarkdown(markdown: string): string {
    if (!markdown.trim()) return "";

    const Lute = (globalThis as typeof globalThis & { Lute?: LuteConstructor }).Lute;
    if (typeof Lute?.New !== "function" || typeof Lute.Sanitize !== "function") {
        return fallbackPreview(markdown);
    }

    try {
        const lute = Lute.New();
        lute.SetBlockRef?.(true);
        lute.SetGFMStrikethrough?.(true);
        lute.SetInlineMath?.(true);
        lute.SetSoftBreak2HardBreak?.(true);
        lute.SetTag?.(true);
        return Lute.Sanitize(lute.Md2HTML(markdown));
    } catch {
        return fallbackPreview(markdown);
    }
}

function fallbackPreview(markdown: string): string {
    const escaped = markdown
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    return `<p>${escaped.replaceAll("\n", "<br>")}</p>`;
}
