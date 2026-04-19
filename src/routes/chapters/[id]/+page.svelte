<script lang="ts">
  import ChapterEditor from "$lib/components/chapter/ChapterEditor.svelte";

  export let data: { chapterId: string };
</script>

<ChapterEditor initialChapterId={data.chapterId} />
