<script lang="ts">
  import { store } from '../lib/state.svelte';
  import { RECESS } from '../lib/config';
  import { blockNames, eventAt, slotNames } from '../lib/scheduler';
  import type { DayEvent, SetBlock, TeacherId } from '../lib/types';

  let {
    readonly = false,
    locked = false,
    onpick,
    onclass,
    onevent,
  }: {
    /** Exported image: plain text, no colours or buttons. */
    readonly?: boolean;
    /** Colours shown but cells can't be changed (offline, or no PIN on this device). */
    locked?: boolean;
    onpick?: (c: number, set: number, pos: number) => void;
    /** Tap on a class name: combine or split rows. */
    onclass?: (c: number) => void;
    /** Tap on an event (by its first slot): rename, merge, shorten or remove it. */
    onevent?: (start: number) => void;
  } = $props();

  const fmt = (label: string) => label.replace('-', '–');

  /** Smallest size the event text shrinks to; a word still too wide past this breaks mid-letter. */
  const MIN_EVENT_PX = 11;

  /**
   * Event names wrap between words only: the text shrinks until its longest word fits on one line
   * (e.g. "Keusahawanan" in the image's 126px column). Re-fits when the text or column width changes
   * (watching the text itself: an action's update runs before Svelte has written the new name).
   */
  function fitWords(el: HTMLElement) {
    const fit = () => {
      el.style.fontSize = '';
      el.style.overflowWrap = 'normal'; // a word too wide now overflows instead of breaking
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > el.clientWidth && size > MIN_EVENT_PX) el.style.fontSize = `${--size}px`;
      el.style.overflowWrap = '';
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement!);
    const mo = new MutationObserver(fit);
    mo.observe(el, { characterData: true, childList: true, subtree: true });
    document.fonts?.ready.then(fit);
    fit();
    return {
      destroy() {
        ro.disconnect();
        mo.disconnect();
      },
    };
  }

  /** Empty-cell text. The timetable is in Malay; the rest of the UI is English. */
  const EMPTY = 'Tiada guru';

  /** One teacher: her colour. Several: one colour stripe per name, left to right. */
  function cellStyle(ids: TeacherId[]): string | undefined {
    if (ids.length === 1) return `--h:${store.hue.get(ids[0])}`;
    if (ids.length > 1) {
      const w = 100 / ids.length;
      const stops = ids.map((id, i) => `hsl(${store.hue.get(id)} var(--chip-s) var(--chip-l)) ${i * w}% ${(i + 1) * w}%`);
      return `background: linear-gradient(90deg, ${stops.join(', ')})`;
    }
  }
</script>

{#snippet cell(ids: TeacherId[], c: number, set: number, pos: number, span: boolean)}
  {@const label = ids.map((id) => store.nameOf.get(id)).join(' / ')}
  {@const time = span ? `${store.slots[set * 2].split('-')[0]}–${store.slots[set * 2 + 1].split('-')[1]}` : fmt(store.slots[set * 2 + pos])}
  <td colspan={span ? 2 : undefined}>
    {#if readonly}
      <!-- Exported image: names as plain text, no teacher colours. -->
      <div class="tcell plain" class:empty={!ids.length}>
        {label || EMPTY}
      </div>
    {:else}
      <button
        class="tcell"
        class:tc={ids.length === 1}
        class:multi={ids.length > 1}
        class:empty={!ids.length}
        style={cellStyle(ids)}
        disabled={locked}
        aria-label="{store.rowLabels[c]}, {time}: {label || 'no teacher'}. Change"
        onclick={() => onpick?.(c, set, pos)}>
        {label || EMPTY}
        {#if span}<span class="span-mark" aria-hidden="true"></span>{/if}
      </button>
    {/if}
  </td>
{/snippet}

<!-- An event takes its slot(s) for every class, like recess: one cell down the whole column (or
     both columns on that side of recess), drawn in the first row. -->
{#snippet eventCell(s: number, e: DayEvent)}
  <td class="event" rowspan={store.day.tt.length} colspan={e.span === 2 ? 2 : undefined}>
    {#if readonly || locked}
      <div class="event-in"><span use:fitWords>{e.name}</span></div>
    {:else}
      <button class="event-in" aria-label="{e.name}, {store.slotTime(s, e.span ?? 1)}, every class. Change" onclick={() => onevent?.(s)}>
        <span use:fitWords>{e.name}</span>
      </button>
    {/if}
  </td>
{/snippet}

{#snippet setCells(b: SetBlock, c: number, set: number)}
  {#if b.merged}
    {@render cell(blockNames(b), c, set, 0, true)}
  {:else}
    {#each [0, 1] as pos}
      {#if store.blocked[set * 2 + pos]}
        <!-- Drawn from its first slot; the second slot of a two-slot event is inside that cell. -->
        {@const ev = c === 0 ? eventAt(store.day.events, set * 2 + pos) : null}
        {#if ev && ev.start === set * 2 + pos}{@render eventCell(ev.start, ev.event)}{/if}
      {:else}
        {@render cell(slotNames(b, pos), c, set, pos, false)}
      {/if}
    {/each}
  {/if}
{/snippet}

<table class="tt" class:readonly>
  <thead>
    <tr>
      <!-- Bil. (row number) is for the shared image only; in the app it costs scarce phone width. -->
      {#if readonly}<th class="bil" scope="col">Bil.</th>{/if}
      <th class="cls" scope="col">Kelas</th>
      <th scope="col">{fmt(store.slots[0])}</th>
      <th scope="col">{fmt(store.slots[1])}</th>
      <th scope="col" class="recess-h">{RECESS.split("-")[0]}–<wbr />{RECESS.split("-")[1]}</th>
      <th scope="col">{fmt(store.slots[2])}</th>
      <th scope="col">{fmt(store.slots[3])}</th>
    </tr>
  </thead>
  <tbody>
    {#each store.day.tt as row, c}
      <tr>
        {#if readonly}<td class="bil">{c + 1}</td>{/if}
        <th class="cls" scope="row">
          {#if readonly || locked}
            {store.rowLabels[c]}
          {:else}
            <button class="cls-btn" aria-label="{store.rowLabels[c]}: combine or split" onclick={() => onclass?.(c)}>{store.rowLabels[c]}</button>
          {/if}
        </th>
        {@render setCells(row.sets[0], c, 0)}
        {#if c === 0}
          <td class="recess" rowspan={store.day.tt.length}><span>Rehat</span></td>
        {/if}
        {@render setCells(row.sets[1], c, 1)}
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .tt {
    border-collapse: separate;
    border-spacing: 4px;
    width: 100%;
    min-width: 600px;
    table-layout: fixed;
  }

  th {
    font-size: 12.5px;
    font-weight: 650;
    color: var(--muted);
    padding: 6px 4px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  thead th {
    background: var(--surface-2);
    border-radius: 8px;
  }

  th.cls {
    width: 84px;
    text-align: left;
    padding-left: 10px;
  }

  tbody th.cls {
    color: var(--text);
    font-size: 14px;
    background: var(--surface-2);
    border-radius: 8px;
  }

  .bil {
    width: 40px;
    text-align: center;
  }

  thead th.bil {
    padding: 6px 2px;
  }

  td.bil {
    background: var(--surface-2);
    border-radius: 8px;
    color: var(--muted);
    font-size: 14px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }

  /* Keep Class visible while scrolling sideways on phones. The pinned cell draws a square
     backing plate (::before) that fills the 4px gaps so scrolled cells can't show through,
     with the rounded card (::after) on top of it. */
  .tt:not(.readonly) th.cls {
    position: sticky;
    left: 0;
    z-index: 1;
    background: none;
  }

  .tt:not(.readonly) th.cls::before,
  .tt:not(.readonly) th.cls::after {
    content: '';
    position: absolute;
    z-index: -1;
  }

  /* Reaches past the scroller's left padding too (overflow clips the excess). */
  .tt:not(.readonly) th.cls::before {
    inset: -4px;
    left: -12px;
    background: var(--surface);
  }

  .tt:not(.readonly) th.cls::after {
    inset: 0;
    border-radius: 8px;
    background: var(--surface-2);
  }

  /* Combined rows ("K10/K11") wrap at the slash rather than overflow the narrow column. */
  tbody th.cls {
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .cls-btn {
    display: block;
    width: 100%;
    min-height: 44px;
    margin: -6px 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    text-decoration: underline dotted;
    text-decoration-color: var(--muted);
    text-underline-offset: 3px;
    cursor: pointer;
  }

  th.recess-h,
  td.recess {
    width: 52px;
  }

  th.recess-h {
    white-space: normal;
    font-size: 11px;
    line-height: 1.15;
    padding: 4px 2px;
  }

  td {
    padding: 0;
    height: 52px;
  }

  td.recess {
    background: var(--recess-bg);
    border-radius: 8px;
    text-align: center;
    vertical-align: middle;
  }

  td.recess span {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    letter-spacing: 0.3em;
    text-transform: uppercase;
    font-size: 12px;
    font-weight: 700;
    color: var(--muted);
  }

  /* Event: like recess, one cell down the slot's column. The name reads across (the column is
     a full slot wide), and the inner box fills the cell whatever its rowspan. */
  td.event {
    position: relative;
    background: var(--recess-bg);
    border-radius: 8px;
  }

  .event-in {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 8px 6px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.25;
    text-align: center;
    overflow-wrap: anywhere;
  }

  /* Full width so a word too wide for the column shows as overflow (see fitWords). */
  .event-in span {
    width: 100%;
    max-height: 100%;
    overflow: hidden;
    text-wrap: balance;
  }

  button.event-in {
    cursor: pointer;
  }

  button.event-in:hover {
    background: rgb(127 127 127 / 0.08);
  }

  /* Header size, not name size: a long Malay word ("Perhimpunan") must fit the 126px column whole. */
  .tt.readonly .event-in {
    font-size: 17px;
  }

  .tcell {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-height: 48px;
    padding: 4px 6px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    text-align: center;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  button.tcell {
    transition: transform 0.1s, filter 0.15s;
  }

  button.tcell:disabled {
    cursor: default;
  }

  button.tcell:hover:not(:disabled) {
    filter: brightness(0.96) saturate(1.1);
  }

  button.tcell:active:not(:disabled) {
    transform: scale(0.98);
  }

  .tcell.multi {
    color: var(--text);
    border: 1px solid var(--border);
  }

  .tcell.empty {
    background: var(--warn-bg);
    color: var(--warn-text);
    border: 1px dashed var(--warn-border);
    font-weight: 500;
    font-size: 13px;
  }

  /* Exported image: sized to stay legible when the PNG is shrunk to fit a phone in a chat app.
     Fixed columns are kept lean so the four slot columns get the width. */
  .tt.readonly {
    border-spacing: 3px;
    min-width: 0;
  }

  .tt.readonly .bil {
    width: 34px;
  }

  .tt.readonly th {
    font-size: 17px;
    font-weight: 700;
    color: var(--text);
  }

  .tt.readonly thead th.bil,
  .tt.readonly thead th.cls {
    font-size: 14px;
    color: var(--muted);
  }

  .tt.readonly th.cls {
    width: 88px;
    padding-left: 8px;
  }

  .tt.readonly tbody th.cls {
    font-size: 18px;
  }

  .tt.readonly td.bil {
    font-size: 15px;
  }

  .tt.readonly th.recess-h {
    font-size: 14px;
  }

  .tt.readonly th.recess-h,
  .tt.readonly td.recess {
    width: 46px;
  }

  .tt.readonly td.recess span {
    font-size: 14px;
  }

  .tt.readonly td {
    height: 58px;
  }

  .tt.readonly .tcell {
    font-size: 20px;
    font-weight: 650;
    line-height: 1.15;
    padding: 4px;
    text-wrap: balance;
  }

  .tt.readonly .tcell.empty {
    font-size: 16px;
    font-weight: 600;
  }

  .tcell.plain:not(.empty) {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
  }

  /* Small bar at the bottom of a merged cell shows it spans two slots. */
  .span-mark {
    position: absolute;
    left: 25%;
    right: 25%;
    bottom: 5px;
    height: 3px;
    border-radius: 2px;
    background: currentColor;
    opacity: 0.25;
  }
</style>
