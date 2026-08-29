export const XINGZHOU_TAB_TYPE = "xingzhou-center";

export function getXingzhouTabId(pluginName: string): string {
    // SiYuan resolves custom tabs with the exact concatenation of plugin name
    // and the type passed to Plugin.addTab(). Do not insert a separator here.
    return pluginName + XINGZHOU_TAB_TYPE;
}
