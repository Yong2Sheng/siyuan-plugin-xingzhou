<script lang="ts">
    import { createEventDispatcher } from "svelte";

    export let value = "";
    export let ariaLabel = "时间";
    /** 可选：出现「清空」按钮，供需要显式撤销时间的字段使用。 */
    export let clearable = false;

    const dispatch = createEventDispatcher<{ change: string }>();
    const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
    const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

    let hour = "";
    let minute = "";
    let lastExternal: string | undefined;

    $: if (value !== lastExternal) {
        hour = /^\d{2}:\d{2}$/.test(value) ? value.slice(0, 2) : "";
        minute = /^\d{2}:\d{2}$/.test(value) ? value.slice(3, 5) : "";
        lastExternal = value;
    }

    /**
     * 只在用户真的动了选择框时派发 change：`bind:value` 已经负责把值写回父组件，
     * 这个事件是给「值之外还要记一件事」的字段用的（例如实际熄灯要标当场记录还是回忆补记）。
     */
    function setPart(part: "hour" | "minute", next: string) {
        if (part === "hour") hour = next;
        else minute = next;
        value = hour && minute ? `${hour}:${minute}` : "";
        lastExternal = value;
        dispatch("change", value);
    }

    function clear() {
        hour = "";
        minute = "";
        value = "";
        lastExternal = value;
        dispatch("change", value);
    }
</script>

<div class="xz-daily-time-select">
    <select aria-label={`${ariaLabel}小时`} bind:value={hour} on:change={(event) => setPart("hour", event.currentTarget.value)}>
        <option value="">时</option>
        {#each hours as option}<option value={option}>{option}</option>{/each}
    </select>
    <span>:</span>
    <select aria-label={`${ariaLabel}分钟`} bind:value={minute} on:change={(event) => setPart("minute", event.currentTarget.value)}>
        <option value="">分</option>
        {#each minutes as option}<option value={option}>{option}</option>{/each}
    </select>
    {#if clearable && value}<button type="button" class="xz-daily-time-clear" aria-label={`清空${ariaLabel}`} on:click={clear}>清空</button>{/if}
</div>
