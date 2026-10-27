<script lang="ts">
  import { store } from '../lib/state.svelte';

  /** Combine a timetable row with any other row, or split a combined row. `row` is its index. */
  let { row, onclose }: { row: number | null; onclose: () => void } = $props();

  let dlg: HTMLDialogElement;

  $effect(() => {
    if (row !== null && !dlg.open) dlg.showModal();
    else if (row === null && dlg.open) dlg.close();
  });

  const info = $derived.by(() => {
    if (row === null || !store.day.tt[row]) return null;
    const currentClasses = store.day.tt[row].classes;
    const parts = currentClasses.map((id) => ({
      id,
      name: store.classNameOf.get(id) ?? '?',
    }));
    const others = store.day.tt
      .map((_, i) => ({ index: i, label: store.rowLabels[i] }))
      .filter((r) => r.index !== row);

    return {
      label: store.rowLabels[row],
      parts,
      canSplit: parts.length > 1,
      others,
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
      <div class="menu-head">
        <div>
          <h3 id="class-menu-title">{info.label}</h3>
          <p class="sub">Combined classes share one row and the same teachers.</p>
        </div>
        <button type="button" class="btn ghost icon close-btn" aria-label="Close" onclick={() => dlg.close()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {#if info.canSplit}
        <div class="section parts-section">
          <div class="section-label">Classes in this row ({info.parts.length})</div>
          <div class="class-chips">
            {#each info.parts as part (part.id)}
              <span class="class-chip">
                <span>{part.name}</span>
                {#if info.parts.length > 2}
                  <button
                    type="button"
                    class="chip-x"
                    title="Separate {part.name} into its own row"
                    aria-label="Separate {part.name}"
                    onclick={() => act(() => store.separateClass(r, part.id))}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                {/if}
              </span>
            {/each}
          </div>
          <button type="button" class="btn split-btn" onclick={() => act(() => store.splitRow(r))}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h16M4 16h16" /></svg>
            Split into separate rows
          </button>
          <p class="hint">Splitting: {info.parts[0].name} keeps the teachers; separated classes start empty.</p>
        </div>
      {/if}

      {#if info.others.length > 0}
        <div class="section combine-section">
          <div class="section-label">Combine with row</div>
          <div class="combine-grid">
            {#each info.others as other (other.index)}
              <button
                type="button"
                class="btn other-btn"
                onclick={() => act(() => store.combineRows(r, other.index))}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                <span>{other.label}</span>
              </button>
            {/each}
          </div>
          <p class="hint">Combining: this row's teachers stay; the other row fills empty sides.</p>
        </div>
      {/if}

      <div class="actions">
        <button type="button" class="btn ghost" onclick={() => dlg.close()}>Cancel</button>
      </div>
    </div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 32px));
    max-height: min(85vh, 640px);
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-dialog);
    overflow: hidden;
  }

  dialog::backdrop {
    background: rgb(10 15 25 / 0.45);
  }

  @media (max-width: 560px) {
    dialog {
      inset: auto 0 0;
      margin: 0;
      width: auto;
      max-width: none;
      border-radius: 16px 16px 0 0;
      border-bottom: 0;
      max-height: 85vh;
    }
  }

  .sheet {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px;
    max-height: min(85vh, 640px);
    overflow-y: auto;
  }

  .menu-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
  }

  .sub,
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 13.5px;
    line-height: 1.4;
  }

  .hint {
    font-size: 12px;
  }

  .close-btn {
    flex: none;
    width: 36px;
    height: 36px;
    min-height: 36px;
    padding: 0;
    border-radius: 50%;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .class-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .class-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 20px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-size: 13.5px;
    font-weight: 600;
  }

  .chip-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .chip-x:hover {
    color: #ef4444;
    background: var(--surface-2);
  }

  .chip-x svg {
    width: 12px;
    height: 12px;
  }

  .split-btn {
    justify-content: flex-start;
    min-height: 40px;
    text-align: left;
  }

  .combine-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(95px, 1fr));
    gap: 8px;
    max-height: 240px;
    overflow-y: auto;
    padding: 2px;
  }

  .other-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 42px;
    padding: 6px 10px;
    font-size: 13.5px;
    font-weight: 600;
    border-radius: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    word-break: break-word;
    text-align: center;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
  }

  .other-btn:hover {
    background: var(--surface-hover, var(--surface-2));
    border-color: var(--accent, #3b82f6);
    color: var(--accent, #3b82f6);
  }

  .other-btn svg {
    width: 15px;
    height: 15px;
    flex: none;
    opacity: 0.7;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 4px;
  }
</style>
