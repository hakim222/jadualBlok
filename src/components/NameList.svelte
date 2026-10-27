<script lang="ts">
  import { store, type ListKind } from '../lib/state.svelte';
  import { pinGate } from '../lib/pin.svelte';
  import { confirmGate } from '../lib/confirm.svelte';
  import { isCancelled } from '../lib/api';

  /** One server list (teachers or classes) with today's availability ticks. */
  let { kind, notify }: { kind: ListKind; notify: (msg: string) => void } = $props();

  const TEXT = {
    teachers: {
      title: 'Teachers',
      placeholder: 'Add teacher (e.g. Cikgu Ali, Cikgu Siti)',
      newLabel: 'New teacher name',
      empty: 'No teachers yet. Add names below — separate several with commas.',
      removeMessage: 'This deletes the name from the shared teacher list on every device.',
      maxlength: 40,
    },
    classes: {
      title: 'Classes',
      placeholder: 'Add class (e.g. K16)',
      newLabel: 'New class name',
      empty: 'No classes yet. Add names below — separate several with commas.',
      removeMessage: "This deletes the class from the shared class list on every device, and takes its row out of every day's timetable.",
      maxlength: 20,
    },
  } as const;

  const text = $derived(TEXT[kind]);
  const isTeachers = $derived(kind === 'teachers');
  const items = $derived(isTeachers ? store.teachers : store.classes);
  const nameOf = $derived(isTeachers ? store.nameOf : store.classNameOf);

  let newName = $state('');
  let managing = $state(false);
  let saving = $state(false);
  // Phones start collapsed so the timetable is on the first screen; there is room to show the
  // teachers on wider screens. Classes change rarely, so they start collapsed everywhere.
  // `kind` never changes for a list, so reading it once here is enough.
  const startOpen = () => kind === 'teachers' && typeof matchMedia === 'function' && matchMedia('(min-width: 720px)').matches;
  let open = $state(startOpen());

  const off = $derived(isTeachers ? new Set(store.day.unavailable) : store.classesOff);
  const availableCount = $derived(items.filter((t) => !off.has(t.id)).length);
  /** Filling every row needs at least one teacher per row. */
  const short = $derived(isTeachers && items.length > 0 && availableCount < store.day.tt.length);
  const offline = $derived(store.sync === 'offline');
  const shown = $derived(open || items.length === 0);
  const offNames = $derived(items.filter((t) => off.has(t.id)).map((t) => t.name));

  function toggleOpen() {
    open = !open;
    if (!open) managing = false;
  }

  function toggle(id: string) {
    if (isTeachers) store.toggle(id);
    else store.toggleClass(id);
  }

  function setAll(on: boolean) {
    if (isTeachers) store.setAllAvailable(on);
    else store.setAllClasses(on);
  }

  /** Runs a server change, reporting failures (closing the PIN dialog is not a failure). */
  async function save(fn: () => Promise<void>) {
    saving = true;
    try {
      await fn();
    } catch (e) {
      if (!isCancelled(e)) notify(e instanceof Error ? e.message : 'Could not save. Check your connection.');
    } finally {
      saving = false;
    }
  }

  function add(e: SubmitEvent) {
    e.preventDefault();
    save(async () => {
      const skipped = await store.addToList(kind, newName);
      newName = '';
      if (skipped.length) notify(`Already in the list: ${skipped.join(', ')}`);
    });
  }

  function rename(id: string, input: HTMLInputElement) {
    const before = nameOf.get(id) ?? '';
    if (input.value.trim() === before) return;
    save(async () => {
      try {
        await store.renameInList(kind, id, input.value);
      } finally {
        input.value = nameOf.get(id) ?? before; // show what is actually saved
      }
    });
  }

  async function remove(id: string, name: string) {
    const ok = await confirmGate.ask({
      title: `Remove ${name}?`,
      message: text.removeMessage,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok) save(() => store.removeFromList(kind, id));
  }
</script>

<div class="head" class:collapsed={!shown && !offNames.length}>
  <h2>
    <button class="disclose" aria-expanded={shown} aria-controls="{kind}-panel" disabled={!items.length} onclick={toggleOpen}>
      <span>
        {text.title}
        <span class="count" class:short>
          {availableCount} of {items.length} available
        </span>
      </span>
      {#if items.length}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      {/if}
    </button>
  </h2>
  {#if shown}
  <div class="actions">
    {#if items.length && !managing && store.editable}
      <button class="btn small ghost" onclick={() => setAll(true)}>All</button>
      <button class="btn small ghost" onclick={() => setAll(false)}>None</button>
    {/if}
    {#if isTeachers && pinGate.unlocked}
      <button class="btn small ghost icon" title="Lock (forget admin PIN on this device)" aria-label="Lock editing" onclick={() => pinGate.forget()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></svg>
      </button>
    {/if}
    {#if items.length}
      <button class="btn small" aria-pressed={managing} disabled={offline} onclick={() => (managing = !managing)}>
        {managing ? 'Done' : 'Edit'}
      </button>
    {/if}
  </div>
  {/if}
</div>

<!-- One connection message for both lists: it sits with the teachers, which come first. -->
{#if isTeachers && offline}
  <p class="status warn" role="status">
    Can't reach the server. Showing the lists saved on this device; adding and removing are paused.
    <button class="link" onclick={() => store.refresh()}>Retry</button>
  </p>
{:else if isTeachers && store.sync === 'loading' && items.length === 0}
  <p class="status">Loading teachers…</p>
{/if}

{#if !shown && offNames.length}
  <p class="off-list">
    Not available: {offNames.slice(0, 5).join(', ')}{offNames.length > 5 ? ` and ${offNames.length - 5} more` : ''}
  </p>
{/if}

<div id="{kind}-panel" hidden={!shown}>
{#if items.length === 0}
  {#if store.sync === 'online'}
    <p class="empty">{text.empty}</p>
  {/if}
{:else}
  <ul class="chips" class:managing>
    {#each items as t (t.id)}
      <li style={isTeachers ? `--h:${store.hue.get(t.id)}` : undefined}>
        {#if managing}
          <div class="edit-chip">
            <input
              class="input"
              value={t.name}
              maxlength={text.maxlength}
              disabled={saving}
              aria-label="Rename {t.name}"
              onchange={(e) => rename(t.id, e.currentTarget)} />
            <button class="btn small ghost del" aria-label="Remove {t.name}" disabled={saving} onclick={() => remove(t.id, t.name)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
            </button>
          </div>
        {:else}
          <label class="chip" class:tc={isTeachers && !off.has(t.id)} class:neutral={!isTeachers && !off.has(t.id)} class:off={off.has(t.id)}>
            <input type="checkbox" checked={!off.has(t.id)} disabled={!store.editable} onchange={() => toggle(t.id)} />
            <span class="box" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-10" /></svg>
            </span>
            {t.name}
          </label>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<form class="add" onsubmit={add}>
  <input
    class="input"
    bind:value={newName}
    disabled={offline}
    placeholder={text.placeholder}
    aria-label={text.newLabel} />
  <button class="btn primary" type="submit" disabled={!newName.trim() || saving || offline}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14" /></svg>
    {saving ? 'Saving…' : 'Add'}
  </button>
</form>
</div>

<style>
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .head.collapsed {
    margin-bottom: 0;
  }

  .disclose {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    margin: -4px 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .disclose:disabled {
    cursor: default;
  }

  .disclose svg {
    width: 18px;
    height: 18px;
    flex: none;
    color: var(--muted);
    transition: transform 0.2s;
  }

  .disclose[aria-expanded='true'] svg {
    transform: rotate(180deg);
  }

  .count {
    display: block;
    margin: 2px 0 0;
    font-size: 13px;
    font-weight: 400;
    color: var(--muted);
  }

  .off-list {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }

  .count.short {
    color: var(--warn-text);
  }

  .actions {
    display: flex;
    gap: 4px;
  }

  .empty {
    margin: 0 0 12px;
    color: var(--muted);
  }

  .status {
    margin: 0 0 12px;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 13px;
  }

  .status.warn {
    background: var(--warn-bg);
    color: var(--warn-text);
    border: 1px solid var(--warn-border);
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font-weight: 650;
    text-decoration: underline;
  }

  .icon {
    width: 32px;
    padding: 0;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 14px;
    padding: 0;
    list-style: none;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 14px 0 10px;
    border-radius: 999px;
    font-weight: 550;
    cursor: pointer;
    user-select: none;
    transition: opacity 0.15s, background 0.15s;
  }

  .chip input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .chip:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .box {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    background: currentColor;
  }

  .box svg {
    width: 14px;
    height: 14px;
    color: hsl(var(--h) var(--chip-s) var(--chip-l));
  }

  /* Classes have no colour of their own: a plain chip with the box in the text colour. */
  .chip.neutral {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
  }

  .chip.neutral .box svg {
    color: var(--surface-2);
  }

  .chip.off {
    border: 1px dashed var(--border);
    color: var(--muted);
    text-decoration: line-through;
  }

  .chip.off .box {
    background: transparent;
    border: 2px solid var(--border);
  }

  .chip.off .box svg {
    display: none;
  }

  .managing li {
    flex: 1 1 200px;
  }

  .edit-chip {
    display: flex;
    gap: 4px;
  }

  .edit-chip .input {
    flex: 1;
  }

  .del {
    color: var(--danger);
    width: 40px;
    padding: 0;
  }

  .add {
    display: flex;
    gap: 8px;
  }

  .add .input {
    flex: 1;
  }
</style>
