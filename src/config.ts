export const DEFAULT_ATTRIBUTE_VIEW_ID = "20260825232623-6ukk2rc";
export const DEFAULT_DATABASE_BLOCK_ID = "20260825232623-58nsl9x";
export const DEFAULT_ALL_ITEMS_VIEW_NAME = "全部工作项";

export type XingzhouSettings = {
    attributeViewId: string;
    databaseBlockId: string;
};

export const DEFAULT_SETTINGS: XingzhouSettings = {
    attributeViewId: DEFAULT_ATTRIBUTE_VIEW_ID,
    databaseBlockId: DEFAULT_DATABASE_BLOCK_ID,
};

export function normalizeSettings(value: unknown): XingzhouSettings {
    const source = value && typeof value === "object" ? value as Partial<XingzhouSettings> : {};
    return {
        attributeViewId: source.attributeViewId?.trim() || DEFAULT_ATTRIBUTE_VIEW_ID,
        databaseBlockId: source.databaseBlockId?.trim() || "",
    };
}
