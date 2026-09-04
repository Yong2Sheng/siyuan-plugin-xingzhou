import { DEFAULT_ALL_ITEMS_VIEW_NAME, DEFAULT_INBOX_VIEW_NAME } from "./config";
import type { ExecutionSlice } from "./execution-slices";
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
    noDeadline: ["无截止日期"],
    duration: ["预计时长（分钟）", "预计时长(分钟)", "预计时长"],
    energy: ["所需精力"],
    updatedAt: ["最近更新"],
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

export type AttributeViewDefinition = {
    av?: {
        id: string;
        name: string;
        views?: Array<{ id: string; name: string; type: string }>;
        keyValues?: Array<{
            key: {
                id: string;
                name: string;
                type: string;
                options?: Array<{ name: string; color?: string; desc?: string }>;
            };
        }>;
    };
};

export type EditableWorkItemField = "title" | "type" | "status" | "currentAction" | "nextAction" | "parent" | "topProject" | "planDate" | "deadline" | "noDeadline" | "duration" | "energy";

export type WorkItemField = {
    id: string;
    name: string;
    type: string;
    options: Array<{ name: string; color?: string; desc?: string }>;
};

export type WorkItemChanges = Partial<Record<EditableWorkItemField, string | number | boolean | null>> & {
    hardPrerequisites?: string[];
    softPrerequisites?: string[];
    completedDates?: string[];
    sliceTargetCount?: number | null;
    executionSlices?: ExecutionSlice[];
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
    hardPrerequisiteIds?: string[];
    softPrerequisiteIds?: string[];
    /** 在本周视图中逐日完成的本地日期（YYYY-MM-DD）。 */
    completedDates?: string[];
    /** 事务需要完成的有效执行切片总数；失败或放弃的尝试不扩大分母。 */
    sliceTargetCount?: number | null;
    /** 事务的执行尝试。它们不是工作项，也不参与上下层关系。 */
    executionSlices?: ExecutionSlice[];
    planDate: number | null;
    deadline: number | null;
    noDeadline: boolean;
    durationMinutes: number | null;
    energy: string;
    updatedAt: number | null;
    /** 同一直接上层内的手动显示顺序；旧数据未排序时为空。 */
    sortOrder?: number | null;
};

export type WorkItemData = {
    attributeViewId: string;
    attributeViewName: string;
    viewId: string;
    items: WorkItem[];
    missingFields: string[];
    fields: Partial<Record<keyof typeof FIELD_NAMES, WorkItemField>>;
};

export type WorkItemViewState = {
    page: "week" | "all" | "inbox" | "review";
    filter: "all" | "active" | "future" | "closed";
    includeClosed: boolean;
    scope: "all" | string;
    selectedId: string | null;
    expandedIds: string[];
    weekStart: number;
    sidebarScrollTop: number;
    treeScrollTop: number;
    detailScrollTop: number;
};

export type InboxCaptureOptions = {
    type?: string;
    status?: string;
    parentId?: string;
    topProjectId?: string;
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
    const data = parseRenderedAttributeView(rendered);
    data.fields = {
        ...data.fields,
        ...readFieldDefinitions(definition),
    };
    return data;
}

export async function updateWorkItem(
    data: WorkItemData,
    item: WorkItem,
    changes: WorkItemChanges,
): Promise<WorkItemData> {
    const entries = Object.entries(changes).filter(([role]) => role !== "hardPrerequisites" && role !== "softPrerequisites" && role !== "completedDates") as Array<[EditableWorkItemField, string | number | boolean | null]>;
    for (const [role, content] of entries) {
        const field = data.fields[role];
        if (!field) throw new Error(`当前数据库中没有“${FIELD_NAMES[role][0]}”字段。`);
        await requestSiYuan("/api/av/setAttributeViewBlockAttr", {
            avID: data.attributeViewId,
            keyID: field.id,
            itemID: item.rowId,
            value: buildCellValue(role, content, field, item),
        });
    }

    const refreshed = await loadWorkItems(data.attributeViewId);
    const updated = refreshed.items.find((candidate) => candidate.rowId === item.rowId);
    if (!updated) throw new Error("思源已接受修改请求，但复核时没有找到该条目。");
    for (const [role, expected] of entries) {
        if (!matchesUpdatedValue(updated, role, expected)) {
            throw new Error(`“${FIELD_NAMES[role][0]}”未通过写入复核，请打开原始数据库检查。`);
        }
    }
    return refreshed;
}

export async function deleteWorkItem(
    data: WorkItemData,
    item: WorkItem,
): Promise<WorkItemData> {
    await requestSiYuan<null>("/api/av/removeAttributeViewBlocks", {
        avID: data.attributeViewId,
        srcIDs: [item.rowId],
    });

    const refreshed = await loadWorkItems(data.attributeViewId);
    if (refreshed.items.some((candidate) => candidate.rowId === item.rowId)) {
        throw new Error("思源已接受删除请求，但复核时仍然找到了该条目。请打开原始数据库检查。");
    }
    return refreshed;
}

export type InboxCapturePayload = {
    avID: string;
    blockID: string;
    viewID: string;
    groupID: string;
    previousID: string;
    srcs: Array<{
        id: string;
        itemID: string;
        isDetached: true;
        content: string;
    }>;
    ignoreDefaultFill: false;
};

export async function captureInboxItem(
    attributeViewId: string,
    databaseBlockId: string,
    title: string,
    createItemId: () => string = createSiYuanNodeId,
    options: InboxCaptureOptions = {},
): Promise<WorkItemData> {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new Error("请输入要记录的内容。");
    if (!databaseBlockId) throw new Error("尚未配置数据库块 ID，无法写入收件箱。");

    const definition = await requestSiYuan<AttributeViewDefinition>("/api/av/getAttributeView", {
        id: attributeViewId,
    });
    const inboxViewId = findInboxViewId(definition);
    const itemId = createItemId();
    if (!/^\d{14}-[a-z0-9]{7}$/.test(itemId)) throw new Error("思源没有生成有效的收件箱条目 ID。");

    await requestSiYuan<null>("/api/av/addAttributeViewBlocks", buildInboxCapturePayload({
        attributeViewId,
        databaseBlockId,
        inboxViewId,
        itemId,
        title: normalizedTitle,
    }));

    let data: WorkItemData | undefined;
    let created: WorkItem | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        data = await loadWorkItems(attributeViewId);
        created = data.items.find((item) => item.id === itemId || item.rowId === itemId);
        if (created?.status === "收件箱") break;
        if (attempt < 2) await delay(120 * (attempt + 1));
    }
    if (!created) throw new Error("思源已接受新增请求，但刷新后没有找到新条目。请打开原始数据库检查。");
    if (created.status !== "收件箱" || !data) {
        throw new Error(`新条目已创建，但状态为“${created.status || "空"}”，未进入收件箱。请检查原生视图筛选条件。`);
    }

    const changes: WorkItemChanges = {};
    if (options.type) changes.type = options.type;
    if (options.status) changes.status = options.status;
    if (options.parentId) changes.parent = options.parentId;
    if (options.topProjectId) changes.topProject = options.topProjectId;
    return Object.keys(changes).length > 0 ? updateWorkItem(data, created, changes) : data;
}

export function findInboxViewId(definition: AttributeViewDefinition): string {
    const view = definition.av?.views?.find((candidate) => candidate.name === DEFAULT_INBOX_VIEW_NAME);
    if (!view) throw new Error(`属性视图中未找到“${DEFAULT_INBOX_VIEW_NAME}”视图。`);
    if (view.type !== "table") throw new Error(`“${DEFAULT_INBOX_VIEW_NAME}”当前不是表格视图。`);
    return view.id;
}

export function buildInboxCapturePayload(input: {
    attributeViewId: string;
    databaseBlockId: string;
    inboxViewId: string;
    itemId: string;
    title: string;
}): InboxCapturePayload {
    return {
        avID: input.attributeViewId,
        blockID: input.databaseBlockId,
        viewID: input.inboxViewId,
        groupID: "",
        previousID: "",
        srcs: [{
            id: input.itemId,
            itemID: input.itemId,
            isDetached: true,
            content: input.title,
        }],
        ignoreDefaultFill: false,
    };
}

export function parseRenderedAttributeView(rendered: RenderedAttributeView): WorkItemData {
    const columns = rendered.view.columns ?? [];
    const rows = rendered.view.rows ?? [];
    const columnIdByRole = new Map<string, string>();

    for (const [role, aliases] of Object.entries(FIELD_NAMES)) {
        const column = columns.find((candidate) => (aliases as readonly string[]).includes(candidate.name));
        if (column) columnIdByRole.set(role, column.id);
    }

    const missingFields = ["title", "type", "status", "currentAction", "nextAction", "parent", "topProject", "planDate", "deadline", "noDeadline", "duration", "energy"]
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
            hardPrerequisiteIds: [],
            softPrerequisiteIds: [],
            completedDates: [],
            planDate: extractDate(get("planDate")),
            deadline: extractDate(get("deadline")),
            noDeadline: extractCheckbox(get("noDeadline")),
            durationMinutes: extractNumber(get("duration")),
            energy: extractSelect(get("energy")),
            updatedAt: extractDate(get("updatedAt")),
        };
    }).filter((item): item is WorkItem => item !== null);

    return {
        attributeViewId: rendered.id,
        attributeViewName: rendered.name,
        viewId: rendered.viewID,
        items,
        missingFields,
        fields: Object.fromEntries([...columnIdByRole.entries()].map(([role, id]) => {
            const column = columns.find((candidate) => candidate.id === id)!;
            return [role, { id, name: column.name, type: column.type, options: [] }];
        })),
    };
}

function readFieldDefinitions(definition: AttributeViewDefinition): Partial<Record<keyof typeof FIELD_NAMES, WorkItemField>> {
    const result: Partial<Record<keyof typeof FIELD_NAMES, WorkItemField>> = {};
    for (const [role, aliases] of Object.entries(FIELD_NAMES) as Array<[keyof typeof FIELD_NAMES, readonly string[]]>) {
        const key = definition.av?.keyValues?.find((candidate) => aliases.includes(candidate.key.name))?.key;
        if (key) result[role] = { id: key.id, name: key.name, type: key.type, options: key.options ?? [] };
    }
    return result;
}

function buildCellValue(role: EditableWorkItemField, content: string | number | boolean | null, field: WorkItemField, item: WorkItem): RawCellValue {
    if (role === "title") {
        const block: { content: string; id?: string } = { content: String(content ?? "").trim() };
        if (item.documentId) block.id = item.documentId;
        return { type: "block", block, isDetached: item.detached };
    }
    if (role === "currentAction" || role === "nextAction") return { type: "text", text: { content: String(content ?? "") } };
    if (role === "parent" || role === "topProject") {
        const relationId = String(content ?? "");
        return { type: "relation", relation: { blockIDs: relationId ? [relationId] : [], contents: [] } };
    }
    if (role === "duration") {
        const number = content === null || content === "" ? null : Number(content);
        return {
            type: "number",
            number: number === null || !Number.isFinite(number)
                ? { content: 0, isNotEmpty: false }
                : { content: number, isNotEmpty: true },
        };
    }
    if (role === "noDeadline") return { type: "checkbox", checkbox: { checked: Boolean(content) } };
    if (role === "planDate" || role === "deadline") {
        const timestamp = typeof content === "number" ? content : content ? new Date(`${content}T00:00:00`).getTime() : 0;
        return { type: "date", date: { content: timestamp, isNotEmpty: Boolean(content) } };
    }
    const optionName = String(content ?? "");
    const option = field.options.find((candidate) => candidate.name === optionName);
    return {
        type: field.type,
        mSelect: optionName ? [{ content: optionName, color: option?.color ?? "1" }] : [],
    };
}

function matchesUpdatedValue(item: WorkItem, role: EditableWorkItemField, expected: string | number | boolean | null): boolean {
    if (role === "title") return item.title === String(expected ?? "").trim();
    if (role === "type") return item.type === String(expected ?? "");
    if (role === "status") return item.status === String(expected ?? "");
    if (role === "currentAction") return item.currentAction === String(expected ?? "").trim();
    if (role === "nextAction") return item.nextAction === String(expected ?? "").trim();
    if (role === "parent") return (item.parentIds[0] ?? "") === String(expected ?? "");
    if (role === "topProject") return (item.topProjectIds[0] ?? "") === String(expected ?? "");
    if (role === "energy") return item.energy === String(expected ?? "");
    if (role === "noDeadline") return item.noDeadline === Boolean(expected);
    if (role === "duration") return item.durationMinutes === (expected === null || expected === "" ? null : Number(expected));
    const actual = role === "planDate" ? item.planDate : item.deadline;
    if (!expected) return actual === null;
    const expectedDate = typeof expected === "number" ? expected : new Date(`${expected}T00:00:00`).getTime();
    return actual !== null && new Date(actual).toDateString() === new Date(expectedDate).toDateString();
}

function createSiYuanNodeId(): string {
    const lute = (globalThis as typeof globalThis & { Lute?: { NewNodeID?: () => string } }).Lute;
    if (typeof lute?.NewNodeID !== "function") throw new Error("当前思源环境无法生成条目 ID。");
    return lute.NewNodeID();
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function extractCheckbox(value?: RawCellValue): boolean {
    return Boolean(value?.checkbox?.checked);
}

function extractNumber(value?: RawCellValue): number | null {
    const content = value?.number?.content;
    return typeof content === "number" && Number.isFinite(content) ? content : null;
}

function extractDate(value?: RawCellValue): number | null {
    const date = value?.date ?? value?.created ?? value?.updated;
    return date?.isNotEmpty && typeof date.content === "number" ? date.content : null;
}
