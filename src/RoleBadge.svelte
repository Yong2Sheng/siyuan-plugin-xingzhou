<script lang="ts">
    import { WORK_ITEM_ROLE_META, type WorkItemRole } from "./work-item-role";

    export let role: WorkItemRole;
    export let compact = false;

    $: label = WORK_ITEM_ROLE_META[role].label;
</script>

<span class:compact class="xz-role-badge" data-role={role}>{label}</span>
