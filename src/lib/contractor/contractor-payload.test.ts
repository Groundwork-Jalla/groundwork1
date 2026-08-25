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
