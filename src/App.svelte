<script lang="ts">
  import { store } from './lib/state.svelte';
  import { formatMinutes } from './lib/config';
  import { longDate, longDateMs } from './lib/dates';
  import { countEmpty, teacherLoads } from './lib/scheduler';
  import type { PickTarget } from './lib/types';
  import { save } from './lib/storage';
  import { sync as live } from './lib/sync.svelte';
  import DatePicker from './components/DatePicker.svelte';
  import NameList from './components/NameList.svelte';
  import Timetable from './components/Timetable.svelte';
  import TeacherPicker from './components/TeacherPicker.svelte';
  import ClassMenu from './components/ClassMenu.svelte';
  import EventDialog from './components/EventDialog.svelte';
  import ExportBar from './components/ExportBar.svelte';
  import PinDialog from './components/PinDialog.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';

  let picking = $state<PickTarget | null>(null);
  let classRow = $state<number | null>(null);
  let eventSlot = $state<number | null>(null);
  let exportEl = $state<HTMLElement>();
  let toast = $state('');
  let toastTimer: ReturnType<typeof setTimeout>;

  function notify(msg: string) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 3500);
  }

  // An Undo toast stays for 10 s (the Undo button stays until the next change); a newer offer (new id) restarts the clock.
  $effect(() => {
    const id = store.undo?.id;
    if (id === undefined) return;
    const t = setTimeout(() => store.dismissOffer(id), 10_000);
    return () => clearTimeout(t);
  });

  // Messages from the store (e.g. a day changed on another device).
  $effect(() => {
    if (store.notice) notify(store.notice.text);
  });

  // Losing the connection or the PIN closes the menus: edits would not be saved.
  $effect(() => {
    if (!store.editable) {
      picking = null;
      classRow = null;
      eventSlot = null;
    }
  });

  // Rows added or removed (here or on another device) shift row numbers: an open cell menu would point at another class.
  $effect(() => {
    store.day.tt.length;
    picking = null;
  });

  function undo() {
    if (!store.canUndo) return;
    store.undoLast();
    notify('Undone.');
  }

  /** Ctrl/Cmd+Z undoes the last timetable change, except while typing (fields keep their own undo). */
  function onkeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, select, [contenteditable]') || !store.canUndo) return;
    e.preventDefault();
    undo();
  }

  // Persist on any change (stringify inside the effect tracks everything it reads).
  $effect(() => save({ teachers: store.teachers, classes: store.classes, days: store.days }));

  const dateLabel = $derived(longDate(store.date));
  const dateLabelMs = $derived(longDateMs(store.date)); // exported image + its share caption are Malay
  const empty = $derived(countEmpty(store.day.tt, store.blocked));
  /** Highlight Generate when the day is empty or out of date. */
  const promptGenerate = $derived(store.notGenerated || !!store.day.stale);
  const loads = $derived(teacherLoads(store.day.tt, store.minutes));
  const exportKey = $derived(JSON.stringify([store.date, store.day.tt, store.day.events, store.teachers, store.classes]));
</script>

<svelte:window {onkeydown} />

<header class="top">
  <div class="brand">
    <img src="./favicon.svg" alt="" width="28" height="28" />
    <h1>Jadual Blok</h1>
  </div>
  <span class="today-label">{dateLabel}</span>
</header>

<main>
  <section class="card" aria-labelledby="date-h">
    <h2 id="date-h" class="visually-hidden">Date</h2>
    <DatePicker />
  </section>

  <section class="card">
    <NameList kind="teachers" {notify} />
  </section>

  <section class="card">
    <NameList kind="classes" {notify} />
  </section>

  <section class="card" aria-labelledby="tt-h">
    <div class="tt-head">
      <div>
        <h2 id="tt-h">Timetable</h2>
        <p class="sub">
          {dateLabel}
          <span class="live" class:on={store.editable} class:off={live.status === 'offline'} role="status">
            {#if live.status === 'offline'}Offline: editing paused
            {:else if live.status === 'connecting'}Connecting…
            {:else if live.canEdit}Live
            {:else}Live · read-only{/if}
          </span>
        </p>
      </div>
      {#if store.editable}
        <div class="tt-actions">
          <button class="btn ghost" onclick={undo} disabled={!store.canUndo} title="Undo the last change (Ctrl+Z)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
            Undo
          </button>
          <button class="btn" class:ghost={!promptGenerate} class:primary={promptGenerate} onclick={() => store.regenerate()} disabled={!store.available.length}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 11a8 8 0 0 0-14.9-4M4 4v4h4M4 13a8 8 0 0 0 14.9 4M20 20v-4h-4" /></svg>
            {store.notGenerated ? 'Generate' : 'Regenerate'}
          </button>
        </div>
      {:else if live.status === 'live'}
        <button class="btn" onclick={() => live.unlock()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          Unlock to edit
        </button>
      {/if}
    </div>

    {#if !store.editable}
      <!-- Read-only: no prompts to press buttons this device can't use. -->
    {:else if store.day.tt.length === 0}
      <p class="notice">No classes today. Tick the classes being taught above.</p>
    {:else if store.teachers.length === 0}
      <p class="notice">Add teachers above, then press Generate to fill the timetable.</p>
    {:else if store.notGenerated}
      <p class="notice" role="status">Tick who's available above, then press Generate to fill the timetable.</p>
    {:else if store.day.stale}
      <p class="notice" role="status">Teachers, classes, availability or events changed. Press Regenerate to rebuild the timetable.</p>
    {/if}
    {#if store.teachers.length && !store.notGenerated && empty > 0}
      <p class="notice warn" role="status">
        {empty} slot{empty > 1 ? 's' : ''} without a teacher.
        {#if store.available.length < store.day.tt.length}
          Each teacher takes at most one class before and one after recess, so filling every row needs at least {store.day.tt.length} teachers; {store.available.length} available.
        {/if}
      </p>
    {/if}

    <div class="scroll">
      <Timetable locked={!store.editable} onpick={(c, set, pos) => (picking = { c, set, pos })} onclass={(c) => (classRow = c)} onevent={(s) => (eventSlot = s)} />
    </div>
    <p class="hint">Changes show live on every device. Tap a cell to change the teacher, swap, or merge/split the 2 slots before or after recess. Use a cell's Add event tab to block that slot for every class (e.g. assembly). Tap a class name to combine it with the row above or below, or split it. Changing availability doesn't rebuild the day; press Generate when you're ready.</p>

    {#if store.available.length}
      <details class="workload">
        <summary>
          Workload
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </summary>
        <ul class="loads">
          {#each store.available as t (t.id)}
            <li class="tc" style="--h:{store.hue.get(t.id)}">{t.name}<b>{formatMinutes(loads.get(t.id) ?? 0)}</b></li>
          {/each}
        </ul>
      </details>
    {/if}

    <ExportBar
      target={exportEl}
      stateKey={exportKey}
      filename="jadual-{store.date}.png"
      caption="Jadual Blok — {dateLabelMs}"
      {notify} />
  </section>
</main>

<!-- Off-screen, always-light copy used for the PNG export (full width, no buttons). -->
<div class="export-stage" aria-hidden="true">
  <div class="export-sheet force-light" bind:this={exportEl}>
    <div class="export-title">
      <!-- The date is what teachers look for; the app name is only a source label. -->
      <h1>{dateLabelMs}</h1>
      <span>Jadual Blok</span>
    </div>
    <Timetable readonly />
  </div>
</div>

<TeacherPicker target={picking} onclose={() => (picking = null)} />
<ClassMenu row={classRow} onclose={() => (classRow = null)} />
<EventDialog slot={eventSlot} onclose={() => (eventSlot = null)} />
<PinDialog />
<ConfirmDialog />

<div class="toasts">
  {#if store.undo && store.editable}
    <div class="toast undo" role="status">
      <span>{store.undo.message}</span>
      <button onclick={undo}>Undo</button>
    </div>
  {/if}
  {#if toast}
    <div class="toast" role="status">{toast}</div>
  {/if}
</div>

<style>
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    max-width: 1000px;
    margin: 0 auto;
    padding: 16px 16px 4px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .brand h1 {
    font-size: 20px;
    letter-spacing: -0.01em;
  }

  .today-label {
    font-size: 13px;
    color: var(--muted);
    text-align: right;
  }

  main {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 1000px;
    margin: 0 auto;
    padding: 12px 16px 40px;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 16px;
    box-shadow: var(--shadow);
    min-width: 0;
  }

  .card :global(h2) {
    font-size: 17px;
  }

  .tt-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .tt-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
  }

  .sub {
    margin: 2px 0 0;
    font-size: 13px;
    color: var(--muted);
  }

  .live {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: 6px;
    white-space: nowrap;
  }

  .live::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--muted);
  }

  .live.on::before {
    background: var(--accent);
  }

  .live.off {
    color: var(--warn-text);
  }

  .live.off::before {
    background: var(--warn-text);
  }

  .notice {
    margin: 0 0 10px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 14px;
  }

  .notice.warn {
    background: var(--warn-bg);
    color: var(--warn-text);
    border: 1px solid var(--warn-border);
  }

  .scroll {
    overflow-x: auto;
    margin: 0 -12px;
    padding: 0 8px;
    -webkit-overflow-scrolling: touch;
  }

  .hint {
    margin: 8px 0 16px;
    font-size: 12.5px;
    color: var(--muted);
  }

  .workload {
    margin-bottom: 16px;
  }

  .workload summary {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
    font-size: 13px;
    font-weight: 650;
    color: var(--muted);
    cursor: pointer;
    list-style: none;
    user-select: none;
  }

  .workload summary::-webkit-details-marker {
    display: none;
  }

  .workload summary svg {
    width: 16px;
    height: 16px;
    transition: transform 0.2s;
  }

  .workload[open] summary svg {
    transform: rotate(180deg);
  }

  .loads {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  }

  .loads li {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 550;
  }

  .loads b {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .export-stage {
    position: fixed;
    left: -10000px;
    top: 0;
    pointer-events: none;
  }

  /* Narrow on purpose: chat apps fit the PNG to a portrait phone, so every px of width
     shrinks the text. Slot columns end up 126px, just wider than the longest one-word name. */
  .export-sheet {
    width: 736px;
    padding: 20px;
    background: var(--surface);
    color: var(--text);
  }

  .export-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: 0 4px 12px;
  }

  .export-title h1 {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.1;
  }

  .export-title span {
    font-size: 15px;
    font-weight: 700;
    color: var(--muted);
  }

  .toasts {
    position: fixed;
    left: 50%;
    bottom: 20px;
    transform: translateX(-50%);
    width: max-content;
    max-width: calc(100vw - 32px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 20;
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    padding: 10px 16px;
    border-radius: 12px;
    background: var(--text);
    color: var(--bg);
    font-size: 14px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
  }

  .toast.undo {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 6px 4px 16px;
  }

  .toast.undo button {
    flex: none;
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .toast.undo button:hover {
    background: rgb(127 127 127 / 0.2);
  }

  .toast.undo button:focus-visible {
    outline-color: var(--bg);
  }
</style>
