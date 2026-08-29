import { DEFAULT_ALL_ITEMS_VIEW_NAME } from "./config";
import { requestSiYuan } from "./siyuan-api";

export const FIELD_NAMES = {
    title: ["工作项", "项目／事务", "项目/事务"],
    type: ["工作项类型", "类型"],
    status: ["状态"],
    currentAction: ["本次行动细则", "本次行动计划", "本次行动目标"],
    nextAction: ["下一步行动"],
    parent: ["上层工作项", "父项"],
    topProject: ["所属顶层项目", "顶层项目"],
    planDate: ["计划日期"],
    deadline: ["截止日期"],
    duration: ["预计时长（分钟）", "预计时长(分钟)", "预计时长"],
    energy: ["所需精力"],
} as const;

export type RawCellValue = {
    keyID?: string;
    id?: string;
    blockID?: string;
    type?: string;
    isDetached?: boolean;
    text?: { content?: string };
    number?: { content?: number; formattedContent?: string; isNotEmpty?: boolean };
    mSelect?: Array<{ content?: string; color?: string }>;
    block?: { content?: string; id?: string; icon?: string };
    checkbox?: { checked?: boolean };
    relation?: { blockIDs?: string[]; contents?: RawCellValue[] };
    date?: RawDateValue;
    created?: RawDateValue;
    updated?: RawDateValue;
};

type RawDateValue = {
    content?: number;
    isNotEmpty?: boolean;
    formattedContent?: string;
};

export type RawCell = {
    id?: string;
    valueType?: string;
    value: RawCellValue;
};

export type RenderedAttributeView = {
    id: string;
    name: string;
    viewID: string;
    viewType: string;
    views: Array<{ id: string; name: string; type: string }>;
    view: {
        columns?: Array<{ id: string; name: string; type: string }>;
        rows?: Array<{ id: string; cells: RawCell[] }>;
    };
};

type AttributeViewDefinition = {
    av?: {
        id: string;
        name: string;
        views?: Array<{ id: string; name: string; type: string }>;
    };
};

export type WorkItem = {
    id: string;
    rowId: string;
    title: string;
    documentId: string | null;
    detached: boolean;
    type: string;
    status: string;
    currentAction: string;
    nextAction: string;
    parentIds: string[];
    topProjectIds: string[];
    planDate: number | null;
    deadline: number | null;
    durationMinutes: number | null;
    energy: string;
};

export type WorkItemData = {
    attributeViewId: string;
    attributeViewName: string;
    viewId: string;
    items: WorkItem[];
    missingFields: string[];
};

export async function loadWorkItems(attributeViewId: string): Promise<WorkItemData> {
    const definition = await requestSiYuan<AttributeViewDefinition>("/api/av/getAttributeView", {
        id: attributeViewId,
    });
    const views = definition.av?.views ?? [];
    const allItemsView = views.find((view) => view.name === DEFAULT_ALL_ITEMS_VIEW_NAME)
        ?? views.find((view) => view.type === "table")
        ?? views[0];

    const rendered = await requestSiYuan<RenderedAttributeView>("/api/av/renderAttributeView", {
        id: attributeViewId,
        viewID: allItemsView?.id ?? "",
        pageSize: 9999,
        groupPaging: {},
        query: "",
        blockID: "",
        initialLayout: "table",
        createIfNotExist: false,
    });
    return parseRenderedAttributeView(rendered);
}

export function parseRenderedAttributeView(rendered: RenderedAttributeView): WorkItemData {
    const columns = rendered.view.columns ?? [];
    const rows = rendered.view.rows ?? [];
    const columnIdByRole = new Map<string, string>();

    for (const [role, aliases] of Object.entries(FIELD_NAMES)) {
        const column = columns.find((candidate) => (aliases as readonly string[]).includes(candidate.name));
        if (column) columnIdByRole.set(role, column.id);
    }

    const missingFields = ["title", "type", "status", "currentAction", "nextAction", "parent", "topProject", "planDate", "deadline", "duration", "energy"]
        .filter((role) => !columnIdByRole.has(role))
        .map((role) => FIELD_NAMES[role as keyof typeof FIELD_NAMES][0]);

    const items = rows.map((row): WorkItem | null => {
        const values = new Map<string, RawCellValue>();
        for (const cell of row.cells) {
            const keyId = cell.value.keyID ?? cell.id;
            if (keyId) values.set(keyId, cell.value);
        }
        const get = (role: string) => {
            const keyId = columnIdByRole.get(role);
            return keyId ? values.get(keyId) : undefined;
        };
        const primary = get("title");
        const title = extractText(primary);
        if (!primary || !title) return null;
        const id = primary.blockID || primary.block?.id || row.id;
        return {
            id,
            rowId: row.id,
            title,
            documentId: primary.isDetached ? null : (primary.block?.id || primary.blockID || null),
            detached: Boolean(primary.isDetached),
            type: extractSelect(get("type")),
            status: extractSelect(get("status")),
            currentAction: extractText(get("currentAction")),
            nextAction: extractText(get("nextAction")),
            parentIds: extractRelations(get("parent")),
            topProjectIds: extractRelations(get("topProject")),
            planDate: extractDate(get("planDate")),
            deadline: extractDate(get("deadline")),
            durationMinutes: extractNumber(get("duration")),
            energy: extractSelect(get("energy")),
        };
    }).filter((item): item is WorkItem => item !== null);

    return {
        attributeViewId: rendered.id,
        attributeViewName: rendered.name,
        viewId: rendered.viewID,
        items,
        missingFields,
    };
}

function extractText(value?: RawCellValue): string {
    return value?.block?.content?.trim()
        || value?.text?.content?.trim()
        || value?.number?.formattedContent?.trim()
        || "";
}

function extractSelect(value?: RawCellValue): string {
    return value?.mSelect?.map((option) => option.content?.trim()).filter(Boolean).join("、") ?? "";
}

function extractRelations(value?: RawCellValue): string[] {
    return [...new Set(value?.relation?.blockIDs?.filter(Boolean) ?? [])];
}

function extractNumber(value?: RawCellValue): number | null {
    const content = value?.number?.content;
    return typeof content === "number" && Number.isFinite(content) ? content : null;
}

function extractDate(value?: RawCellValue): number | null {
    const date = value?.date ?? value?.created ?? value?.updated;
    return date?.isNotEmpty && typeof date.content === "number" ? date.content : null;
}
