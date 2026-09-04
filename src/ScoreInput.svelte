<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { DailyRubric } from "./daily-records";

    export let value: number | null = null;
    export let rubric: DailyRubric;

    const dispatch = createEventDispatcher<{ inspect: DailyRubric; change: void }>();

    function selectScore(score: number | null) {
        value = score;
        dispatch("change");
        if (score !== null) dispatch("inspect", rubric);
    }
</script>

<div class="xz-daily-score">
    <div class="xz-daily-score-heading">
        <span>{rubric.label}</span>
        <button type="button" on:click={() => dispatch("inspect", rubric)}>查看评分标准</button>
    </div>
    <div class="xz-daily-score-buttons" role="group" aria-label={rubric.label}>
        {#each [1, 2, 3, 4, 5] as score}
            <button
                class:active={value === score}
                type="button"
                aria-pressed={value === score}
                aria-label={value === score ? `${rubric.label} ${score} 分，点击清除` : `${rubric.label} ${score} 分`}
                title={value === score ? `${rubric.levels[score - 1]}；再次点击清除` : rubric.levels[score - 1]}
                on:click={() => selectScore(value === score ? null : score)}
            >{score}</button>
        {/each}
    </div>
</div>
