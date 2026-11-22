<script lang="ts">
    import { onDestroy } from "svelte";
    import {
        IDLE_NOTE,
        IDLE_STICKER_BASE,
        idleLineAt,
        idleReactionAt,
        idleStickerFileAt,
    } from "./daily-idle";

    /** 预览/测试可以传入本地素材目录；生产环境默认用插件静态资源。 */
    export let stickerBase = "";

    let lineIndex = 0;
    let stickerIndex = 0;
    let reactionIndex = 0;
    let note = IDLE_NOTE;
    let poked = false;
    let stickerBroken = false;
    let shakeTimer: ReturnType<typeof setTimeout> | null = null;

    $: base = stickerBase || IDLE_STICKER_BASE;
    $: line = idleLineAt(lineIndex);
    $: stickerSrc = base + idleStickerFileAt(stickerIndex);

    function nextLine() {
        lineIndex += 1;
        stickerIndex += 1;
        note = IDLE_NOTE;
        poked = false;
    }

    function poke() {
        note = `大肥鱼：${idleReactionAt(reactionIndex)}`;
        reactionIndex += 1;
        poked = true;
        if (shakeTimer !== null) clearTimeout(shakeTimer);
        // 只用来复位抖动 class；脚注里的反应要一直留到下一次「再说一条」或换阶段
        shakeTimer = setTimeout(() => {
            poked = false;
            shakeTimer = null;
        }, 520);
    }

    function handleStickerError() {
        stickerBroken = true;
    }

    onDestroy(() => {
        if (shakeTimer !== null) clearTimeout(shakeTimer);
    });
</script>

<aside class="xz-daily-idle-column" aria-label="大肥鱼说">
    <div class="xz-daily-idle-card">
        <div class="xz-daily-idle-body">
            {#if !stickerBroken}
                <button
                    type="button"
                    class="xz-daily-idle-sticker"
                    class:is-poked={poked}
                    aria-label="戳一下大肥鱼"
                    title="戳我"
                    on:click={poke}
                >
                    <img src={stickerSrc} alt="大肥鱼表情包" draggable="false" on:error={handleStickerError} />
                </button>
            {/if}
            <div class="xz-daily-idle-content">
                <div class="xz-daily-idle-title">
                    <h3>大肥鱼说</h3>
                    <p>这个阶段没有评分标准 · 可以戳它</p>
                </div>
                <p class="xz-daily-idle-line">{line}</p>
                <p class="xz-daily-idle-note">{note}</p>
                <div class="xz-daily-idle-foot">
                    <button type="button" class="xz-daily-idle-more" on:click={nextLine}>再说一条</button>
                </div>
            </div>
        </div>
    </div>
</aside>
