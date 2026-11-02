import { cn } from '@/lib/utils';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// What someone IS, beside their name.
//
// Favour, 2 Nov 2026: "roles clearly stated next to names, users, accounts,
// projects." Admin listed people by name and email and, outside the Users and Team
// pages, said nothing about which actor they were. On the Projects list that cost a
// real misdiagnosis: an August client account that had since been given the
// contractor role was read as two accounts for the same person.
//
// ── Why a person can show more than one badge ───────────────────────────────────────
// Because a person can genuinely hold more than one role. Groundwork lets a client
// become a contractor on the same account — that is the design, and Philip asked for
// it explicitly. Hiding the second role is what made it look like a bug. So every
// role is drawn, in a fixed order, and "Client" is shown for somebody who holds no
// role row at all rather than left blank.
//
// Order is deliberate: the most privileged first, so a scan down a column lands on
// Admin and Verifier before anything else.
// =========================================================

const ORDER = ['admin', 'verifier', 'contractor'] as const;
type Known = typeof ORDER[number];

const LABEL: Record<Known | 'client', TKey> = {
  admin:      'adminRole.admin',
  verifier:   'adminRole.verifier',
  contractor: 'adminRole.contractor',
  client:     'adminRole.client',
};

/** Each actor reads at a glance without colour alone carrying the meaning. */
const TONE: Record<Known | 'client', string> = {
  admin:      'border-state-alert/40 text-state-alert',
  verifier:   'border-state-held/40 text-state-held',
  contractor: 'border-state-complete/40 text-state-complete',
  client:     'border-brand-border-grey text-brand-mid-grey dark:border-[#2c2c2c]',
};

/** Parse the comma-joined `user_roles` string the admin reads carry. */
export function rolesOf(roles: string | null | undefined): (Known | 'client')[] {
  const held = (roles ?? '').split(',').map(r => r.trim()).filter(Boolean);
  const known = ORDER.filter(r => held.includes(r));
  // No role row means a plain client. Saying so beats an empty cell, which reads as
  // missing data rather than as an answer.
  return known.length > 0 ? known : ['client'];
}

export function RoleBadge({ roles, className }: { roles: string | null | undefined; className?: string }) {
  const t = useT();
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {rolesOf(roles).map(role => (
        <span
          key={role}
          className={cn(
            'inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5',
            'text-[10px] font-semibold uppercase tracking-wide',
            TONE[role],
          )}
        >
          {t(LABEL[role])}
        </span>
      ))}
    </span>
  );
}
