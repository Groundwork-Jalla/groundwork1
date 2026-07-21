import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Printer } from 'lucide-react';

// ── Props ─────────────────────────────────────────────────

export interface StageCertificateModalProps {
  stage: {
    stage_number: number;
    name: string;
    completed_at: string | null;
    budget_pct: number | null;
    payment_milestone_usd: number | null;
  };
  project: {
    name: string;
    country: string;
    city: string | null;
    tier: string;
  };
  ownerName: string;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────

function tierLabel(tier: string): string {
  if (tier === 'self_verify' || tier === 'starter') return 'Self-Verified (Owner)';
  if (tier === 'jalla_verify') return 'Jalla Verified ✓';
  if (tier === 'jalla_management') return 'Jalla Management ✓';
  return tier;
}

// ── Component ─────────────────────────────────────────────

export function StageCertificateModal({
  stage,
  project,
  ownerName,
  onClose,
}: StageCertificateModalProps) {
  const completedDate = stage.completed_at
    ? new Date(stage.completed_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

  const locationStr = [project.city, project.country].filter(Boolean).join(', ');
  const progressPct = Math.min((stage.stage_number / 10) * 100, 100);

  const milestoneStr =
    stage.payment_milestone_usd != null
      ? `$${stage.payment_milestone_usd.toLocaleString()}`
      : '—';

  const details: Array<[string, string]> = [
    ['Project', project.name],
    ['Location', locationStr || project.country],
    ['Owner', ownerName],
    ['Completed', completedDate],
    ['Milestone', milestoneStr],
    ['Verified by', tierLabel(project.tier)],
  ];

  // Inject print styles that isolate only the certificate
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'gw-cert-print';
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        .gw-certificate,
        .gw-certificate * { visibility: visible !important; }
        .gw-certificate {
          position: fixed !important;
          inset: 0 !important;
          padding: 48px !important;
          background: white !important;
          box-sizing: border-box !important;
        }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.getElementById('gw-cert-print')?.remove();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="relative w-full max-w-lg bg-white dark:bg-[#1c1c1c] rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border-grey dark:border-[#2c2c2c]">
          <p className="text-sm font-semibold text-brand-near-black dark:text-white">
            Stage Certificate
          </p>
          <button
            type="button"
            onClick={onClose}
            className="text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Certificate preview */}
        <div className="p-5 overflow-y-auto max-h-[68vh]">
          <div
            className="gw-certificate"
            style={{
              border: '1px solid #e0e0e0',
              borderRadius: '10px',
              padding: '32px',
              background: 'white',
              minHeight: '400px',
            }}
          >
            {/* Brand header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '28px',
              }}
            >
              <div>
                <p
                  style={{
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    fontSize: '20px',
                    fontWeight: '800',
                    letterSpacing: '-0.5px',
                    margin: 0,
                    color: '#0d0d0d',
                  }}
                >
                  Groundwork
                </p>
                <p
                  style={{
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    fontSize: '10px',
                    color: '#999',
                    margin: '3px 0 0',
                    letterSpacing: '0.4px',
                  }}
                >
                  by Jalla
                </p>
              </div>
              <p
                style={{
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  fontSize: '9px',
                  color: '#bbb',
                  margin: 0,
                  letterSpacing: '1.5px',
                  textTransform: 'uppercase',
                }}
              >
                Verified Completion
              </p>
            </div>

            {/* Certificate title */}
            <div style={{ textAlign: 'center', marginBottom: '28px' }}>
              <p
                style={{
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  fontSize: '10px',
                  letterSpacing: '3px',
                  textTransform: 'uppercase',
                  color: '#999',
                  margin: '0 0 8px',
                }}
              >
                Stage Completion Certificate
              </p>
              <p
                style={{
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: '20px',
                  fontWeight: '700',
                  margin: 0,
                  color: '#0d0d0d',
                  lineHeight: 1.3,
                }}
              >
                Stage {stage.stage_number}: {stage.name}
              </p>
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid #e8e8e8', marginBottom: '20px' }} />

            {/* Detail rows */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '110px 1fr',
                gap: '10px 16px',
                marginBottom: '24px',
              }}
            >
              {details.map(([label, value]) => (
                <div key={label} style={{ display: 'contents' }}>
                  <p
                    style={{
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      fontSize: '11px',
                      color: '#999',
                      margin: 0,
                      fontWeight: '500',
                    }}
                  >
                    {label}
                  </p>
                  <p
                    style={{
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      fontSize: '11px',
                      color: '#0d0d0d',
                      margin: 0,
                      fontWeight: '600',
                    }}
                  >
                    {value}
                  </p>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div style={{ marginBottom: '24px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                }}
              >
                <p
                  style={{
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    fontSize: '10px',
                    color: '#999',
                    margin: 0,
                  }}
                >
                  Project progress
                </p>
                <p
                  style={{
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    fontSize: '10px',
                    color: '#0d0d0d',
                    margin: 0,
                    fontWeight: '600',
                  }}
                >
                  Stage {stage.stage_number} of 10
                </p>
              </div>
              <div
                style={{
                  height: '6px',
                  background: '#f0f0f0',
                  borderRadius: '999px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${progressPct}%`,
                    background: '#0d0d0d',
                    borderRadius: '999px',
                  }}
                />
              </div>
            </div>

            {/* Body text */}
            <p
              style={{
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: '11px',
                color: '#666',
                lineHeight: '1.7',
                margin: '0 0 24px',
                textAlign: 'center',
              }}
            >
              This certificate confirms that Stage {stage.stage_number} of the above project
              <br />
              was completed and approved on the Groundwork platform.
            </p>

            {/* Footer */}
            <div
              style={{
                borderTop: '1px solid #e8e8e8',
                paddingTop: '14px',
                textAlign: 'center',
              }}
            >
              <p
                style={{
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  fontSize: '9px',
                  color: '#bbb',
                  margin: 0,
                  letterSpacing: '0.5px',
                }}
              >
                Powered by Groundwork &middot; jalla.build
              </p>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 px-5 py-4 border-t border-brand-border-grey dark:border-[#2c2c2c]">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold py-2.5 hover:bg-black transition-colors"
          >
            <Printer className="size-4" />
            Print / Save PDF
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 rounded-xl border border-brand-border-grey text-sm font-medium text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}
