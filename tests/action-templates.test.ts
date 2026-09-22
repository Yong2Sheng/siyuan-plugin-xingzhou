import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ActionDetailCard from "../src/ActionDetailCard.svelte";
import { createEmptyActionDetail, setActionDetailField } from "../src/action-detail";
import { applyActionTemplate, isTemplateEmpty, templateFromDetail, upsertActionTemplate, type ActionTemplate } from "../src/action-templates";

const NOW = new Date("2026-09-21T10:00:00").getTime();

function buildTemplate(name = "技术事务"): ActionTemplate {
    return {
        name,
        currentState: "上次做到 X，卡在 Y",
        background: "为什么要做",
        prompt: "发给 AI 的提示词",
        guidance: "先做领域层",
        definition: "测试全绿",
    };
}

describe("行动细则模板（领域层）", () => {
    it("只填空字段，已写内容一个字都不覆盖", () => {
        const detail = setActionDetailField(createEmptyActionDetail(), "prompt", "我自己写的提示词", NOW);
        const next = applyActionTemplate(detail, buildTemplate(), NOW + 1);
        expect(next.prompt).toBe("我自己写的提示词");
        expect(next.currentState).toBe("上次做到 X，卡在 Y");
        expect(next.definition).toBe("测试全绿");
        expect(next.updatedAt).toBe(NOW + 1);
    });

    it("空模板没有保存价值，同名模板覆盖而不是重复", () => {
        expect(isTemplateEmpty(templateFromDetail("空的", createEmptyActionDetail()))).toBe(true);
        const first = upsertActionTemplate([], buildTemplate("A"));
        const second = upsertActionTemplate(first, { ...buildTemplate("A"), prompt: "改过的" });
        expect(second).toHaveLength(1);
        expect(second[0].prompt).toBe("改过的");
    });

    it("模板名不能为空", () => {
        expect(() => templateFromDetail("   ", createEmptyActionDetail())).toThrow(/不能为空/);
    });
});

describe("模板面板（ActionDetailCard）", () => {
    let component: ActionDetailCard | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.replaceChildren();
    });

    function mount(props: Partial<ConstructorParameters<typeof ActionDetailCard>[0]["props"]> = {}) {
        const handlers = { applyTemplate: vi.fn(), saveTemplate: vi.fn(), edit: vi.fn() };
        component = new ActionDetailCard({
            target: document.body,
            props: { detail: createEmptyActionDetail(), templateNames: ["技术事务"], ...props },
        });
        component.$on("applyTemplate", (event) => handlers.applyTemplate(event.detail));
        component.$on("saveTemplate", (event) => handlers.saveTemplate(event.detail));
        component.$on("edit", (event) => handlers.edit(event.detail));
        return handlers;
    }

    async function openTemplates() {
        await tick();
        clickByText(".xz-plan-card__link", "模板");
        await tick();
    }

    it("展开后列出已存模板，点一下即套用并收起面板", async () => {
        const handlers = mount();
        await openTemplates();
        clickByText(".xz-plan-templates__list button", "套用「技术事务」");
        expect(handlers.applyTemplate).toHaveBeenCalledWith({ name: "技术事务" });
        await tick();
        expect(document.querySelector(".xz-plan-templates")).toBeNull();
    });

    it("保存模板用面板内的输入框，不再依赖 window.prompt", async () => {
        const promptSpy = vi.fn();
        const original = window.prompt;
        // 模拟 Electron：window.prompt 直接抛错或返回 null。面板不应该再碰它。
        (window as unknown as { prompt: unknown }).prompt = promptSpy;
        try {
            const handlers = mount();
            await openTemplates();
            const input = document.querySelector<HTMLInputElement>(".xz-plan-templates__name")!;
            expect(input).not.toBeNull();

            const save = [...document.querySelectorAll<HTMLButtonElement>(".xz-plan-templates__save button")][0];
            expect(save.disabled).toBe(true);

            input.value = "我的模板";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await tick();
            expect(save.disabled).toBe(false);
            save.click();
            expect(handlers.saveTemplate).toHaveBeenCalledWith({ name: "我的模板" });
            expect(promptSpy).not.toHaveBeenCalled();
        } finally {
            (window as unknown as { prompt: unknown }).prompt = original;
        }
    });

    it("回车也能提交模板名，且名称前后空格被裁掉", async () => {
        const handlers = mount();
        await openTemplates();
        const input = document.querySelector<HTMLInputElement>(".xz-plan-templates__name")!;
        input.value = "  含空格  ";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(handlers.saveTemplate).toHaveBeenCalledWith({ name: "含空格" });
    });

    it("没有模板时给出说明，并且不显示保存之外的空列表", async () => {
        mount({ templateNames: [] });
        await openTemplates();
        expect(document.querySelector(".xz-plan-templates__list")).toBeNull();
        expect(document.querySelector(".xz-plan-templates")?.textContent).toContain("还没有保存过模板");
        expect(document.querySelector(".xz-plan-templates__name")).not.toBeNull();
    });

    function clickByText(selector: string, text: string) {
        const target = [...document.querySelectorAll<HTMLButtonElement>(selector)].find((button) => button.textContent?.includes(text));
        if (!target) throw new Error(`没有找到包含「${text}」的 ${selector}`);
        target.click();
    }
});
