<script lang="ts">
  import { store } from '../lib/state.svelte';
  import { formatMinutes } from '../lib/config';
  import { MAX_MERGED_NAMES, canMerge, cellNames, classInOtherSet, clearSlot, eventAt, locateOnSide, maxNames, teacherLoads } from '../lib/scheduler';
  import type { PickTarget } from '../lib/types';

  let { target, onclose }: { target: PickTarget | null; onclose: () => void } = $props();

  let dlg: HTMLDialogElement;

  /** Teachers for this cell (single cell with one name: replace it, or add a second one beside
   *  it), or an event that takes the slot for every class. */
  type Tab = 'change' | 'add' | 'event';
  let tab = $state<Tab>('change');

  /** Event tab: its name, and where it goes as "start:span" (see eventChoices). */
  let eventName = $state('');
  let eventChoice = $state('');

  $effect(() => {
    if (target && !dlg.open) {
      tab = 'change';
      eventName = '';
      // A merged cell already covers both slots; a single cell, its own slot.
      eventChoice = store.day.tt[target.c]?.sets[target.set].merged ? `${target.set * 2}:2` : `${target.set * 2 + target.pos}:1`;
      dlg.showModal();
    } else if (!target && dlg.open) dlg.close();
  });

  /** Arrow keys move between tabs (the WAI-ARIA tabs pattern). */
  function tabKeys(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const ids = tabs.map((t) => t.id);
    const i = ids.indexOf(tab);
    tab = ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
    document.getElementById(`picker-tab-${tab}`)?.focus();
  }

  const info = $derived.by(() => {
    if (!target) return null;
    const { c, set, pos } = target;
    const tt = store.day.tt;
    if (!tt[c]) return null;
    const block = tt[c].sets[set];
    const slotsHere = block.merged ? [set * 2, set * 2 + 1] : [set * 2 + pos];
    const current = block.t[block.merged ? 0 : pos];
    const first = store.slots[slotsHere[0]].split('-')[0];
    const last = store.slots[slotsHere.at(-1)!].split('-')[1];
    const load = teacherLoads(tt, store.minutes);
    // Single cell: anyone can be picked. A teacher who already has a class on this side of recess
    // swaps with the current teacher (same slot, the other slot, or her merged cell), so both keep
    // exactly one class per side; into an empty cell she simply moves.
    const slot = set * 2 + pos;
    const fmt = (sl: number) => store.slots[sl].replace('-', '–');
    const options = store.available
      .map((t) => {
        const spot = block.merged || t.id === current ? null : locateOnSide(tt, set, t.id);
        let move = '';
        if (spot) {
          const verb = current ? 'Swap with' : 'Moves from';
          if (spot.merged) move = `${verb} ${store.rowLabels[spot.c]} (merged)`;
          else if (spot.s === slot) move = `${verb} ${store.rowLabels[spot.c]}`;
          else if (spot.c === c) move = current ? `Swap slots with ${fmt(spot.s)}` : `Moves from ${fmt(spot.s)}`;
          else move = `${verb} ${store.rowLabels[spot.c]} at ${fmt(spot.s)}`;
        }
        const sameClass = classInOtherSet(tt, set, t.id) === c;
        // 0 free, 1 swap/move, 2 allowed but not preferred (same class across recess)
        const rank = sameClass ? 2 : move ? 1 : 0;
        return { id: t.id, name: t.name, move, sameClass, rank, load: load.get(t.id) ?? 0 };
      })
      .sort((a, b) => +(b.id === current) - +(a.id === current) || a.rank - b.rank || a.load - b.load);
    // Merged cell: a list of names. Teachers already in it show as chips; anyone else can be added
    // (moving them out of their other cell on this side of recess). A single cell can take a second
    // name the same way.
    const names = cellNames(block, pos);
    const addable = store.available
      .filter((t) => !names.includes(t.id))
      .map((t) => {
        // Wherever she teaches on this side of recess (either slot), she leaves it to join this cell.
        const spot = locateOnSide(tt, set, t.id);
        let move = '';
        if (spot?.merged) move = `Moves from ${store.rowLabels[spot.c]} (merged)`;
        else if (spot && spot.c === c) move = `Moves from ${fmt(spot.s)}`;
        else if (spot) move = `Moves from ${store.rowLabels[spot.c]}${spot.s === slot ? '' : ` at ${fmt(spot.s)}`}`;
        const sameClass = classInOtherSet(tt, set, t.id) === c;
        const rank = move ? 2 : sameClass ? 1 : 0;
        return { id: t.id, name: t.name, move, sameClass, rank, load: load.get(t.id) ?? 0 };
      })
      .sort((a, b) => a.rank - b.rank || a.load - b.load);
    // Grouped so the kind of change reads from the heading; amber is kept for the one rule conflict.
    const twice = `Not preferred: would teach ${store.rowLabels[c]} twice`;
    const optionGroups = [
      { title: 'Free', items: options.filter((o) => o.id !== current && o.rank === 0) },
      { title: current ? 'Swap' : 'Move here', items: options.filter((o) => o.id !== current && o.rank === 1) },
      { title: twice, items: options.filter((o) => o.id !== current && o.rank === 2) },
    ].filter((g) => g.items.length);
    const addGroups = [
      { title: 'Free', items: addable.filter((o) => o.rank === 0) },
      { title: twice, items: addable.filter((o) => o.rank === 1) },
      { title: 'Move here', items: addable.filter((o) => o.rank === 2) },
    ].filter((g) => g.items.length);
    return {
      c,
      set,
      pos,
      currentOpt: options.find((o) => o.id === current),
      optionGroups,
      addGroups,
      otherSide: set === 0 ? 'after' : 'before',
      merged: block.merged,
      names,
      max: maxNames(block),
      canMerge: canMerge(block),
      /** The other slot on this side has an event, so the 2 slots can't merge. */
      eventBeside: eventAt(store.day.events, set * 2 + (1 - pos))?.event.name,
      addable,
      current,
      time: `${first}–${last}`,
      options,
    };
  });

  /** "Change teacher" and "Add teacher" only for a single cell with one name and room for another. */
  const tabs = $derived.by((): { id: Tab; label: string }[] => {
    if (!info) return [];
    const pair = !info.merged && !!info.current && info.names.length < info.max && info.options.length > 0;
    const teacherTabs: { id: Tab; label: string }[] = pair
      ? [
          { id: 'change', label: 'Change teacher' },
          { id: 'add', label: 'Add teacher' },
        ]
      : [{ id: 'change', label: info.names.length ? 'Teachers' : 'Choose teacher' }];
    return [...teacherTabs, { id: 'event', label: 'Add event' }];
  });

  /** Where an event can go from this cell: either slot on this side of recess, or both (never across
   *  recess). Slots another event already takes are left out. */
  const eventChoices = $derived.by(() => {
    if (!info) return [];
    const a = info.set * 2;
    const b = a + 1;
    const all: { key: string; start: number; span: 1 | 2; label: string }[] = [
      { key: `${a}:1`, start: a, span: 1, label: store.slotTime(a) },
      { key: `${b}:1`, start: b, span: 1, label: store.slotTime(b) },
      { key: `${a}:2`, start: a, span: 2, label: 'Both slots' },
    ];
    return all.filter((o) => !store.blocked[o.start] && !(o.span === 2 && store.blocked[b]));
  });

  const chosenEvent = $derived(eventChoices.find((o) => o.key === eventChoice) ?? eventChoices[0]);

  /** Teachers who'd lose a cell: worked out on a copy, exactly as adding the event would. */
  const eventLeavers = $derived.by(() => {
    if (!chosenEvent) return 0;
    const tt = $state.snapshot(store.day.tt);
    const slots = chosenEvent.span === 2 ? [chosenEvent.start, chosenEvent.start + 1] : [chosenEvent.start];
    return new Set(slots.flatMap((sl) => clearSlot(tt, sl))).size;
  });

  function addEvent(e: SubmitEvent) {
    e.preventDefault();
    if (!eventName.trim() || !chosenEvent) return;
    store.addEvent(chosenEvent.start, eventName, chosenEvent.span);
    dlg.close();
  }

  function choose(id: string) {
    if (!info) return;
    store.assign(info.c, info.set, info.pos, id);
    dlg.close();
  }

  function clearCell() {
    if (!info) return;
    const who = info.names.map((id) => store.nameOf.get(id)).join(', ');
    store.clearCell(info.c, info.set, info.pos, `${who} removed from ${store.rowLabels[info.c]}, ${info.time}.`);
    dlg.close();
  }

  function addName(id: string) {
    if (info) store.addName(info.c, info.set, info.pos, id);
  }

  function removeName(id: string) {
    if (info) store.removeName(info.c, info.set, info.pos, id);
  }

  function toggleMerge() {
    if (!info) return;
    const wasMerged = info.merged;
    store.toggleMerge(info.c, info.set);
    // After merging, stay open so names can be added; after splitting, we're done.
    if (wasMerged) dlg.close();
  }
</script>

{#snippet chips(names: string[])}
  <section aria-label="Names in this cell">
    {#if names.length}
      <ul class="names">
        {#each names as id (id)}
          <li class="name-chip tc" style="--h:{store.hue.get(id)}">
            {store.nameOf.get(id)}
            <button class="chip-x" aria-label="Remove {store.nameOf.get(id)} from this cell" onclick={() => removeName(id)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="none">No teacher in this cell yet.</p>
    {/if}
  </section>
{/snippet}

{#snippet addList(heading: boolean)}
  {#if info}
    {#if info.addable.length === 0}
      <p class="none">No other teachers available on this day.</p>
    {:else}
      {#if heading}<h4 class="list-h">Add a teacher</h4>{/if}
      {#each info.addGroups as g (g.title)}
        <h5 class="group-h" class:warn={g.title.startsWith('Not')}>{g.title}</h5>
        <ul class="options">
          {#each g.items as o (o.id)}
            <li>
              <button class="opt" onclick={() => addName(o.id)}>
                {@render row(
                  o.name,
                  o.id,
                  o.load,
                  o.move,
                  o.sameClass ? `Teaches ${store.rowLabels[info.c]} ${info.otherSide} recess` : '',
                )}
              </button>
            </li>
          {/each}
        </ul>
      {/each}
    {/if}
  {/if}
{/snippet}

{#snippet changeList()}
  {#if info}
    {#each info.optionGroups as g (g.title)}
      <h4 class="group-h" class:warn={g.title.startsWith('Not')}>{g.title}</h4>
      <ul class="options">
        {#each g.items as o (o.id)}
          <li>
            <button class="opt" onclick={() => choose(o.id)}>
              {@render row(o.name, o.id, o.load, o.move, o.sameClass ? `Teaches ${store.rowLabels[info.c]} ${info.otherSide} recess` : '')}
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
{/snippet}

{#snippet row(name: string, id: string, load: number, detail: string, conflict: string)}
  <span class="dot tc" style="--h:{store.hue.get(id)}"></span>
  <span class="text">
    <span class="name">{name}</span>
    {#if detail}<span class="detail">{detail}</span>{/if}
    {#if conflict}
      <span class="detail conflict">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 4 2.5 20h19L12 4Zm0 6v4m0 3v.01" /></svg>
        {conflict}
      </span>
    {/if}
  </span>
  <span class="load"><span class="visually-hidden">teaching today: </span>{formatMinutes(load)}</span>
{/snippet}

<!-- What the cell's teachers can be changed to (the first tab). -->
{#snippet teacherPanel()}
  {#if info}
    {#if info.merged}
      {@render chips(info.names)}
      {#if info.names.length >= info.max}
        <p class="none">This cell is full ({info.max} names). Remove a name to add another.</p>
      {:else}
        {@render addList(true)}
      {/if}
    {:else if info.names.length >= info.max}
      <!-- Full single cell: change it by removing a name first. -->
      {@render chips(info.names)}
      <p class="none">This cell is full ({info.max} names). Remove a name to add or swap another.</p>
    {:else if info.options.length === 0}
      <p class="none">No teachers available on this day.</p>
    {:else if info.current && !info.optionGroups.length}
      <p class="none">No other teachers available on this day.</p>
    {:else}
      {@render changeList()}
    {/if}
  {/if}
{/snippet}

<!-- An event takes one slot or both on this side of recess, for every class; only its name is needed. -->
{#snippet eventForm()}
  {#if info}
    <form class="event-form" onsubmit={addEvent}>
      {#if eventChoices.length > 1}
        <fieldset class="slot-choice">
          <legend>Takes</legend>
          {#each eventChoices as o (o.key)}
            <label class:on={chosenEvent?.key === o.key}>
              <input type="radio" name="event-slot" value={o.key} bind:group={eventChoice} />
              {o.label}
            </label>
          {/each}
        </fieldset>
      {/if}
      <label class="field">
        <span>Event name</span>
        <input type="text" bind:value={eventName} maxlength="40" placeholder="e.g. Perhimpunan" autocomplete="off" required />
      </label>
      <p class="none">
        {#if chosenEvent}Takes {store.slotTime(chosenEvent.start, chosenEvent.span)} for every class, like recess.{/if}
        {#if eventLeavers}{eventLeavers} teacher{eventLeavers > 1 ? 's' : ''} will be taken out (you can undo).{/if}
      </p>
      <button class="btn primary" type="submit" disabled={!eventName.trim()}>Add event</button>
    </form>
  {/if}
{/snippet}

<dialog
  bind:this={dlg}
  {onclose}
  onclick={(e) => e.target === dlg && dlg.close()}
  aria-labelledby="picker-title">
  {#if info}
    <div class="sheet">
      <header>
        <div>
          <h3 id="picker-title">{store.rowLabels[info.c]}</h3>
          <p>{info.time} · {info.set === 0 ? 'before recess' : 'after recess'} · {info.merged ? 'merged, ' : ''}up to {info.max} names</p>
        </div>
        <button class="btn ghost close" aria-label="Close" onclick={() => dlg.close()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>

      {#if tab !== 'event' && tabs.some((t) => t.id === 'add') && info.currentOpt}
        {@const o = info.currentOpt}
        <button class="opt current" disabled>
          {@render row(
            o.name,
            o.id,
            o.load,
            'In this cell now',
            o.sameClass ? `Teaches ${store.rowLabels[info.c]} ${info.otherSide} recess` : '',
          )}
        </button>
      {/if}
      <div class="tabs" role="tablist" aria-label="Teachers or event">
        {#each tabs as t (t.id)}
          <button
            id="picker-tab-{t.id}"
            class="tab"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="picker-panel"
            tabindex={tab === t.id ? 0 : -1}
            onclick={() => (tab = t.id)}
            onkeydown={tabKeys}>{t.label}</button>
        {/each}
      </div>
      <div id="picker-panel" class="panel" role="tabpanel" aria-labelledby="picker-tab-{tab}">
        {#if tab === 'event'}
          {@render eventForm()}
        {:else if tab === 'add'}
          {@render addList(false)}
        {:else}
          {@render teacherPanel()}
        {/if}
      </div>

      <!-- Pinned to the bottom of the sheet: in thumb reach, and after the teacher list so a
           stray first tap lands on a teacher rather than emptying the cell (which can be undone). -->
      {#if tab !== 'event'}
      <div class="cell-actions">
        <button class="btn" onclick={toggleMerge} disabled={!info.canMerge || !!info.eventBeside}>
          {#if info.merged}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v16M4 12h4M16 12h4" /></svg>
            Split into 2 slots
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" /></svg>
            {info.eventBeside
              ? `Can't merge: ${info.eventBeside} is in the other slot`
              : info.canMerge
                ? `Merge with ${info.pos === 0 ? 'next' : 'previous'} slot`
                : `Can't merge: over ${MAX_MERGED_NAMES} names`}
          {/if}
        </button>
        {#if info.names.length}
          <button class="btn" onclick={clearCell}>{info.merged ? 'Clear cell' : 'Leave empty'}</button>
        {/if}
        {#if info.merged || info.names.length > 1}
          <button class="btn primary done" onclick={() => dlg.close()}>Done</button>
        {/if}
      </div>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(440px, 100vw);
    max-height: min(80vh, 640px);
    max-height: min(85dvh, 640px); /* dvh: the phone's browser toolbar can't hide the bottom buttons */
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

  /* Bottom sheet on phones. */
  @media (max-width: 560px) {
    dialog {
      /* Pinned to the screen edges rather than 100vw, which can exceed the screen on phones. */
      inset: auto 0 0;
      margin: 0;
      width: auto;
      max-width: none;
      border-radius: 16px 16px 0 0;
      border-bottom: 0;
    }
  }

  .sheet {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
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
  }


  .options {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .opt {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 46px;
    padding: 6px 10px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    text-align: left;
  }

  .tabs {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 11px;
    background: var(--surface-2);
  }

  .tab {
    flex: 1;
    min-height: 36px;
    padding: 0 4px; /* three tabs fit a phone on one line each */
    font-size: 14px;
    white-space: nowrap;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    font-weight: 600;
  }

  .tab:hover:not([aria-selected='true']) {
    color: var(--text);
  }

  .tab[aria-selected='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .event-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
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

  .slot-choice {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .slot-choice legend {
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: 650;
    color: var(--muted);
  }

  .slot-choice label {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    border: 1px solid var(--border);
    border-radius: 10px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  .slot-choice label.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .slot-choice input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .slot-choice label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .opt:hover:not(:disabled) {
    background: var(--surface-2);
  }

  .opt.current {
    border-color: var(--accent);
    background: var(--accent-soft);
    cursor: default;
  }

  .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    flex: none;
  }

  .text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .name {
    font-weight: 600;
  }

  .detail {
    font-size: 13px;
    color: var(--muted);
  }

  /* The one real rule conflict: same class on both sides of recess. */
  .detail.conflict {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--warn-text);
  }

  .conflict svg {
    width: 14px;
    height: 14px;
    flex: none;
  }

  .load {
    flex: none;
    font-size: 13px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .group-h {
    margin: 6px 0 -6px 10px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--muted);
  }

  .group-h.warn {
    color: var(--warn-text);
  }

  .none {
    margin: 0;
    color: var(--muted);
  }


  .names {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .name-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 36px;
    padding: 0 4px 0 12px;
    border-radius: 999px;
    font-weight: 600;
  }

  .chip-x {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: inherit;
  }

  .chip-x:hover {
    background: rgb(0 0 0 / 0.08);
  }

  .chip-x svg {
    width: 14px;
    height: 14px;
  }

  .list-h {
    margin: 4px 0 -4px;
    font-size: 13px;
    font-weight: 650;
    color: var(--muted);
  }

  .cell-actions {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 -16px -16px;
    padding: 12px 16px max(12px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
    background: var(--surface);
  }

  .cell-actions .btn {
    flex: 1 1 auto;
  }
</style>
