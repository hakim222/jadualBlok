<script lang="ts">
  import { store } from '../lib/state.svelte';
  import { MONTH_NAMES, addDays, fromISO, isWeekend, mondayOf, toISO, todaySchoolDay } from '../lib/dates';

  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let weekStart = $state(mondayOf(fromISO(store.date)));
  let showMonth = $state(false);
  let monthCursor = $state(new Date(fromISO(store.date).getFullYear(), fromISO(store.date).getMonth(), 1));

  const week = $derived(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)));
  // Label the week by its Thursday so a week spanning two months reads naturally.
  const weekLabel = $derived.by(() => {
    const mid = addDays(weekStart, 3);
    return `${MONTH_NAMES[mid.getMonth()]} ${mid.getFullYear()}`;
  });

  const monthDays = $derived.by(() => {
    const first = monthCursor;
    const start = mondayOf(first);
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
    return Array.from({ length: cells }, (_, i) => addDays(start, i));
  });

  function pick(d: Date) {
    if (isWeekend(d)) return;
    store.setDate(toISO(d));
    weekStart = mondayOf(d);
    showMonth = false;
  }

  function toggleMonth() {
    showMonth = !showMonth;
    if (showMonth) {
      const sel = fromISO(store.date);
      monthCursor = new Date(sel.getFullYear(), sel.getMonth(), 1);
    }
  }

  function shiftMonth(n: number) {
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + n, 1);
  }
</script>

<div class="picker">
  <div class="nav">
    <button class="btn ghost icon" aria-label="Previous week" onclick={() => (weekStart = addDays(weekStart, -7))}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6" /></svg>
    </button>
    <button class="btn ghost month-label" aria-expanded={showMonth} onclick={toggleMonth}>
      {weekLabel}
      <svg class:open={showMonth} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <button class="btn ghost icon" aria-label="Next week" onclick={() => (weekStart = addDays(weekStart, 7))}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6" /></svg>
    </button>
    <button class="btn small today-btn" onclick={() => pick(fromISO(todaySchoolDay()))}>Today</button>
  </div>

  {#if showMonth}
    <div class="month" role="group" aria-label="Month calendar">
      <div class="month-nav">
        <button class="btn ghost icon" aria-label="Previous month" onclick={() => shiftMonth(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <strong>{MONTH_NAMES[monthCursor.getMonth()]} {monthCursor.getFullYear()}</strong>
        <button class="btn ghost icon" aria-label="Next month" onclick={() => shiftMonth(1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>
      <div class="grid">
        {#each DOW as d, i}<span class="dow" class:weekend={i > 4}>{d}</span>{/each}
        {#each monthDays as d (toISO(d))}
          {@const iso = toISO(d)}
          <button
            class="mday"
            class:outside={d.getMonth() !== monthCursor.getMonth()}
            class:selected={iso === store.date}
            disabled={isWeekend(d)}
            aria-pressed={iso === store.date}
            onclick={() => pick(d)}>{d.getDate()}</button>
        {/each}
      </div>
    </div>
  {:else}
    <div class="week" role="group" aria-label="School days this week">
      {#each week as d, i (toISO(d))}
        {@const iso = toISO(d)}
        <button
          class="day"
          class:selected={iso === store.date}
          disabled={isWeekend(d)}
          aria-pressed={iso === store.date}
          title={isWeekend(d) ? 'No school on weekends' : undefined}
          onclick={() => pick(d)}>
          <span class="dow">{DOW[i]}</span>
          <span class="num">{d.getDate()}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .nav {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-bottom: 10px;
  }

  .icon {
    width: 38px;
    padding: 0;
  }

  .month-label {
    flex: 1;
    min-width: 0; /* may wrap with large phone text rather than push Today off-screen */
    white-space: normal;
    font-size: 16px;
    font-weight: 650;
  }

  .month-label svg {
    transition: transform 0.2s;
  }

  .month-label svg.open {
    transform: rotate(180deg);
  }

  .today-btn {
    margin-left: 6px;
  }

  .week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 6px;
  }

  .day {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 0;
    min-height: 56px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    transition: background 0.15s, border-color 0.15s;
  }

  .day .dow {
    font-size: 12px;
    color: var(--muted);
  }

  .day .num {
    font-size: 18px;
    font-weight: 650;
  }

  .day:hover:not(:disabled):not(.selected),
  .mday:hover:not(:disabled):not(.selected) {
    background: var(--surface-2);
  }

  .day.selected,
  .mday.selected {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .day.selected .dow {
    color: inherit;
    opacity: 0.85;
  }

  .day:disabled,
  .mday:disabled {
    opacity: 0.35;
    background: transparent;
    border-style: dashed;
  }

  .month-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
    text-align: center;
  }

  .grid .dow {
    font-size: 12px;
    color: var(--muted);
    padding: 4px 0;
  }

  .grid .dow.weekend {
    opacity: 0.5;
  }

  .mday {
    min-height: 40px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: var(--surface);
    font-weight: 550;
  }

  .mday.outside:not(.selected) {
    color: var(--muted);
  }

  .mday:disabled {
    border-color: transparent;
  }
</style>
