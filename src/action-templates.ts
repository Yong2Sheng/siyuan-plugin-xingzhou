/**
 * 行动细则模板（非关键 UI 数据）。
 *
 * 独立文件 action-templates.json，与 ui-state.json、trend-view.json 同级同性质：
 * 读取失败、文件损坏或字段非法时一律回落为空模板列表，绝不阻塞任何正式数据写入。
 *
 * 模板只保存**结构**（各字段的默认文字），套用时只填空字段，不覆盖已写内容。
 */
import { createEmptyActionDetail, normalizeActionDetail, type ActionDetail } from "./action-detail";

export const ACTION_TEMPLATE_FILE = "action-templates.json";
export const ACTION_TEMPLATE_VERSION = 1;

export const MAX_ACTION_TEMPLATES = 30;
const MAX_NAME_LENGTH = 40;

/** 模板里不含成果条目与迁移标记：成果是事实记录，不该被模板复制。 */
export type ActionTemplate = {
    name: string;
    currentState: string;
    background: string;
    prompt: string;
    guidance: string;
    definition: string;
};

export function defaultActionTemplates(): ActionTemplate[] {
    return [];
}

export function normalizeActionTemplate(value: unknown): ActionTemplate | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<ActionTemplate>;
    const name = typeof source.name === "string" ? source.name.trim().slice(0, MAX_NAME_LENGTH) : "";
    if (!name) return null;
    const detail = normalizeActionDetail({ ...source, outcomes: [] });
    return {
        name,
        currentState: detail.currentState,
        background: detail.background,
        prompt: detail.prompt,
        guidance: detail.guidance,
        definition: detail.definition,
    };
}

export function normalizeActionTemplates(value: unknown): ActionTemplate[] {
    if (!Array.isArray(value)) return [];
    const names = new Set<string>();
    const result: ActionTemplate[] = [];
    for (const raw of value) {
        const template = normalizeActionTemplate(raw);
        if (!template || names.has(template.name)) continue;
        names.add(template.name);
        result.push(template);
        if (result.length >= MAX_ACTION_TEMPLATES) break;
    }
    return result;
}

export function parseActionTemplates(value: unknown): ActionTemplate[] {
    if (value === null || value === undefined || value === "") return [];
    let parsed: unknown = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value);
        } catch {
            return [];
        }
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "templates" in (parsed as Record<string, unknown>)) {
        return normalizeActionTemplates((parsed as Record<string, unknown>).templates);
    }
    return normalizeActionTemplates(parsed);
}

export function wrapActionTemplates(templates: ActionTemplate[]): { version: number; templates: ActionTemplate[] } {
    return { version: ACTION_TEMPLATE_VERSION, templates: normalizeActionTemplates(templates) };
}

export function templateFromDetail(name: string, detail: ActionDetail): ActionTemplate {
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
    if (!trimmed) throw new Error("模板名称不能为空。");
    return {
        name: trimmed,
        currentState: detail.currentState,
        background: detail.background,
        prompt: detail.prompt,
        guidance: detail.guidance,
        definition: detail.definition,
    };
}

export function upsertActionTemplate(templates: ActionTemplate[], template: ActionTemplate): ActionTemplate[] {
    return normalizeActionTemplates([...templates.filter((candidate) => candidate.name !== template.name), template]);
}

export function removeActionTemplate(templates: ActionTemplate[], name: string): ActionTemplate[] {
    return templates.filter((template) => template.name !== name);
}

export function templateNames(templates: ActionTemplate[]): string[] {
    return templates.map((template) => template.name);
}

/**
 * 套用模板：**只填空字段**，已写内容一个字都不覆盖；成果与迁移标记保持原样。
 * 因此可以放心反复套用，也可以把它当成「补齐缺失字段」用。
 */
export function applyActionTemplate(detail: ActionDetail, template: ActionTemplate, now = Date.now()): ActionDetail {
    const filled: ActionDetail = { ...detail, updatedAt: now };
    for (const key of ["currentState", "background", "prompt", "guidance", "definition"] as const) {
        if (!filled[key].trim() && template[key].trim()) filled[key] = template[key];
    }
    return filled;
}

/** 空模板判断：全是空字段时没有保存价值。 */
export function isTemplateEmpty(template: ActionTemplate): boolean {
    return !template.currentState.trim() && !template.background.trim() && !template.prompt.trim()
        && !template.guidance.trim() && !template.definition.trim();
}

/** 把模板还原成一份细则草稿（预览或新建时使用）。 */
export function detailFromTemplate(template: ActionTemplate): ActionDetail {
    return {
        ...createEmptyActionDetail(),
        currentState: template.currentState,
        background: template.background,
        prompt: template.prompt,
        guidance: template.guidance,
        definition: template.definition,
    };
}
