<script lang="ts">
  import { downloadBlob, renderPng, shareImage, type ShareTarget } from '../lib/export';

  let {
    target,
    stateKey,
    filename,
    caption,
    notify,
  }: {
    target: HTMLElement | undefined;
    stateKey: string;
    filename: string;
    caption: string;
    notify: (msg: string) => void;
  } = $props();

  // Pre-render after changes settle so a later share happens right away. Phones (Safari in
  // particular) only allow the share sheet shortly after the tap.
  let cache: { key: string; blob: Blob } | null = null;
  let busy = $state(false);

  $effect(() => {
    const key = stateKey;
    const el = target;
    if (!el) return;
    const timer = setTimeout(async () => {
      try {
        cache = { key, blob: await renderPng(el) };
      } catch {
        /* rendered again on demand */
      }
    }, 600);
    return () => clearTimeout(timer);
  });

  async function getBlob(): Promise<Blob> {
    if (cache?.key === stateKey) return cache.blob;
    const blob = await renderPng(target!);
    cache = { key: stateKey, blob };
    return blob;
  }

  async function run(fn: (blob: Blob) => Promise<void> | void) {
    if (!target || busy) return;
    busy = true;
    try {
      await fn(await getBlob());
    } catch (e) {
      console.error(e);
      notify('Could not create the image. Please try again.');
    } finally {
      busy = false;
    }
  }

  const download = () => run((blob) => downloadBlob(blob, filename));

  const share = (to: ShareTarget) =>
    run(async (blob) => {
      const res = await shareImage(blob, filename, caption, to);
      if (res === 'fallback') notify('Image downloaded. Attach it in the chat that just opened.');
    });
</script>

<div class="bar">
  <button class="btn" disabled={busy} onclick={download}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>
    Download PNG
  </button>
  <button class="btn wa" disabled={busy} onclick={() => share('whatsapp')}>
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.6-.3Z" /></svg>
    WhatsApp
  </button>
  <button class="btn tg" disabled={busy} onclick={() => share('telegram')}>
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2l-11 6.9L1.8 11.7c-1-.3-1-1 .2-1.5l18.5-7.1c.9-.3 1.6.2 1.4 1.2Z" /></svg>
    Telegram
  </button>
</div>

<style>
  /* Wraps instead of overflowing: 3 across when there is room, otherwise Download on its own row
     and the share buttons below. Bases are in em, so enlarged phone text wraps sooner too. */
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .bar .btn {
    flex: 1 1 8.5em;
    min-height: 44px;
    white-space: normal;
  }

  .wa {
    background: #25d366;
    border-color: #25d366;
    color: #06361b;
  }

  .tg {
    background: #229ed9;
    border-color: #229ed9;
    color: #062a40; /* dark text, like WhatsApp: white on this blue is only 3:1 */
  }

  .wa:hover:not(:disabled),
  .tg:hover:not(:disabled) {
    filter: brightness(1.06);
  }

  .wa:hover:not(:disabled) {
    background: #25d366;
  }

  .tg:hover:not(:disabled) {
    background: #229ed9;
  }

  @media (max-width: 560px) {
    .bar .btn:first-child {
      flex-basis: 100%;
    }
  }
</style>
