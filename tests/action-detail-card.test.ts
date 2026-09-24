import { tick } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import ActionDetailCard from "../src/ActionDetailCard.svelte";
import { createEmptyActionDetail, type ActionDetail } from "../src/action-detail";

/**
 * 回归：Svelte 在编译期按表达式里出现的变量决定要不要重算 DOM。
 * 卡片曾经用 isFilled(field.key) / preview(field.key) 读取字段，detail 不在依赖里，
 * 于是切换工作项后每条字段的标签、预览与展开正文都停在上一条的内容上。
 * 这些用例在修复前会失败，修复后必须通过。
 */

function detailWith(overrides: Partial<ActionDetail>): ActionDetail {
    return { ...createEmptyActionDetail(), ...overrides };
}

const DETAIL_A = detailWith({
    currentState: "A-当前状态",
    background: "A-背景与约束",
    prompt: "A-提示词",
    guidance: "A-行动指导，写得很长很长，长到预览必须截断显示省略号才放得下这一行内容，不能整段铺开。",
    definition: "A-完成定义",
    outcomes: [{ id: "outcome-a", text: "A-成果", createdAt: 1, fromTodoId: null, date: "2026-09-20" }],
});

const DETAIL_B = detailWith({
    background: "B-背景与约束",
    prompt: "B-提示词",
    guidance: "B-行动指导",
});

const DETAIL_C = detailWith({ guidance: "C-行动指导" });

const DETAIL_EMPTY = createEmptyActionDetail();

describe("行动细则卡：切换工作项后字段必须跟着换", () => {
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

    function typeInto(input: HTMLInputElement, value: string) {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    it("标签、预览、展开正文与计数都换成新工作项的内容", async () => {
        mount(DETAIL_A, "a");
        // 上一条正展开着「行动指导与想法」
        field("行动指导与想法").querySelector<HTMLButtonElement>(".xz-plan-field__toggle")!.click();
        await tick();
        expect(text(field("行动指导与想法"))).toContain("A-行动指导");

        component!.$set({ detail: DETAIL_B, itemId: "b" });
        await tick();

        expect(text(document.querySelector(".xz-plan-card__count"))).toBe("已填 3/5");
        // 当前状态：B 没写，按钮要变回「填写」
        expect(editLabel("当前状态")).toBe("填写");
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

    it("换工作项复位成果草稿与模板面板，同一条目内的刷新不动草稿", async () => {
        mount(DETAIL_A, "a", { templateNames: ["技术事务"] });
        typeInto(document.querySelector<HTMLInputElement>(".xz-plan-outcome__add .xz-plan-outcome__input")!, "写了一半的成果");
        document.querySelector<HTMLButtonElement>(".xz-plan-card__link")!.click();
        await tick();
        typeInto(document.querySelector<HTMLInputElement>(".xz-plan-templates__name")!, "半途的模板名");
        expect(document.querySelector(".xz-plan-templates")).not.toBeNull();

        // 同一条目刷新（保存后重新下发 detail）：草稿必须留着
        component!.$set({ detail: detailWith({ ...DETAIL_A, guidance: "A-行动指导（改过）" }) });
        await tick();
        expect(document.querySelector<HTMLInputElement>(".xz-plan-outcome__add .xz-plan-outcome__input")?.value).toBe("写了一半的成果");
        expect(document.querySelector(".xz-plan-templates")).not.toBeNull();

        // 换条目：草稿与模板面板都复位
        component!.$set({ detail: DETAIL_B, itemId: "b" });
        await tick();
        expect(document.querySelector<HTMLInputElement>(".xz-plan-outcome__add .xz-plan-outcome__input")?.value).toBe("");
        expect(document.querySelector(".xz-plan-templates")).toBeNull();
        expect(document.querySelector<HTMLInputElement>(".xz-plan-templates__name")).toBeNull();
    });
});
