export type ShareTarget = 'whatsapp' | 'telegram';
export type ShareResult = 'shared' | 'cancelled' | 'fallback';

/** The screenshot library loads only when first needed, keeping the initial bundle small. */
export async function renderPng(el: HTMLElement): Promise<Blob> {
  const { domToBlob } = await import('modern-screenshot');
  return domToBlob(el, { scale: 2, backgroundColor: '#ffffff', type: 'image/png' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * The web cannot attach an image to a specific app. Where the device supports sharing files
 * (most phones), this opens the system share sheet with the PNG attached and the user picks
 * WhatsApp/Telegram there. Otherwise it downloads the PNG and opens the app's web share page
 * with the caption so the user can attach the image.
 */
export async function shareImage(blob: Blob, filename: string, caption: string, target: ShareTarget): Promise<ShareResult> {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: caption });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
      // NotAllowedError etc. -> fall through to download
    }
  }
  downloadBlob(blob, filename);
  const text = encodeURIComponent(caption);
  const url =
    target === 'whatsapp'
      ? `https://wa.me/?text=${text}`
      : `https://t.me/share/url?url=${encodeURIComponent(location.href)}&text=${text}`;
  window.open(url, '_blank', 'noopener');
  return 'fallback';
}
