import { FinanceLedger } from '@/components/admin/FinanceLedger';

/** Money arriving from clients. See components/admin/FinanceLedger.tsx. */
export default function AdminFinanceInflows() {
  return <div className="p-6 sm:p-8"><FinanceLedger direction="in" /></div>;
}
