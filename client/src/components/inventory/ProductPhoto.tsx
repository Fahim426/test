import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { toast } from '@/store/toast';

export async function uploadProductPhoto(productId: number, chosen: File) {
  const body = new FormData();
  body.append('file', chosen);
  await api.post('/products/' + productId + '/photo', body);
}

type Props = {
  productId?: number; name?: string; editable?: boolean; large?: boolean;
  selectedFile?: File | null; onSelectFile?: (file: File | null) => void; disabled?: boolean;
};

export function ProductPhoto({ productId, name = 'Product', editable = false, large = false, selectedFile, onSelectFile, disabled = false }: Props) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const uploading = useRef(false);
  const file = useRef<HTMLInputElement>(null);
  const photo = useQuery({ queryKey: ['product-photo', productId], enabled: !!productId, staleTime: 300000, retry: 1,
    queryFn: async () => { const res = await api.get<Blob>('/products/' + productId + '/photo', { responseType: 'blob' }); return res.status === 204 ? null : res.data; },
  });
  useEffect(() => {
    const blob = selectedFile ?? photo.data;
    if (!blob) { setUrl(''); return; }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile, photo.data]);
  const upload = async (chosen: File) => {
    if (!productId || uploading.current || disabled) return;
    uploading.current = true;
    setSaving(true);
    try {
      await uploadProductPhoto(productId, chosen);
      await qc.invalidateQueries({ queryKey: ['product-photo', productId] });
      onSelectFile?.(null);
      toast.success('Product photo updated');
    } catch (error) {
      toast.error('Photo upload failed: ' + apiError(error));
    } finally {
      uploading.current = false;
      setSaving(false);
    }
  };
  const choose = (chosen?: File) => {
    if (!chosen || disabled || uploading.current) return;
    if (chosen.size > 5 * 1024 * 1024) { toast.error('Choose an image smaller than 5 MB'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type)) { toast.error('Choose a JPEG, PNG or WebP image'); return; }
    if (!productId) onSelectFile?.(chosen);
    else { onSelectFile?.(chosen); void upload(chosen); }
  };
  return <div className={large ? 'flex items-center gap-4 py-2' : 'flex items-center justify-center'}>
    <div className={large ? 'flex h-36 w-52 shrink-0 items-center justify-center rounded border border-gray-200 bg-white' : 'flex h-12 w-16 items-center justify-center rounded border border-gray-200 bg-white'}>
      {url ? <img src={url} alt={name} className="h-full w-full rounded object-contain" /> : <ImageIcon size={large ? 32 : 18} className="text-gray-400" aria-label={photo.isError ? 'Photo unavailable' : 'No product photo'} />}
    </div>
    {large && <div className="text-sm"><p>Product photo</p><p className="mb-2 text-xs opacity-60">Included in invoice PDFs and prints.</p>
      {editable && <>
        <input ref={file} aria-label="Product photo file" type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={disabled || saving} onChange={e => { choose(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="rounded border border-gray-300 px-3 py-1 text-xs disabled:opacity-50" disabled={saving || disabled || (!productId && !onSelectFile)} onClick={() => file.current?.click()}>{saving ? 'Uploading...' : 'Choose / replace photo'}</button>
        {selectedFile && <>
          <p className="mt-1 max-w-xs break-all text-xs">Selected: {selectedFile.name}</p>
          <button type="button" className="mr-3 mt-1 text-xs underline" disabled={saving || disabled} onClick={() => onSelectFile?.(null)}>Remove selected photo</button>
          {productId && <button type="button" className="mt-1 text-xs underline" disabled={saving || disabled} onClick={() => void upload(selectedFile)}>Retry photo upload</button>}
        </>}
        <p className="mt-1 text-xs opacity-60">{productId ? 'JPEG, PNG or WebP, up to 5 MB. Saved immediately.' : 'JPEG, PNG or WebP, up to 5 MB. Uploaded when you save the product.'}</p>
      </>}
      {photo.isError && <button type="button" onClick={() => void photo.refetch()} className="text-xs underline">Retry photo</button>}
    </div>}
  </div>;
}
