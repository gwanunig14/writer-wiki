<script lang="ts">
  import AppShell from "$lib/components/layout/AppShell.svelte";
  import type { LayoutData } from "./$types";

  export let data: LayoutData;
</script>

<AppShell projectState={data.projectState} navigation={data.navigation}>
  <slot />
</AppShell>
