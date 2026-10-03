<script lang="ts">
  import type { RichText } from '../types';

  type Props = { value: RichText | null };
  let { value }: Props = $props();
</script>

<!-- Shapio's rich text arrives with a sanitised `html` rendering next to the JSON document. -->
{#if value}
  <div class="prose">{@html value.html}</div>
{/if}
