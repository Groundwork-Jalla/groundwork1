import { FinanceLedger } from '@/components/admin/FinanceLedger';

/** Money leaving to contractors. See components/admin/FinanceLedger.tsx. */
export default function AdminFinanceDisbursements() {
  return <div className="p-6 sm:p-8"><FinanceLedger direction="out" /></div>;
}
