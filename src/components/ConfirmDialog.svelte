<script lang="ts">
  import { confirmGate } from '../lib/confirm.svelte';

  let dlg: HTMLDialogElement;
  let cancelBtn = $state<HTMLButtonElement>();
  // Same pattern as PinDialog: 'close' fires asynchronously, so ignore closes made in code.
  let closingInCode = false;

  $effect(() => {
    if (confirmGate.open && !dlg.open) {
      dlg.showModal();
      cancelBtn?.focus(); // safer default for a destructive action
    } else if (!confirmGate.open && dlg.open) {
      closingInCode = true;
      dlg.close();
    }
  });

  function onClose() {
    if (closingInCode) closingInCode = false;
    else if (confirmGate.open) confirmGate.answer(false); // Escape
  }
</script>

<dialog
  bind:this={dlg}
  onclose={onClose}
  onclick={(e) => e.target === dlg && confirmGate.answer(false)}
  aria-labelledby="confirm-title"
  aria-describedby="confirm-msg">
  <div class="sheet">
    <h3 id="confirm-title">{confirmGate.options.title}</h3>
    {#if confirmGate.options.message}<p id="confirm-msg" class="sub">{confirmGate.options.message}</p>{/if}
    <div class="actions">
      <button bind:this={cancelBtn} type="button" class="btn ghost" onclick={() => confirmGate.answer(false)}>Cancel</button>
      <button
        type="button"
        class="btn"
        class:primary={!confirmGate.options.danger}
        class:danger={confirmGate.options.danger}
        onclick={() => confirmGate.answer(true)}>
        {confirmGate.options.confirmLabel ?? 'OK'}
      </button>
    </div>
  </div>
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
    margin: 0;
    color: var(--muted);
    font-size: 14px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
  }

  .danger {
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
  }

  .danger:hover {
    background: var(--danger);
    filter: brightness(1.08);
  }
</style>
