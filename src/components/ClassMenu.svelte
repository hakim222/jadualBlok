<script lang="ts">
  import { store } from '../lib/state.svelte';

  /** Combine a timetable row with its neighbour, or split a combined row. `row` is its index. */
  let { row, onclose }: { row: number | null; onclose: () => void } = $props();

  let dlg: HTMLDialogElement;

  $effect(() => {
    if (row !== null && !dlg.open) dlg.showModal();
    else if (row === null && dlg.open) dlg.close();
  });

  const info = $derived.by(() => {
    if (row === null || !store.day.tt[row]) return null;
    const classes = store.day.tt[row].classes;
    return {
      label: store.rowLabels[row],
      above: row > 0 ? store.rowLabels[row - 1] : null,
      below: row + 1 < store.day.tt.length ? store.rowLabels[row + 1] : null,
      parts: classes.length > 1 ? classes.map((id) => store.classNameOf.get(id) ?? '?') : null,
    };
  });

  // The row went away (e.g. changed on another device): nothing left to act on.
  $effect(() => {
    if (row !== null && !info) onclose();
  });

  function act(fn: () => void) {
    fn();
    dlg.close();
  }
</script>

<dialog bind:this={dlg} onclose={onclose} onclick={(e) => e.target === dlg && dlg.close()} aria-labelledby="class-menu-title">
  {#if info && row !== null}
    {@const r = row}
    <div class="sheet">
      <h3 id="class-menu-title">{info.label}</h3>
      <p class="sub">Combined classes share one row and the same teachers.</p>
      <div class="options">
        {#if info.above}
          <button class="btn" onclick={() => act(() => store.combineRows(r - 1))}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
            Combine with {info.above}
          </button>
        {/if}
        {#if info.below}
          <button class="btn" onclick={() => act(() => store.combineRows(r))}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
            Combine with {info.below}
          </button>
        {/if}
        {#if info.parts}
          <button class="btn" onclick={() => act(() => store.splitRow(r))}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h16M4 16h16" /></svg>
            Split into {info.parts.join(', ')}
          </button>
        {/if}
      </div>
      {#if info.parts}<p class="hint">Splitting: {info.parts[0]} keeps the teachers; the others start empty.</p>{/if}
      {#if info.above || info.below}<p class="hint">Combining: the upper row's teachers stay; the lower row's fill only empty sides.</p>{/if}
      <div class="actions">
        <button type="button" class="btn ghost" onclick={() => dlg.close()}>Close</button>
      </div>
    </div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(360px, calc(100vw - 32px));
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-dialog);
  }

  dialog::backdrop {
    background: rgb(10 15 25 / 0.45);
  }

  .sheet {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
  }

  .sub,
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
  }

  .hint {
    font-size: 12.5px;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .options .btn {
    justify-content: flex-start;
    min-height: 44px;
    white-space: normal;
    text-align: left;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
