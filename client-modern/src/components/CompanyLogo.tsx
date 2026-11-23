import { useCompany } from '@/hooks/useCompany';
import { useProductConfig } from '@/hooks/useProductConfig';
export function CompanyLogo({ className = 'h-9 w-24' }: { className?: string }) {
  const { config } = useProductConfig();
  const company = useCompany();
  const logo = (company.data?.logo as string | undefined) || config.logoDataUri;
  return logo ? (
    <img
      src={logo}
      alt={config.company?.name || config.appName}
      className={className + ' shrink-0 rounded bg-white object-contain'}
    />
  ) : (
    <span
      className={
        className + ' inline-flex shrink-0 items-center justify-center rounded border border-current text-xs font-bold'
      }
    >
      ERP
    </span>
  );
}
