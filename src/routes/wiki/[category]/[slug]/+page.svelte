<script lang="ts">
  import WikiPageView from "$lib/components/wiki/WikiPageView.svelte";
  import type { PageData } from "./$types";

  export let data: PageData;
</script>

<WikiPageView page={data.page} />
