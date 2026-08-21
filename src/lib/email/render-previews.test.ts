import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildContractorApplicationHtml, contractorApplicationSubject } from './contractor-application-html';
import { buildApplicationDecisionHtml, applicationDecisionSubject } from './application-decision-html';
import { buildInviteHtml, inviteSubject } from './invite-html';
import { buildStageApprovedHtml, stageApprovedSubject } from './stage-approved-html';
import { buildReworkHtml, reworkSubject } from './rework-requested-html';
import { buildWaitlistWelcomeHtml, waitlistWelcomeSubject } from './waitlist-welcome-html';
import { internalHtml } from '../../../api/contractor-application-notify';
import { translate } from '../i18n/translate';
import { en } from '../i18n/en';
import { siteUrl } from '../site-url';
import type { Lang } from '../i18n/types';
import type { ContractorApplicationInput } from '../contractor/application-types';

/**
 * Renders every outbound template to disk so the email audit page can embed what the
 * recipient actually sees rather than a description of it.
 *
 * A test rather than a script because vitest is the only TypeScript runner this repo
 * has — no tsx, no ts-node — and because being a test is the useful part: if a builder
 * gains a required argument or an i18n key disappears, this fails on the next `pnpm
 * test` instead of the audit page quietly going stale and misinforming whoever is
 * reviewing the copy.
 *
 * Output is gitignored build output, not source. Regenerate with `pnpm test`.
 */

const OUT = resolve(__dirname, '../../../.email-previews');
const LANGS: Lang[] = ['en', 'fr'];

/** Plausible rather than minimal — empty strings hide layout problems reviewers need to see. */
const APPLICATION: ContractorApplicationInput = {
  fullName: 'Ngo Bala Etienne',
  businessName: 'Etienne Construction Sarl',
  phone: '+237 6 55 12 34 78',
  email: 'etienne@example.cm',
  country: 'CM',
  city: 'Douala',
  portfolioUrl: 'https://example.cm/etienne',
  role: 'general_contractor',
  roleOther: '',
  yearsExperience: 'y5_10',
  operatesAs: 'registered',
  teamSize: '12',
  projectTypes: ['residential', 'renovations'],
  credentials: {
    avgProject: '20,000–50,000',
    diaspora: true,
    paymentStructure: '30% mobilisation, then milestone payments on inspection.',
  },
  uploads: [
    { label: 'Business registration', path: 'demo/registration.pdf', size: 482_113 },
    { label: 'Tax clearance', path: 'demo/tax.pdf', size: 210_004 },
  ],
  projects: [
    { name: 'Villa Bonapriso', location: 'Douala', budget: '45,000,000 XAF', role: 'Main contractor', year: '2024', refName: 'Mme Awono', refPhone: '+237 6 99 00 11 22', refEmail: 'awono@example.cm' },
    { name: 'Duplex Bonamoussadi', location: 'Douala', budget: '62,000,000 XAF', role: 'Main contractor', year: '2023', refName: 'M. Tchoua', refPhone: '+237 6 77 44 55 66', refEmail: 'tchoua@example.cm' },
    { name: 'Immeuble Akwa', location: 'Douala', budget: '120,000,000 XAF', role: 'Site supervision', year: '2022', refName: 'Mme Fotso', refPhone: '+237 6 88 33 22 11', refEmail: 'fotso@example.cm' },
  ],
  acceptsMilestones: true,
  acceptsVerification: true,
  acceptsNoSidePay: true,
  videoUrl: 'https://example.cm/etienne/intro',
  whyJoin: 'I want to work with diaspora clients who expect documented progress.',
  differentiator: 'Fixed-price milestones and weekly photographic reporting.',
  readyForEarly: true,
  regions: 'Littoral, Centre',
  concurrentProjects: 'two_three',
  agreedToTerms: true,
  lang: 'en',
};

/**
 * Production never passes a raw stage name to these two builders — approvals.ts runs it
 * through localizeStage() first, so a French owner reads "Fondations". Rendering the
 * fixture with an English name would show a reviewer a bug that does not exist.
 */
const stage = (lang: Lang, key: 'foundation' | 'structureWalls') =>
  translate(lang, `stages.${key}` as never);

/** e.g. /\b(email|contractorApply|stages|...)\.[A-Za-z]/ — an unresolved dictionary path. */
const RAW_KEY = new RegExp(`\\b(${Object.keys(en).join('|')})\\.[A-Za-z]`);

interface Preview {
  id: string;
  subject: (lang: Lang) => string;
  html: (lang: Lang) => string;
}

const PREVIEWS: Preview[] = [
  {
    id: 'contractor-application',
    subject: l => contractorApplicationSubject(l),
    html: l => buildContractorApplicationHtml(l, { ...APPLICATION, lang: l }),
  },
  {
    id: 'decision-accepted',
    subject: l => applicationDecisionSubject(l, 'accepted'),
    html: l => buildApplicationDecisionHtml(l, 'accepted', 'Ngo Bala Etienne', siteUrl()),
  },
  {
    id: 'decision-rejected',
    subject: l => applicationDecisionSubject(l, 'rejected'),
    html: l => buildApplicationDecisionHtml(l, 'rejected', 'Ngo Bala Etienne', siteUrl()),
  },
  {
    id: 'project-invite',
    subject: l => inviteSubject(l, 'Marie Ateba'),
    html: l => buildInviteHtml(l, 'Marie Ateba', 'Douala Family House', '00000000-0000-4000-8000-000000000000'),
  },
  {
    id: 'stage-approved',
    subject: l => stageApprovedSubject(l, stage(l, 'foundation')),
    html: l => buildStageApprovedHtml(l, {
      ownerName: 'Marie Ateba',
      projectName: 'Douala Family House',
      stageName: stage(l, 'foundation'),
      nextStageName: stage(l, 'structureWalls'),
      projectId: '00000000-0000-4000-8000-000000000001',
      certificateId: '00000000-0000-4000-8000-000000000002',
    }),
  },
  {
    id: 'rework-requested',
    subject: l => reworkSubject(l, stage(l, 'foundation')),
    html: l => buildReworkHtml(l, {
      ownerName: 'Marie Ateba',
      projectName: 'Douala Family House',
      stageName: stage(l, 'foundation'),
      reworkNote: 'The rebar spacing in the eastern footing does not match the approved drawing.',
      flaggedCount: 2,
      projectId: '00000000-0000-4000-8000-000000000001',
    }),
  },
  {
    // Internal only, and hardcoded English by design — rendered in both slots so the
    // audit page can show that the FR column is intentionally identical, not missing.
    id: 'team-alert',
    subject: () => 'New contractor application — Ngo Bala Etienne',
    html: () => internalHtml({
      full_name: APPLICATION.fullName,
      business_name: APPLICATION.businessName,
      email: APPLICATION.email,
      phone: APPLICATION.phone,
      country: APPLICATION.country,
      city: APPLICATION.city,
      role: APPLICATION.role,
      years_experience: APPLICATION.yearsExperience,
      operates_as: APPLICATION.operatesAs,
      regions: APPLICATION.regions,
      projects: APPLICATION.projects,
      uploads: APPLICATION.uploads,
      status: 'pending',
      id: '00000000-0000-4000-8000-000000000003',
    }, siteUrl()),
  },
  {
    id: 'waitlist-welcome',
    subject: l => waitlistWelcomeSubject(l),
    html: l => buildWaitlistWelcomeHtml(l, 'Marie Ateba'),
  },
];

describe('email previews', () => {
  it('renders every template in both languages', () => {
    mkdirSync(OUT, { recursive: true });
    const index: Record<string, { subject: string; file: string }> = {};

    for (const p of PREVIEWS) {
      for (const lang of LANGS) {
        const html = p.html(lang);
        const subject = p.subject(lang);

        // A missing i18n key renders as its own dotted path rather than throwing, so it
        // reaches the reader looking like copy. Built from the dictionary's real top-level
        // names so it catches every namespace — the first draft only checked `email.` and
        // let `contractorApply.form.projectType.renovation` through into a preview.
        expect(html, `${p.id}.${lang} body`).not.toMatch(RAW_KEY);
        expect(subject, `${p.id}.${lang} subject`).not.toMatch(RAW_KEY);
        expect(subject.length, `${p.id}.${lang} subject`).toBeGreaterThan(5);
        expect(html).toContain('<html');

        const file = `${p.id}.${lang}.html`;
        writeFileSync(join(OUT, file), html, 'utf8');
        index[`${p.id}.${lang}`] = { subject, file };
      }
    }

    writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
    expect(Object.keys(index)).toHaveLength(PREVIEWS.length * LANGS.length);
  });
});
