import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { toast } from '@/store/toast';

export function ProductPhoto({ productId, name = 'Product', editable = false, large = false }: { productId?: number; name?: string; editable?: boolean; large?: boolean }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const photo = useQuery({ queryKey: ['product-photo', productId], enabled: !!productId, staleTime: 300000, retry: 1,
    queryFn: async () => { const res = await api.get<Blob>('/products/' + productId + '/photo', { responseType: 'blob' }); return res.status === 204 ? null : res.data; },
  });
  useEffect(() => { if (!photo.data) { setUrl(''); return; } const objectUrl = URL.createObjectURL(photo.data); setUrl(objectUrl); return () => URL.revokeObjectURL(objectUrl); }, [photo.data]);
  const upload = async (chosen?: File) => {
    if (!chosen || !productId) return;
    if (chosen.size > 5 * 1024 * 1024) { toast.error('Choose an image smaller than 5 MB'); return; }
    setSaving(true);
    try { const body = new FormData(); body.append('file', chosen); await api.post('/products/' + productId + '/photo', body); await qc.invalidateQueries({ queryKey: ['product-photo', productId] }); toast.success('Product photo updated'); }
    catch (error) { toast.error(apiError(error)); }
    finally { setSaving(false); if (file.current) file.current.value = ''; }
  };
  return <div className={large ? 'flex items-center gap-4 py-2' : 'flex items-center justify-center'}>
    <div className={large ? 'flex h-36 w-52 shrink-0 items-center justify-center rounded border border-gray-200 bg-white' : 'flex h-12 w-16 items-center justify-center rounded border border-gray-200 bg-white'}>
      {url ? <img src={url} alt={name} className="h-full w-full rounded object-contain" /> : <ImageIcon size={large ? 32 : 18} className="text-gray-400" aria-label={photo.isError ? 'Photo unavailable' : 'No product photo'} />}
    </div>
    {large && <div className="text-sm"><p>Product photo</p><p className="mb-2 text-xs opacity-60">Included in invoice PDFs and prints.</p>
      {editable && <><input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => void upload(e.target.files?.[0])} /><button type="button" className="rounded border border-gray-300 px-3 py-1 text-xs disabled:opacity-50" disabled={saving || !productId} onClick={() => file.current?.click()}>{saving ? 'Uploading...' : 'Choose / replace photo'}</button><p className="mt-1 text-xs opacity-60">{productId ? 'JPEG, PNG or WebP, up to 5 MB. Saved immediately.' : 'Save the product first to add its photo.'}</p></>}
      {photo.isError && <button type="button" onClick={() => void photo.refetch()} className="text-xs underline">Retry photo</button>}
    </div>}
  </div>;
}
