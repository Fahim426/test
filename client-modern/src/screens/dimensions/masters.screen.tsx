import { Building2, Briefcase, Store, FolderTree, Tag, Layers, Shapes, Ruler, MapPin, UserCheck, Globe2, CalendarClock, Coins, Percent } from 'lucide-react';
import type { ScreenDef } from '@/screens/types';
import { MasterConfig, MasterField, masterScreen } from '@/components/MasterDataScreen';

const code: MasterField = { key: 'code', label: 'Code', required: true, maxLength: 40, readOnlyOnEdit: true, listWidth: 110 };
const name: MasterField = { key: 'name', label: 'Name', required: true, maxLength: 200 };
const active: MasterField = { key: 'isActive', label: 'Active', type: 'checkbox', listWidth: 80 };

const simple = (tableKey: string, title: string, url: string, extra: MasterField[] = []): MasterConfig => ({
  tableKey,
  title,
  url,
  permission: 'dimensions',
  modalWidth: 'sm',
  fields: [code, name, ...extra, active],
});

const vatCategories = [
  { value: 'TAXABLE', label: 'Taxable' },
  { value: 'ZERO_RATED', label: 'Zero Rated' },
  { value: 'EXEMPT', label: 'Exempt' },
  { value: 'OUT_OF_SCOPE', label: 'Out of Scope' },
];

const company: MasterConfig = {
  tableKey: 'company',
  title: 'Company',
  url: '/company',
  permission: 'dimensions',
  fields: [
    code,
    name,
    { key: 'arabicName', label: 'Arabic Name' },
    { key: 'trn', label: 'TRN', maxLength: 40 },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'country', label: 'Country' },
    { key: 'baseCurrency', label: 'Base Currency', placeholder: 'AED', maxLength: 10 },
    { key: 'address', label: 'Address', type: 'textarea', span: 2 },
    active,
  ],
};

const branch = simple('branches', 'Branch', '/branches', [{ key: 'address', label: 'Address', span: 2 }]);

const categories: MasterConfig = simple('categories', 'Category', '/categories', [
  { key: 'parentId', label: 'Parent Category', type: 'select', optionsUrl: '/categories', listKey: 'parent.name', hint: 'Leave empty for a top-level category' },
]);

const brands = simple('brands', 'Brand', '/brands', [{ key: 'country', label: 'Country' }]);

const salesmen = simple('salesmen', 'Salesman', '/salesmen', [
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'commissionPct', label: 'Commission %', type: 'number', min: 0, max: 100, listType: 'percent', default: 0 },
]);

const paymentTerms = simple('payment-terms', 'Payment Term', '/payment-terms', [
  { key: 'days', label: 'Days', type: 'number', min: 0, default: 0, required: true },
]);

const currencies: MasterConfig = {
  tableKey: 'currencies',
  title: 'Currency',
  url: '/currencies',
  permission: 'dimensions',
  modalWidth: 'sm',
  fields: [
    code,
    name,
    { key: 'symbol', label: 'Symbol' },
    { key: 'rate', label: 'Rate (to base)', type: 'number', required: true, min: 0, step: 'any', default: 1, listType: 'number' },
    { key: 'isBase', label: 'Base currency', type: 'checkbox' },
    active,
  ],
};

const vatCodes: MasterConfig = {
  tableKey: 'vat-codes',
  title: 'VAT Code',
  url: '/vat-codes',
  permission: 'dimensions',
  modalWidth: 'sm',
  fields: [
    code,
    name,
    { key: 'rate', label: 'Rate %', type: 'number', required: true, min: 0, max: 100, default: 5, listType: 'percent' },
    { key: 'category', label: 'Category', type: 'select', options: vatCategories, valueType: 'string', required: true, default: 'TAXABLE' },
    { key: 'isDefault', label: 'Default', type: 'checkbox' },
    active,
  ],
};

export default [
  { id: 'companies', title: 'Companies', icon: Building2, component: masterScreen(company), permission: 'dimensions' },
  { id: 'business-units', title: 'Business Units', icon: Briefcase, component: masterScreen(simple('business-units', 'Business Unit', '/business-units')), permission: 'dimensions' },
  { id: 'branches', title: 'Branches', icon: Store, component: masterScreen(branch), permission: 'dimensions' },
  { id: 'categories', title: 'Categories', icon: FolderTree, component: masterScreen(categories), permission: 'dimensions' },
  { id: 'brands', title: 'Brands', icon: Tag, component: masterScreen(brands), permission: 'dimensions' },
  { id: 'product-groups', title: 'Product Groups', icon: Layers, component: masterScreen(simple('product-groups', 'Product Group', '/product-groups')), permission: 'dimensions' },
  { id: 'product-types', title: 'Product Types', icon: Shapes, component: masterScreen(simple('product-types', 'Product Type', '/product-types')), permission: 'dimensions' },
  { id: 'units', title: 'Units', icon: Ruler, component: masterScreen(simple('units', 'Unit', '/units')), permission: 'dimensions' },
  { id: 'areas', title: 'Areas', icon: MapPin, component: masterScreen(simple('areas', 'Area', '/areas')), permission: 'dimensions' },
  { id: 'salesmen', title: 'Salesmen', icon: UserCheck, component: masterScreen(salesmen), permission: 'dimensions' },
  { id: 'territories', title: 'Territories', icon: Globe2, component: masterScreen(simple('territories', 'Territory', '/territories')), permission: 'dimensions' },
  { id: 'payment-terms', title: 'Payment Terms', icon: CalendarClock, component: masterScreen(paymentTerms), permission: 'dimensions' },
  { id: 'currencies', title: 'Currencies', icon: Coins, component: masterScreen(currencies), permission: 'dimensions' },
  { id: 'vat-codes', title: 'VAT Codes', icon: Percent, component: masterScreen(vatCodes), permission: 'dimensions' },
] satisfies ScreenDef[];
