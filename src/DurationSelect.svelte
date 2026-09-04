<script lang="ts">
    export let value: number | null = null;
    export let maxHours = 24;
    export let ariaLabel = "时长";

    let hours = "";
    let minutes = "";
    let lastExternal: number | null | undefined;

    $: if (value !== lastExternal) {
        hours = value === null ? "" : String(Math.floor(value / 60));
        minutes = value === null ? "" : String(value % 60);
        lastExternal = value;
    }
    $: hourOptions = Array.from({ length: maxHours + 1 }, (_, index) => String(index));
    const minuteOptions = Array.from({ length: 60 }, (_, index) => String(index));

    function setPart(part: "hour" | "minute", next: string) {
        if (part === "hour") hours = next;
        else minutes = next;
        if (hours === "" && minutes === "") {
            value = null;
            lastExternal = value;
            return;
        }
        value = Number(hours || 0) * 60 + Number(minutes || 0);
        lastExternal = value;
    }
</script>

<div class="xz-daily-duration-select">
    <select aria-label={`${ariaLabel}小时`} bind:value={hours} on:change={(event) => setPart("hour", event.currentTarget.value)}>
        <option value="">时</option>
        {#each hourOptions as option}<option value={option}>{option}</option>{/each}
    </select>
    <span>小时</span>
    <select aria-label={`${ariaLabel}分钟`} bind:value={minutes} on:change={(event) => setPart("minute", event.currentTarget.value)}>
        <option value="">分</option>
        {#each minuteOptions as option}<option value={option}>{option.padStart(2, "0")}</option>{/each}
    </select>
    <span>分</span>
</div>
