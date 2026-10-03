<script lang="ts">
  import type { ShapioAttributes } from '@shapio/visual';
  import type { RichText } from '../types';

  /** `visual`: the field it shows (`shapioAttr`), for visual editing. */
  type Props = { value: RichText | null; visual?: ShapioAttributes };
  let { value, visual }: Props = $props();
</script>

<!-- Shapio's rich text arrives with a sanitised `html` rendering next to the JSON document. -->
{#if value}
  <div class="prose" {...visual}>{@html value.html}</div>
{/if}
