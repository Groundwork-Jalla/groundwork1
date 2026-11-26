import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPartnerApplicationRow,
  type PartnerAnswers,
  type PartnerPrefill,
} from './partner-application';

const ROOT = resolve(__dirname, '..', '..', '..');
const migration = readFileSync(
  join(ROOT, 'supabase/migrations/20261127000000_drop_legacy_one_per_account_application_index.sql'),
  'utf8',
);
const page = readFileSync(join(ROOT, 'src/app/routes/work/partner.tsx'), 'utf8');

const PREFILL: PartnerPrefill = {
  fullName: 'Lionel FOKA',
  email: 'lionel@example.com',
  phone: '+237600000000',
  country: 'CM',
  businessName: 'Foka BTP',
  specialty: 'general_contractor',
  specialtyOther: null,
};

const BASE_ANSWERS: PartnerAnswers = {
  languages: ['fr'],
  diasporaHistory: '',
  hasCurrentProject: true,
  whyJoin: 'Build transparently',
  differentiator: 'On-time delivery',
  regions: 'Douala, Yaounde',
  concurrentProjects: '2',
  yearsExperience: '5-10',
  role: 'general_contractor',
  operatesAs: 'company',
  city: '',
  projectStatus: 'running',
  projectStage: 'half_way',
  projectStartWindow: '',
  clientOnSiteDaily: false,
  clientOffsiteReason: 'different_country',
  clientOffsiteReasonOther: '',
  willUseGroundwork: 'yes',
  disqualifiedReason: null,
};

describe('reapplying after disqualification or rejection', () => {
  it('drops the legacy one_per_account unique index while keeping one_open_per_user', () => {
    const sql = migration.replace(/--.*$/gm, '');
    expect(sql).toMatch(/DROP INDEX IF EXISTS public\.contractor_applications_one_per_account;/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS contractor_applications_one_open_per_user/);
    expect(sql).toMatch(/WHERE user_id IS NOT NULL AND status IN \('pending', 'reviewing', 'accepted'\);/);
  });

  it('only transitions to ApplicationFiled on 23505 when the existing row is live', () => {
    expect(page).toContain('function isLiveApplicationState(s: ApplicationState): boolean');
    expect(page).toContain('if (again && isLiveApplicationState(again.state))');
    expect(page).not.toContain("if (again && again.state !== 'none')");
  });
});

describe('buildPartnerApplicationRow satisfies migration 152 CHECK constraints', () => {
  it('clears offsite reason when stopping on client_on_site_daily = true', () => {
    const row = buildPartnerApplicationRow('user-1', PREFILL, {
      ...BASE_ANSWERS,
      clientOnSiteDaily: true,
      clientOffsiteReason: 'other',
      clientOffsiteReasonOther: 'Lives in Paris',
      disqualifiedReason: 'client_on_site_daily',
    });

    expect(row.status).toBe('disqualified');
    expect(row.disqualified_reason).toBe('client_on_site_daily');
    expect(row.client_on_site_daily).toBe(true);
    expect(row.client_offsite_reason).toBeNull();
    expect(row.client_offsite_reason_other).toBeNull();
  });

  it('clears project_stage and project_start_window when projectStatus is none', () => {
    const row = buildPartnerApplicationRow('user-1', PREFILL, {
      ...BASE_ANSWERS,
      hasCurrentProject: false,
      projectStatus: 'none',
      projectStage: 'half_way',
      projectStartWindow: 'under_month',
      disqualifiedReason: 'no_project',
    });

    expect(row.status).toBe('disqualified');
    expect(row.project_status).toBe('none');
    expect(row.project_stage).toBeNull();
    expect(row.project_start_window).toBeNull();
  });

  it('keeps only the sub-answer that matches projectStatus', () => {
    const running = buildPartnerApplicationRow('user-1', PREFILL, {
      ...BASE_ANSWERS,
      projectStatus: 'running',
      projectStage: 'just_started',
      projectStartWindow: '1_3_months',
    });
    expect(running.project_stage).toBe('just_started');
    expect(running.project_start_window).toBeNull();

    const starting = buildPartnerApplicationRow('user-1', PREFILL, {
      ...BASE_ANSWERS,
      projectStatus: 'starting',
      projectStage: 'just_started',
      projectStartWindow: '1_3_months',
    });
    expect(starting.project_stage).toBeNull();
    expect(starting.project_start_window).toBe('1_3_months');
  });

  it('keeps client_offsite_reason_other only when offsite reason is other', () => {
    const named = buildPartnerApplicationRow('user-1', PREFILL, {
      ...BASE_ANSWERS,
      clientOnSiteDaily: false,
      clientOffsiteReason: 'other',
      clientOffsiteReasonOther: 'Travels every week',
    });
    expect(named.client_offsite_reason).toBe('other');
    expect(named.client_offsite_reason_other).toBe('Travels every week');

    const nonOther = buildPartnerApplicationRow('user-1', PREFILL, {
      ...BASE_ANSWERS,
      clientOnSiteDaily: false,
      clientOffsiteReason: 'different_country',
      clientOffsiteReasonOther: 'Stale free text',
    });
    expect(nonOther.client_offsite_reason).toBe('different_country');
    expect(nonOther.client_offsite_reason_other).toBeNull();
  });
});
