import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, Download } from 'lucide-react';
import { getCertificate } from '@/lib/supabase/certificates';
import { useT } from '@/lib/i18n';

interface CertRow {
  id: string;
  project_id: string;
  stage_id: string;
  stage_number: number;
  issued_at: string;
  issued_to: string;
  project_name: string;
  stage_name: string;
  pdf_url: string | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

export default function VerifyCertificate() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const [cert, setCert]     = useState<CertRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) { setNotFound(true); setLoading(false); return; }
    getCertificate(id)
      .then(data => {
        if (!data) { setNotFound(true); } else { setCert(data as CertRow); }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    // Navbar and footer come from routes/_public-layout.tsx. The authenticity
    // note below is page content, not chrome — it is about this certificate.
    <div className="flex flex-col bg-brand-off-white">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        {loading ? (
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-border-grey border-t-brand-near-black" />
        ) : notFound ? (
          <NotFound />
        ) : cert ? (
          <CertificateCard cert={cert} />
        ) : null}

        {cert && (
          <p className="mt-8 max-w-md text-center text-xs text-brand-mid-grey">
            {t('verify.issuedBy')}{' '}
            <span className="font-medium text-brand-near-black">tryjalla.com/verify/{id}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function NotFound() {
  const t = useT();
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center gap-4 text-center max-w-sm"
    >
      <XCircle className="size-14 text-brand-border-grey" strokeWidth={1.2} />
      <div>
        <h1 className="text-xl font-bold text-brand-near-black">{t('verify.notFoundTitle')}</h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          {t('verify.notFoundBody')}
        </p>
      </div>
      <Link
        to="/"
        className="mt-2 text-sm font-medium text-brand-near-black underline underline-offset-4 hover:opacity-70 transition-opacity"
      >
        {t('verify.returnHome')}
      </Link>
    </motion.div>
  );
}

function CertificateCard({ cert }: { cert: CertRow }) {
  const t = useT();
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-lg"
    >
      {/* Verified badge */}
      <div className="flex items-center gap-3 mb-6">
        <CheckCircle2 className="size-10 text-brand-near-black shrink-0" strokeWidth={1.5} />
        <div>
          <p className="text-xs font-semibold text-brand-mid-grey uppercase tracking-wider">{t('verify.verified')}</p>
          <h1 className="text-xl font-bold text-brand-near-black leading-tight">
            {t('verify.certTitle')}
          </h1>
        </div>
      </div>

      {/* Certificate card */}
      <div className="rounded-2xl border border-brand-border-grey bg-white overflow-hidden">
        {/* Header band */}
        <div className="bg-brand-near-black px-6 py-4">
          <p className="text-xs font-semibold text-white/60 uppercase tracking-wider">
            {t('verify.recordBanner')}
          </p>
        </div>

        {/* Details */}
        <div className="px-6 py-6 space-y-5">
          <Field label={t('certificate.fieldOwner')} value={cert.issued_to} />
          <Field label={t('certificate.fieldProject')} value={cert.project_name} />
          <Field label={t('verify.stageCompleted')} value={`${t('project.stages.stageN', { n: cert.stage_number })}: ${cert.stage_name}`} />
          <Field label={t('verify.dateIssued')} value={formatDate(cert.issued_at)} />
          <Field label={t('verify.certId')} value={cert.id} mono />
        </div>

        {/* Download */}
        {cert.pdf_url && (
          <div className="px-6 pb-6">
            <a
              href={cert.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="flex items-center justify-center gap-2 w-full rounded-xl bg-brand-near-black text-white text-sm font-semibold py-3 hover:bg-black transition-colors"
            >
              <Download className="size-4" />
              {t('verify.downloadPdf')}
            </a>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-brand-mid-grey">
        {t('verify.permanentNote')}
      </p>
    </motion.div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-brand-mid-grey uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-sm text-brand-near-black ${mono ? 'font-mono text-xs break-all' : 'font-medium'}`}>
        {value}
      </p>
    </div>
  );
}
