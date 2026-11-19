import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/store/auth';
import { api } from '@/lib/api';
export interface Features {
  partNumbers: boolean;
  vehicleCompatibility: boolean;
  amc: boolean;
  hr: boolean;
  serialTracking: boolean;
  assistant: boolean;
  productImages: boolean;
}
export interface ProductConfig {
  company: {
    id: number;
    name: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    trn?: string | null;
    country?: string | null;
    baseCurrency?: string;
  } | null;
  features: Features;
  appName: string;
  productLabel: string;
  compatibilityLabel: string;
  industry: 'equipment' | 'spare-parts' | 'general';
  logoDataUri: string | null;
}
export const featureOptions: { key: keyof Features; label: string; hint: string }[] = [
  { key: 'partNumbers', label: 'Part numbers', hint: 'Manufacturer, alternate and interchange numbers.' },
  { key: 'vehicleCompatibility', label: 'Compatibility', hint: 'Compatibility fields and the compatibility screen.' },
  { key: 'amc', label: 'AMC and service', hint: 'Maintenance contracts, visits and renewals.' },
  { key: 'hr', label: 'HR', hint: 'Employees, attendance, leave and payroll.' },
  { key: 'serialTracking', label: 'Machine serial tracking', hint: 'Individual equipment records and customer links.' },
  { key: 'assistant', label: 'Chat assistant', hint: 'Read-only company data questions.' },
  { key: 'productImages', label: 'Product images', hint: 'Photo selection, display and images on new documents.' },
];
const disabled: Features = {
  partNumbers: false,
  vehicleCompatibility: false,
  amc: false,
  hr: false,
  serialTracking: false,
  assistant: false,
  productImages: false,
};
const fallback: ProductConfig = {
  company: null,
  features: disabled,
  appName: import.meta.env.VITE_APP_NAME || 'Business ERP',
  productLabel: 'Product',
  compatibilityLabel: 'Equipment Compatibility',
  industry: 'general',
  logoDataUri: import.meta.env.VITE_LOGO_URL || null,
};
function cachedBrand(): ProductConfig {
  try {
    const c = JSON.parse(localStorage.getItem('erp-public-brand') || 'null');
    if (c && typeof c.appName === 'string')
      return {
        ...fallback,
        appName: c.appName,
        company: { id: 0, name: String(c.companyName || '') },
        logoDataUri: typeof c.logoDataUri === 'string' ? c.logoDataUri : null,
      };
  } catch {}
  return {
    ...fallback,
    company: import.meta.env.VITE_COMPANY_NAME ? { id: 0, name: import.meta.env.VITE_COMPANY_NAME } : null,
  };
}
export function useProductConfig() {
  const token = useAuth((s) => s.accessToken);
  const q = useQuery({
    queryKey: ['product-config'],
    enabled: !!token,
    staleTime: 15000,
    refetchInterval: 30000,
    retry: 1,
    queryFn: async () => {
      const c = (await api.get<ProductConfig>('/product-config')).data;
      try {
        localStorage.setItem(
          'erp-public-brand',
          JSON.stringify({ appName: c.appName, companyName: c.company?.name, logoDataUri: c.logoDataUri }),
        );
      } catch {}
      return c;
    },
  });
  useEffect(() => {
    if (q.data)
      try {
        localStorage.setItem(
          'erp-public-brand',
          JSON.stringify({
            appName: q.data.appName,
            companyName: q.data.company?.name,
            logoDataUri: q.data.logoDataUri,
          }),
        );
      } catch {}
  }, [q.data]);
  return { ...q, config: q.data ?? cachedBrand() };
}
export function useFeatures() {
  return useProductConfig().config.features;
}
export function screenEnabled(id: string, f: Features) {
  if (id.startsWith('amc')) return f.amc;
  if (id.startsWith('hr-')) return f.hr;
  if (id === 'equipment-register') return f.serialTracking;
  if (id === 'vehicle-compatibility') return f.vehicleCompatibility;
  if (id === 'part-lookup') return f.partNumbers;
  return true;
}
export function moduleEnabled(key: string, f: Features) {
  return key === 'amc' ? f.amc : key === 'hr' ? f.hr : true;
}
