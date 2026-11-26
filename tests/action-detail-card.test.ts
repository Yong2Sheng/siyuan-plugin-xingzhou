import { tick } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import ActionDetailCard from "../src/ActionDetailCard.svelte";
import {
    createEmptyActionDetail,
    type ActionCheckpoint,
    type ActionDetail,
} from "../src/action-detail";

/**
 * 回归 + 新结构用例。
 *
 * 回归部分：Svelte 在编译期按表达式里出现的变量决定要不要重算 DOM。
 * 卡片曾经用 isFilled(field.key) / preview(field.key) 读取字段，detail 不在依赖里，
 * 于是切换工作项后每条字段的标签、预览与展开正文都停在上一条的内容上。
 *
 * 新结构部分：当前状态 / 阶段性成果 / 下一步行动 已合成一条断点时间轴，
 * 最新一条 = 当前状态 + 恢复包，星标 = 阶段性成果。
 */

function detailWith(overrides: Partial<ActionDetail>): ActionDetail {
    return { ...createEmptyActionDetail(), ...overrides };
}

function checkpoint(overrides: Partial<ActionCheckpoint> = {}): ActionCheckpoint {
    return {
        id: "cp-a",
        createdAt: new Date("2026-09-20T22:00:00").getTime(),
        did: "",
        stuck: "",
        next: "",
        entry: null,
        payload: "",
        starred: false,
        ...overrides,
    };
}

const DETAIL_A = detailWith({
    background: "A-背景与约束",
    prompt: "A-提示词",
    guidance: "A-行动指导，写得很长很长，长到预览必须截断显示省略号才放得下这一行内容，不能整段铺开。",
    definition: "A-完成定义",
    checkpoints: [
        checkpoint({
            id: "cp-a2",
            createdAt: new Date("2026-09-20T22:00:00").getTime(),
            did: "A-上次做到：把入口候选去重做完了",
            stuck: "名称同步还没做",
            next: "把 label 回填写上",
            entry: { type: "vscode", label: "CheckpointList.svelte", target: "~/Agents/xingzhou/src/CheckpointList.svelte" },
            payload: "按 resolveEntryPointName 那套做，只改显示不改存储。",
            starred: true,
        }),
        checkpoint({ id: "cp-a1", createdAt: new Date("2026-09-18T21:00:00").getTime(), did: "A-更早做到：搭好骨架" }),
    ],
});

const DETAIL_B = detailWith({
    background: "B-背景与约束",
    prompt: "B-提示词",
    guidance: "B-行动指导",
    checkpoints: [checkpoint({ id: "cp-b1", did: "B-上次做到：改完标题", next: "" })],
});

const DETAIL_C = detailWith({ guidance: "C-行动指导" });

const STUCK_LINES = [
    "第一条「顺口」建立在错误事实上",
    "第二条有「府里」世界词错误",
    "多条消息现在只是显示层拆分",
];

const DETAIL_STUCK = detailWith({
    checkpoints: [
        checkpoint({
            id: "cp-stuck-new",
            createdAt: new Date("2026-09-20T22:00:00").getTime(),
            did: "把聊天从问答切到场景模式",
            stuck: STUCK_LINES.join("\n"),
            next: "先把分条发送的暂停点补上",
        }),
        checkpoint({
            id: "cp-stuck-old",
            createdAt: new Date("2026-09-18T21:00:00").getTime(),
            did: "跑通 6 段检索的召回质量",
            stuck: "召回 11/20\n第二条检索把人物卡当成背景",
            entry: { type: "dsh", label: "角色各自的聊天特质", target: "DSH · 会话" },
        }),
    ],
});

const DETAIL_STUCK_ONE = detailWith({
    checkpoints: [checkpoint({ id: "cp-one", did: "改完标题", stuck: "只有一处卡点" })],
});

const DETAIL_EMPTY = createEmptyActionDetail();

describe("行动细则卡：断点区", () => {
    let component: ActionDetailCard | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    function mount(detail: ActionDetail, itemId: string, props: Record<string, unknown> = {}) {
        component = new ActionDetailCard({ target: document.body, props: { detail, itemId, ...props } });
        return component;
    }

    function field(label: string): HTMLElement {
        const article = [...document.querySelectorAll(".xz-plan-field")]
            .find((node) => node.querySelector("h4")?.textContent?.trim() === label);
        if (!article) throw new Error(`没有找到字段卡片：${label}`);
        return article as HTMLElement;
    }

    const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
    const editLabel = (label: string) => text(field(label).querySelector(".xz-plan-field__edit"));
    const previewText = (label: string) => text(field(label).querySelector(".xz-plan-field__preview"));
    const hasPreview = (label: string) => field(label).querySelector(".xz-plan-field__preview") !== null;
    const latest = () => document.querySelector(".xz-cp-latest");

    it("最新断点承担「当前状态」：正文、卡点、恢复包都在这一块", async () => {
        mount(DETAIL_A, "a");

        expect(text(document.querySelector(".xz-plan-card__count"))).toBe("断点 2 条");
        // 当前状态已不是可填字段，卡片里不再有这一行
        expect([...document.querySelectorAll(".xz-plan-field h4")].map((node) => text(node))).not.toContain("当前状态");

        const block = text(latest());
        expect(block).toContain("上次做到");
        expect(block).toContain("A-上次做到：把入口候选去重做完了");
        expect(block).toContain("名称同步还没做");
        // 恢复包三样：做什么、从哪进、带什么走
        expect(block).toContain("把 label 回填写上");
        expect(block).toContain("CheckpointList.svelte");
        expect(block).toContain("1 行"); // 交接内容的摘要
        expect(block).toContain("复制交接内容");
        // 星标 = 阶段性成果
        expect(text(latest()!.querySelector(".xz-cp-star"))).toBe("★ 阶段性成果");
        // 更早的一条只出现在历史计数里，不在最新块
        expect(text(document.querySelector("[data-cp-history-toggle]"))).toBe("▸ 更早的断点 1 条");
    });

    it("没有断点时只留一句「还没有断点」，不显示空的恢复包", async () => {
        mount(DETAIL_EMPTY, "empty");
        expect(document.querySelector(".xz-cp-latest")).toBeNull();
        expect(document.querySelector("[data-cp-resume]")).toBeNull();
        expect(text(document.querySelector(".xz-cp-block"))).toContain("还没有断点");
        expect(text(document.querySelector(".xz-plan-card__count"))).toBe("断点 0 条");
    });

    it("记一次断点：表单填完派发 addCheckpoint，含做到哪 / 下一步 / 交接内容", async () => {
        const events: Array<{ type: string; input?: { did?: string; next?: string; payload?: string } }> = [];
        mount(DETAIL_B, "b");
        component!.$on("addCheckpoint", (event: CustomEvent) => events.push({ type: "add", input: event.detail.input }));

        document.querySelector<HTMLButtonElement>("[data-cp-add]")!.click();
        await tick();
        expect(document.querySelector("[data-cpf]")).not.toBeNull();

        const did = document.querySelector<HTMLTextAreaElement>("[data-cpf-did]")!;
        did.value = "把入口候选按类型去重";
        did.dispatchEvent(new Event("input", { bubbles: true }));
        const next = document.querySelector<HTMLInputElement>('input[placeholder^="下次接着做什么"]')!;
        next.value = "补 label 回填";
        next.dispatchEvent(new Event("input", { bubbles: true }));
        const payload = document.querySelector<HTMLTextAreaElement>('textarea[placeholder^="趁现在还记得"]')!;
        payload.value = "先跑名称同步，再核对 12 条历史断点";
        payload.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();
        document.querySelector<HTMLButtonElement>("[data-cpf-save]")!.click();
        await tick();

        expect(events).toHaveLength(1);
        expect(events[0].input?.did).toBe("把入口候选按类型去重");
        expect(events[0].input?.next).toBe("补 label 回填");
        expect(events[0].input?.payload).toBe("先跑名称同步，再核对 12 条历史断点");
        // 保存后表单收起
        expect(document.querySelector("[data-cpf]")).toBeNull();
    });

    it("点星标派发 starCheckpoint（最新一条与历史各一次）", async () => {
        const ids: string[] = [];
        mount(DETAIL_A, "a");
        component!.$on("starCheckpoint", (event: CustomEvent) => ids.push(event.detail.id));

        latest()!.querySelector<HTMLButtonElement>(".xz-cp-star")!.click();
        await tick();
        expect(ids).toEqual(["cp-a2"]);
    });

    it("切换工作项后字段与断点区都换成新条目的内容", async () => {
        mount(DETAIL_A, "a");
        field("行动指导与想法").querySelector<HTMLButtonElement>(".xz-plan-field__toggle")!.click();
        await tick();
        expect(text(field("行动指导与想法"))).toContain("A-行动指导");

        component!.$set({ detail: DETAIL_B, itemId: "b" });
        await tick();

        expect(text(document.querySelector(".xz-plan-card__count"))).toBe("断点 1 条");
        // 断点区换人：最新一块是新条目的断点，不再显示上一条的正文与恢复包
        expect(text(latest())).toContain("B-上次做到：改完标题");
        expect(text(latest())).not.toContain("A-上次做到");
        expect(text(latest())).toContain("待定"); // B 的下一步没写
        // 未展开字段：单行预览换成 B 的内容
        expect(previewText("背景与约束")).toBe("B-背景与约束");
        expect(previewText("Prompt")).toBe("B-提示词");
        // 保持展开的字段：正文必须换人
        expect(text(field("行动指导与想法"))).toContain("B-行动指导");
        expect(text(field("行动指导与想法"))).not.toContain("A-行动指导");
        // 空字段：没有预览、按钮是「填写」
        expect(hasPreview("完成定义")).toBe(false);
        expect(editLabel("完成定义")).toBe("填写");
        // 整张卡不再残留上一条的任何文字
        expect(text(document.querySelector(".xz-plan-card"))).not.toContain("A-");
    });

    it("Prompt 的「复制」按钮跟着新工作项出现或消失", async () => {
        mount(DETAIL_B, "b");
        expect(text(field("Prompt").querySelector(".xz-plan-card__link"))).toBe("复制");

        component!.$set({ detail: DETAIL_C, itemId: "c" });
        await tick();
        expect(field("Prompt").querySelector(".xz-plan-card__link")).toBeNull();
        expect(editLabel("Prompt")).toBe("填写");
        expect(hasPreview("Prompt")).toBe(false);
    });

    it("展开着的字段在新工作项里没内容时，显示空状态而不是旧正文", async () => {
        mount(DETAIL_A, "a");
        field("行动指导与想法").querySelector<HTMLButtonElement>(".xz-plan-field__toggle")!.click();
        await tick();

        component!.$set({ detail: DETAIL_EMPTY, itemId: "empty" });
        await tick();
        expect(text(field("行动指导与想法"))).toContain("还没写，点这里开始。");
        expect(text(field("行动指导与想法"))).not.toContain("A-行动指导");
    });

    it("卡点按行拆成多条：三行就是三条，标签不再参与文本行", async () => {
        mount(DETAIL_STUCK, "stuck");
        const section = document.querySelector("[data-cp-stuck]")!;
        expect(section).not.toBeNull();
        // 以前它是一段内联文本，换行会被折叠成一行
        const items = [...section.querySelectorAll(".xz-cp-stuck__list li")].map((node) => text(node));
        expect(items).toEqual(STUCK_LINES);
        expect(text(section.querySelector(".xz-cp-stuck__title"))).toBe("卡在");
        expect(text(section.querySelector(".xz-cp-stuck__count"))).toBe("3 处");
    });

    it("只有一处卡点时不显示条数，小节照旧独立成段", async () => {
        mount(DETAIL_STUCK_ONE, "stuck-one");
        const section = document.querySelector("[data-cp-stuck]")!;
        expect([...section.querySelectorAll("li")].map((node) => text(node))).toEqual(["只有一处卡点"]);
        expect(section.querySelector(".xz-cp-stuck__count")).toBeNull();
    });

    it("没有卡点时不出这个小节，避免留一条空虚线", async () => {
        mount(DETAIL_B, "b");
        expect(document.querySelector("[data-cp-stuck]")).toBeNull();
    });

    it("历史条目「看详情」点了真的展开：旧断点的多行卡点按行显示", async () => {
        mount(DETAIL_STUCK, "stuck");
        document.querySelector<HTMLButtonElement>("[data-cp-history-toggle]")!.click();
        await tick();

        const expand = document.querySelector<HTMLButtonElement>(".xz-cp-item__expand")!;
        expect(text(expand)).toBe("看详情");
        expand.click();
        await tick();

        // 曾经这里永远不展开：模板用 isCheckpointExpanded(id) 包了一层，
        // Svelte 编译期看不到它依赖 expandedCheckpoints，改了 Set 也不重渲染。
        const more = document.querySelector(".xz-cp-item__more")!;
        expect(more).not.toBeNull();
        expect(text(expand)).toBe("收起详情");
        const items = [...more.querySelectorAll(".xz-cp-stuck--compact li")].map((node) => text(node));
        expect(items).toEqual(["召回 11/20", "第二条检索把人物卡当成背景"]);

        expand.click();
        await tick();
        expect(document.querySelector(".xz-cp-item__more")).toBeNull();
    });

    it("表单里的卡点是多行框：三个卡点按行存进 stuck", async () => {
        const events: Array<{ stuck?: string }> = [];
        mount(DETAIL_B, "b");
        component!.$on("addCheckpoint", (event: CustomEvent) => events.push(event.detail.input));

        document.querySelector<HTMLButtonElement>("[data-cp-add]")!.click();
        await tick();
        const did = document.querySelector<HTMLTextAreaElement>("[data-cpf-did]")!;
        did.value = "做到哪";
        did.dispatchEvent(new Event("input", { bubbles: true }));

        // 卡点默认收起，点开才出现；控件必须是 textarea，单行 input 存不下第二个卡点
        document.querySelector<HTMLButtonElement>(".xz-cpf__link")!.click();
        await tick();
        const stuck = document.querySelector<HTMLTextAreaElement>("[data-cpf-stuck]")!;
        expect(stuck.tagName).toBe("TEXTAREA");
        stuck.value = STUCK_LINES.join("\n");
        stuck.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();

        document.querySelector<HTMLButtonElement>("[data-cpf-save]")!.click();
        await tick();
        expect(events).toHaveLength(1);
        expect(events[0].stuck?.split("\n")).toEqual(STUCK_LINES);
    });

    it("只有一条断点时点「编辑」也能打开表单，改完保存回这一条", async () => {
        // 回归：编辑表单曾经只挂在「更早的断点」历史分支里，
        // 只有一条断点时历史区根本不渲染，点「编辑」只设了 editingId 却没有任何地方读它。
        const saved: Array<{ id: string; did?: string; starred?: boolean }> = [];
        mount(DETAIL_B, "b");
        component!.$on("saveCheckpoint", (event: CustomEvent) => saved.push({ id: event.detail.id, ...event.detail.patch }));

        latest()!.querySelector<HTMLButtonElement>(".xz-plan-field__edit")!.click();
        await tick();

        const form = document.querySelector<HTMLFormElement>("[data-cpf]");
        expect(form).not.toBeNull();
        expect(text(form!.querySelector(".xz-cpf__head h4"))).toBe("编辑这条断点");
        const did = form!.querySelector<HTMLTextAreaElement>("[data-cpf-did]")!;
        expect(did.value).toBe("B-上次做到：改完标题");

        did.value = "B-改完标题（补齐回填）";
        did.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();
        form!.querySelector<HTMLButtonElement>("[data-cpf-save]")!.click();
        await tick();

        expect(saved).toHaveLength(1);
        expect(saved[0].id).toBe("cp-b1");
        expect(saved[0].did).toBe("B-改完标题（补齐回填）");
        // 保存后退出编辑态，回到只读的最新断点，而不是停在一张空表单上
        expect(document.querySelector("[data-cpf]")).toBeNull();
        expect(latest()).not.toBeNull();
    });

    it("编辑最新断点时点「取消」回到只读态，不派发保存", async () => {
        const saved: unknown[] = [];
        mount(DETAIL_B, "b");
        component!.$on("saveCheckpoint", (event: CustomEvent) => saved.push(event.detail));

        latest()!.querySelector<HTMLButtonElement>(".xz-plan-field__edit")!.click();
        await tick();
        document.querySelector<HTMLButtonElement>("[data-cpf] .xz-plan-field__edit")!.click();
        await tick();

        expect(saved).toHaveLength(0);
        expect(document.querySelector("[data-cpf]")).toBeNull();
        expect(text(latest())).toContain("B-上次做到：改完标题");
    });

    it("正在编辑的旧断点切到「阶段性成果」筛选也不消失", async () => {
        mount(DETAIL_A, "a");
        document.querySelector<HTMLButtonElement>("[data-cp-history-toggle]")!.click();
        await tick();

        // cp-a1 没标星：编辑它，再切到只看成果，表单不能跟着被筛掉
        const older = [...document.querySelectorAll<HTMLElement>(".xz-cp-item")].find((node) => text(node).includes("更早做到"))!;
        older.querySelector<HTMLButtonElement>(".xz-cp-item__edit")!.click();
        await tick();
        expect(document.querySelector("[data-cpf]")).not.toBeNull();

        const starChip = [...document.querySelectorAll<HTMLButtonElement>(".xz-cp-filter__chip")].find((node) => text(node).includes("阶段性成果"))!;
        starChip.click();
        await tick();
        expect(document.querySelector("[data-cpf]")).not.toBeNull();
    });

    it("换工作项复位模板面板，同一条目内的刷新不动它", async () => {
        mount(DETAIL_A, "a", { templateNames: ["技术事务"] });
        document.querySelector<HTMLButtonElement>(".xz-plan-card__link")!.click();
        await tick();
        const nameInput = document.querySelector<HTMLInputElement>(".xz-plan-templates__name")!;
        nameInput.value = "半途的模板名";
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        expect(document.querySelector(".xz-plan-templates")).not.toBeNull();

        // 同一条目刷新（保存后重新下发 detail）：面板必须留着
        component!.$set({ detail: detailWith({ ...DETAIL_A, guidance: "A-行动指导（改过）" }) });
        await tick();
        expect(document.querySelector(".xz-plan-templates")).not.toBeNull();

        // 换条目：面板复位
        component!.$set({ detail: DETAIL_B, itemId: "b" });
        await tick();
        expect(document.querySelector(".xz-plan-templates")).toBeNull();
        expect(document.querySelector<HTMLInputElement>(".xz-plan-templates__name")).toBeNull();
    });
});
