import { useProductConfig } from '@/hooks/useProductConfig';
import { cn } from '@/lib/cn';

type Row = Record<string, unknown>;

/** Item details shown beside every product in an item grid. */
export interface ProductInfo {
  stockNumber?: string | null;
  oemNumber?: string | null;
  altNo?: string | null;
  brandName?: string | null;
  vehicle?: string | null;
}

/** From a line: the product picked in the grid (pinfo), else the product the server attached (enrich -> product). */
export function productInfoOf(line: Row | undefined | null): ProductInfo {
  const l = line ?? {};
  const p = ((l.pinfo ?? l.product) as Row | undefined) ?? {};
  return {
    stockNumber: (p.stockNumber ?? l.stockNumber) as string | null | undefined,
    oemNumber: (p.oemNumber ?? l.oemNumber) as string | null | undefined,
    altNo: (p.altNo ?? l.altNo) as string | null | undefined,
    brandName: (p.brandName ?? p.brand ?? l.brandName) as string | null | undefined,
    vehicle: (p.vehicle ?? l.vehicle) as string | null | undefined,
  };
}

const COLS: { key: keyof ProductInfo; header: string; w: number }[] = [
  { key: 'stockNumber', header: 'Stock No', w: 90 },
  { key: 'oemNumber', header: 'Manufacturer Ref', w: 110 },
  { key: 'altNo', header: 'Alternate Ref', w: 130 },
  { key: 'brandName', header: 'Brand', w: 90 },
  { key: 'vehicle', header: 'Compatibility', w: 150 },
];
export function useProductInfoColumns() {
  const { config } = useProductConfig();
  return COLS.filter(c => (config.features.partNumbers || !['oemNumber', 'altNo'].includes(c.key)) && (config.features.vehicleCompatibility || c.key !== 'vehicle'))
    .map(c => c.key === 'vehicle' ? { ...c, header: config.compatibilityLabel } : c);
}

/** <th> cells for Stock No, OEM No, Alt No, Brand and Vehicle (place right after the Product column). */
export function ProductInfoHeads() {
  return (
    <>
      {useProductInfoColumns().map((c) => (
        <th key={c.key} className="grid-th whitespace-nowrap" style={{ minWidth: c.w }}>
          {c.header}
        </th>
      ))}
    </>
  );
}

/** matching <td> cells for one line (an item row with `product` / `pinfo`). */
export function ProductInfoCells({ line }: { line: Row }) {
  const info = productInfoOf(line);
  return (
    <>
      {useProductInfoColumns().map((c) => {
        const v = info[c.key];
        return (
          <td key={c.key} className={cn('grid-td', c.key === 'stockNumber' && 'font-medium')} style={{ maxWidth: c.w + 40 }} title={v ? String(v) : undefined}>
            <span className="block truncate">{v ?? ''}</span>
          </td>
        );
      })}
    </>
  );
}
