import { describe, expect, it } from 'vitest';
import { buildContractorPayload } from '../../../api/ghl/_contractor-payload';
import type { ContractorApplicationInput } from './application-types';

/**
 * The contact record GHL receives is the whole point of the integration — "manage almost
 * everything in GoHighLevel" fails the moment someone has to open the admin console to
 * answer a question about an applicant. Until now none of its 60-odd fields had a test.
 *
 * The case that prompted this: an applicant sent **eight** documents. The numbered fields
 * stopped at six, while the sync uploads every file to GHL's media storage — so two real
 * documents sat in storage with nothing on the contact pointing at them. Invisible, because
 * a missing custom field looks exactly like a field nobody filled in.
 *
 * The upload input is `multiple` with no limit, so raising the cap is not a fix, only a
 * bigger number. What actually holds is the invariant below: every document appears in
 * `documents_summary` with its link, whatever the cap is.
 */

const base = (over: Partial<ContractorApplicationInput> = {}): ContractorApplicationInput => ({
  fullName: 'Ada Mbeki', businessName: 'Mbeki Build', phone: '670000000',
  email: 'ada@example.com', country: 'CM', city: 'Douala', portfolioUrl: '',
  role: 'general_contractor', roleOther: '',
  yearsExperience: 'y5_10', operatesAs: 'registered', teamSize: '', projectTypes: [],
  credentials: {}, uploads: [], projects: [],
  acceptsMilestones: true, acceptsVerification: true, acceptsNoSidePay: true,
  videoUrl: '', whyJoin: '', differentiator: '', readyForEarly: true,
  regions: '', concurrentProjects: '', agreedToTerms: true, lang: 'en',
  ...over,
});

const docs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ label: `Doc ${i + 1}`, path: `p${i + 1}.pdf`, size: 100 }));

const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://ghl.example/f${i + 1}`);

describe('buildContractorPayload — documents', () => {
  it('lists every document in the summary with its link, past the numbered-field cap', () => {
    const out = buildContractorPayload({
      ...base({ uploads: docs(8) }),
      applicationId: 'app-1', status: 'pending', documentUrls: urls(8),
    });

    const summary = String(out.documents_summary);
    // The invariant. Not "8 lines" — every upload, whatever the cap becomes.
    for (let i = 1; i <= 8; i++) {
      expect(summary).toContain(`${i}. Doc ${i}`);
      expect(summary).toContain(`https://ghl.example/f${i}`);
    }
  });

  it('never leaves an uploaded document unreachable when it exceeds the cap', () => {
    const many = 12;
    const out = buildContractorPayload({
      ...base({ uploads: docs(many) }),
      applicationId: 'app-2', status: 'pending', documentUrls: urls(many),
    });

    const summary = String(out.documents_summary);
    for (let i = 1; i <= many; i++) {
      // Whether or not document_<i>_url exists, the link is on the contact somewhere.
      const hasField = typeof out[`document_${i}_url`] === 'string';
      expect(hasField || summary.includes(`https://ghl.example/f${i}`)).toBe(true);
    }
  });

  it('gives the first eight documents their own filterable fields', () => {
    const out = buildContractorPayload({
      ...base({ uploads: docs(8) }),
      applicationId: 'app-3', status: 'pending', documentUrls: urls(8),
    });

    expect(out.document_1_label).toBe('Doc 1');
    expect(out.document_8_label).toBe('Doc 8');
    expect(out.document_8_url).toBe('https://ghl.example/f8');
  });

  it('omits the URL rather than inventing one when signing failed', () => {
    const out = buildContractorPayload({
      ...base({ uploads: docs(2) }),
      applicationId: 'app-4', status: 'pending', documentUrls: ['https://ghl.example/f1', ''],
    });

    expect(out.document_1_url).toBe('https://ghl.example/f1');
    expect(out.document_2_url).toBeUndefined();
    expect(String(out.documents_summary)).toContain('2. Doc 2');
  });

  it('reports no documents as null, not an empty string', () => {
    const out = buildContractorPayload({ ...base(), applicationId: 'app-5', status: null });
    expect(out.documents_summary).toBeNull();
  });
});

/**
 * The list that tells the admin action which custom fields GoHighLevel needs.
 *
 * GHL discards a value whose field does not exist — silently, with a 200 — so on the
 * contact it renders as a blank, identical to a question the applicant skipped. Project
 * references 1, 2 and 3 were dropped this way for weeks before anyone noticed.
 *
 * The list is derived from the builder rather than typed out, so the failure it guards
 * against is a field that the builder emits only on some branch and the list never sees.
 */
describe('contractorFieldKeys', () => {
  it('covers every key a real application actually produces', async () => {
    const { contractorFieldKeys, NATIVE_CONTACT_FIELDS } =
      await import('../../../api/ghl/_contractor-payload');
    const canonical = new Set(contractorFieldKeys());

    const real = buildContractorPayload({
      ...base({
        uploads: docs(3),
        projects: [
          { name: 'Villa', location: 'Douala', budget: '1', role: 'GC', year: '2024',
            refName: 'R', refPhone: '1', refEmail: 'r@x.c' },
        ] as never,
        credentials: { diaspora: true, workStyle: 'x', software: 'y' },
      }),
      applicationId: 'a', status: 'pending', documentUrls: urls(3),
    });

    // Every key must land somewhere: a custom field we create, a native contact
    // property GHL already has, or `tags`. A key in none of those is silently discarded
    // by GHL and shows on the contact as a blank — the exact failure this guards.
    const uncovered = Object.keys(real).filter(
      k => k !== 'tags' && !canonical.has(k) && !NATIVE_CONTACT_FIELDS.has(k),
    );
    expect(uncovered).toEqual([]);
  });

  it('emits only keys GoHighLevel can actually store', async () => {
    const { contractorFieldKeys } = await import('../../../api/ghl/_contractor-payload');

    // GHL folds custom-field keys to lower case. A key with a capital in it can never be
    // created, and — worse — the upsert addresses fields by this key, so every value
    // sent under one is silently discarded and shows on the contact as a blank.
    // Six `cred_*` keys were camelCase and failed exactly this way.
    const unstorable = contractorFieldKeys().filter(k => !/^[a-z0-9_]+$/.test(k));
    expect(unstorable).toEqual([]);
  });

  it('does not offer to create a custom field GHL already has natively', async () => {
    const { contractorFieldKeys, NATIVE_CONTACT_FIELDS } =
      await import('../../../api/ghl/_contractor-payload');

    // A custom `phone` beside the native one is the field somebody copies into WhatsApp,
    // where it does not work. Same for a second email or city on every contact.
    const duplicated = contractorFieldKeys().filter(k => NATIVE_CONTACT_FIELDS.has(k));
    expect(duplicated).toEqual([]);
  });

  it('includes the project reference fields that were being dropped', async () => {
    const { contractorFieldKeys } = await import('../../../api/ghl/_contractor-payload');
    const keys = contractorFieldKeys();

    for (const n of [1, 2, 3]) {
      expect(keys).toContain(`project_${n}_name`);
      expect(keys).toContain(`project_${n}_ref_email`);
      expect(keys).toContain(`project_${n}_ref_phone`);
    }
    // The two that make a contact readable without opening the admin console.
    expect(keys).toContain('projects_summary');
    expect(keys).toContain('documents_summary');
  });

  it('emits keys GHL can actually address', async () => {
    const { contractorFieldKeys } = await import('../../../api/ghl/_contractor-payload');
    for (const k of contractorFieldKeys()) {
      // No spaces, no dots — a dot collides with GHL's own `contact.` prefixing.
      expect(k).toMatch(/^[a-zA-Z0-9_]+$/);
    }
  });

  it('never offers `tags` as a custom field — it is an array the upsert handles', async () => {
    const { contractorFieldKeys } = await import('../../../api/ghl/_contractor-payload');
    expect(contractorFieldKeys()).not.toContain('tags');
  });
});
