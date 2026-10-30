<script lang="ts" generics="T extends string | number">
  let {
    value = $bindable(),
    options,
    block = false,
    label = '',
    onchange
  }: { value: T; options: { value: T; label: string }[]; block?: boolean; label?: string; onchange?: (v: T) => void } = $props();
</script>

<div class="seg" class:block role="radiogroup" aria-label={label}>
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === o.value}
      class:on={value === o.value}
      onclick={() => {
        value = o.value;
        onchange?.(o.value);
      }}>{o.label}</button
    >
  {/each}
</div>
