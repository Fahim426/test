import { useRef, useState, type DragEvent } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/cn';
import { toast } from '@/store/toast';

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** Downscale a picture in the browser so uploads stay small. SVG is kept as-is. */
export async function resizeImage(file: File, maxSide: number, type: 'image/jpeg' | 'image/webp' | 'image/png' = 'image/jpeg', quality = 0.85): Promise<Blob> {
  if (file.type === 'image/svg+xml') return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Could not read that image'));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#fff'; // JPEG has no transparency
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process that image'))), type, quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const blobToDataUrl = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

interface Props {
  /** current picture (URL or data URL) */
  src?: string | null;
  /** receives the picked file (already validated); null when removed */
  onPick: (file: File) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  /** box size in px */
  size?: number;
  allowSvg?: boolean;
  maxMb?: number;
  emptyText?: string;
  className?: string;
  fit?: 'contain' | 'cover';
}

/** Picture box with click / drag-and-drop upload, preview and remove. */
export function ImagePicker({ src, onPick, onRemove, disabled, busy, size = 168, allowSvg, maxMb = 10, emptyText = 'Add a picture', className, fit = 'contain' }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const accept = allowSvg ? ACCEPT : ACCEPT.filter((t) => t !== 'image/svg+xml');

  const take = async (f?: File | null) => {
    if (!f || disabled) return;
    if (!accept.includes(f.type)) return toast.error(`Use a ${allowSvg ? 'PNG, JPG, WEBP or SVG' : 'PNG, JPG or WEBP'} image`);
    if (f.size > maxMb * 1024 * 1024) return toast.error(`Picture is larger than ${maxMb} MB`);
    await onPick(f);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer.files?.[0]);
  };

  return (
    <div className={cn('flex flex-col items-center gap-2', className)} style={{ width: size }}>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        title={disabled ? undefined : src ? 'Click or drop to replace' : 'Click or drop a picture here'}
        style={{ width: size, height: size }}
        className={cn(
          'group relative flex items-center justify-center overflow-hidden rounded-xl border bg-surface-2 transition',
          src ? 'border-line' : 'border-dashed border-line-strong',
          !disabled && 'hover:border-brand hover:bg-brand-soft/40',
          over && 'border-brand bg-brand-soft',
          busy && 'opacity-60',
        )}
      >
        {src ? (
          <img src={src} alt="" className={cn('h-full w-full', fit === 'cover' ? 'object-cover' : 'object-contain p-2')} />
        ) : (
          <span className="flex flex-col items-center gap-1.5 px-3 text-center text-[12px] text-ink-faint">
            <ImagePlus size={26} strokeWidth={1.6} />
            {disabled ? 'No picture' : emptyText}
            {!disabled && <span className="text-[11px]">or drag &amp; drop</span>}
          </span>
        )}
        {busy && <span className="absolute inset-0 flex items-center justify-center bg-surface/60 text-[12px] font-medium text-ink">Uploading...</span>}
      </button>
      {!disabled && (
        <div className="flex gap-1.5">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[12px] font-medium text-ink hover:bg-surface-3">
            <Upload size={13} /> {src ? 'Change' : 'Upload'}
          </button>
          {src && onRemove && (
            <button type="button" disabled={busy} onClick={() => void onRemove()} className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[12px] font-medium text-danger hover:bg-danger-soft">
              <Trash2 size={13} /> Remove
            </button>
          )}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={accept.join(',')}
        hidden
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
