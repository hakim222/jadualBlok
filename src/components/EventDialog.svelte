<script lang="ts">
  import { store } from '../lib/state.svelte';
  import { eventAt } from '../lib/scheduler';

  /** Rename, merge, shorten or remove the event starting in slot `slot` (it takes that slot, or both
   *  on that side of recess, for every class). */
  let { slot, onclose }: { slot: number | null; onclose: () => void } = $props();

  let dlg: HTMLDialogElement;
  let name = $state('');

  const event = $derived(slot === null ? undefined : store.eventFrom(slot));
  const current = $derived(event?.name);
  /** One-slot event: the other slot on its side of recess, and the event already there (if any). */
  const other = $derived(slot === null ? 0 : slot ^ 1);
  const otherEvent = $derived(event && event.span !== 2 ? eventAt(store.day.events, other)?.event.name : undefined);

  $effect(() => {
    if (slot !== null && !dlg.open) {
      name = current ?? '';
      dlg.showModal();
    } else if (slot === null && dlg.open) dlg.close();
  });

  // The event went away (e.g. removed on another device): nothing left to act on.
  $effect(() => {
    if (slot !== null && current === undefined) onclose();
  });

  function save(e: SubmitEvent) {
    e.preventDefault();
    if (slot === null || !name.trim()) return;
    store.renameEvent(slot, name);
    dlg.close();
  }

  /** Merging or shortening moves the event's first slot, so the dialog closes. */
  function act(fn: () => void) {
    fn();
    dlg.close();
  }

  function remove() {
    if (slot === null) return;
    store.removeEvent(slot);
    dlg.close();
  }
</script>

<dialog bind:this={dlg} {onclose} onclick={(e) => e.target === dlg && dlg.close()} aria-labelledby="event-title">
  {#if slot !== null && current !== undefined}
    {@const s = slot}
    <form class="sheet" onsubmit={save}>
      <header>
        <div>
          <h3 id="event-title">{current}</h3>
          <p>{store.slotTime(slot, event?.span ?? 1)} · every class</p>
        </div>
        <button type="button" class="btn ghost close" aria-label="Close" onclick={() => dlg.close()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <label class="field">
        <span>Event name</span>
        <input type="text" bind:value={name} maxlength="40" autocomplete="off" required />
      </label>
      {#if event?.span === 2}
        <!-- Recess is fixed, so a two-slot event only ever shortens to one of its own slots. -->
        <fieldset class="shorten">
          <legend>Shorten to one slot</legend>
          <div class="actions">
            {#each [s, s + 1] as keep (keep)}
              <button type="button" class="btn" onclick={() => act(() => store.shortenEvent(s, keep))}>Only {store.slotTime(keep)}</button>
            {/each}
          </div>
        </fieldset>
      {:else}
        <button type="button" class="btn" disabled={!!otherEvent} onclick={() => act(() => store.mergeEvent(s))}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" /></svg>
          {otherEvent ? `Can't merge: ${otherEvent} is in ${store.slotTime(other)}` : `Merge with ${store.slotTime(other)}`}
        </button>
      {/if}
      <div class="actions">
        <button type="button" class="btn" onclick={remove}>Remove event</button>
        <button type="submit" class="btn primary" disabled={!name.trim() || name.trim() === current}>Save</button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    width: min(400px, calc(100vw - 32px));
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
    gap: 14px;
    padding: 16px;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  h3 {
    overflow-wrap: anywhere;
  }

  header p {
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 13px;
  }

  .close {
    width: 38px;
    padding: 0;
    margin: -6px -6px 0 0;
    flex: none;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    font-weight: 650;
    color: var(--muted);
  }

  .field input {
    min-height: 44px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 16px; /* 16px stops iOS zooming in on focus */
    font-weight: 500;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .shorten {
    margin: 0;
    padding: 0;
    border: 0;
  }

  .shorten legend {
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: 650;
    color: var(--muted);
  }

  .actions .btn {
    flex: 1;
  }
</style>
