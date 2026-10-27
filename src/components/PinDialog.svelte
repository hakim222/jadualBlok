<script lang="ts">
  import { pinGate } from '../lib/pin.svelte';

  let dlg: HTMLDialogElement;
  let input = $state<HTMLInputElement>();
  let pin = $state('');
  let remember = $state(true);
  // dialog.close() fires 'close' asynchronously; by then a "wrong PIN" retry may have reopened
  // the gate, so only a close the user caused (Escape) may count as cancel.
  let closingInCode = false;

  $effect(() => {
    if (pinGate.open && !dlg.open) {
      pin = '';
      dlg.showModal();
      input?.focus();
    } else if (!pinGate.open && dlg.open) {
      closingInCode = true;
      dlg.close();
    }
  });

  function onClose() {
    if (closingInCode) closingInCode = false;
    else if (pinGate.open) pinGate.cancel(); // closed with Escape
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (pin.trim()) pinGate.submit(pin.trim(), remember);
  }
</script>

<dialog bind:this={dlg} onclose={onClose} aria-labelledby="pin-title">
  <form class="sheet" onsubmit={submit}>
    <h3 id="pin-title">Admin PIN</h3>
    <p class="sub">Needed to add, rename or remove teachers.</p>
    <input
      bind:this={input}
      bind:value={pin}
      class="input"
      type="password"
      inputmode="numeric"
      autocomplete="off"
      aria-label="Admin PIN"
      aria-invalid={!!pinGate.error}
      placeholder="Enter PIN" />
    {#if pinGate.error}<p class="error" role="alert">{pinGate.error}</p>{/if}
    <label class="remember"><input type="checkbox" bind:checked={remember} /> Remember on this device</label>
    <div class="actions">
      <button type="button" class="btn ghost" onclick={() => pinGate.cancel()}>Cancel</button>
      <button type="submit" class="btn primary" disabled={!pin.trim()}>Unlock</button>
    </div>
  </form>
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

  .sub {
    margin: -4px 0 4px;
    color: var(--muted);
    font-size: 13px;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }

  .remember {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--muted);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>
