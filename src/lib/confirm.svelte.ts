export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}

/** In-app replacement for window.confirm(): `await confirmGate.ask({...})` resolves true/false. */
class ConfirmGate {
  open = $state(false);
  options = $state<ConfirmOptions>({ title: '' });
  private resolve: ((ok: boolean) => void) | null = null;

  ask(options: ConfirmOptions): Promise<boolean> {
    this.resolve?.(false);
    this.options = options;
    this.open = true;
    return new Promise((r) => (this.resolve = r));
  }

  answer(ok: boolean) {
    this.open = false;
    const r = this.resolve;
    this.resolve = null;
    r?.(ok);
  }
}

export const confirmGate = new ConfirmGate();
