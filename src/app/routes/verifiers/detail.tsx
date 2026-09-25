import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { VerificationWorkspace } from '@/components/verifier/VerificationWorkspace';
import { useT } from '@/lib/i18n';

export default function VerificationDetail() {
  const { id = '' } = useParams();
  const t = useT();
  return <div className="space-y-5">
    <Link to="/verifiers" className="inline-flex items-center gap-2 text-xs text-brand-mid-grey"><ArrowLeft className="size-4" />{t('verifier.detail.back')}</Link>
    <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{t('verifier.dashboard.workspace')}</h1>
    <VerificationWorkspace key={id} verificationId={id} />
  </div>;
}
