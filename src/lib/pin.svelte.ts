const KEY = 'jadualblok:pin';

function readSaved(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * Holds the admin PIN and drives the PIN dialog. `get()` returns the known PIN or asks for it;
 * it resolves to null if the user cancels.
 */
class PinGate {
  open = $state(false);
  error = $state('');
  unlocked = $state(readSaved() !== null);
  private pin: string | null = readSaved();
  private resolve: ((pin: string | null) => void) | null = null;

  /** The known PIN, without asking. */
  current(): string | null {
    return this.pin;
  }

  get(): Promise<string | null> {
    return this.pin ? Promise.resolve(this.pin) : this.ask();
  }

  ask(error = ''): Promise<string | null> {
    this.resolve?.(null);
    this.error = error;
    this.open = true;
    return new Promise((r) => (this.resolve = r));
  }

  submit(pin: string, remember: boolean) {
    this.pin = pin;
    this.unlocked = true;
    try {
      if (remember) localStorage.setItem(KEY, pin);
      else localStorage.removeItem(KEY);
    } catch {
      /* kept in memory for this session */
    }
    this.finish(pin);
  }

  cancel() {
    this.finish(null);
  }

  /** Forget the PIN (wrong PIN, or the user locks the app). */
  forget() {
    this.pin = null;
    this.unlocked = false;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing saved */
    }
  }

  private finish(pin: string | null) {
    this.open = false;
    this.error = '';
    const r = this.resolve;
    this.resolve = null;
    r?.(pin);
  }
}

export const pinGate = new PinGate();
