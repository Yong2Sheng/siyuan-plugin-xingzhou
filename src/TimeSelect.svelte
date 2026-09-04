<script lang="ts">
    export let value = "";
    export let ariaLabel = "时间";

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

    function setPart(part: "hour" | "minute", next: string) {
        if (part === "hour") hour = next;
        else minute = next;
        value = hour && minute ? `${hour}:${minute}` : "";
        lastExternal = value;
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
</div>
