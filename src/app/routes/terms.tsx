import LegalPage from '@/components/legal/LegalPage';
import { TERMS } from '@/lib/legal/content';

export default function TermsPage() {
  return <LegalPage doc={TERMS} />;
}
