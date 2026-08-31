import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * GHL has two different "business name" fields and they are not connected.
 *
 *   companyName    — native. This is what the Contacts *list* column shows.
 *   business_name  — our custom field. Only visible once you open the contact.
 *
 * The API sent only the second, while the old webhook workflow set the first. The result
 * was visible in the contacts list: every duplicate created by the workflow showed a
 * trading name, and every contact the API created — the good one, with the email and the
 * tags — showed a blank. It looked like our contacts were the incomplete ones.
 *
 * Setting one does not fill the other, so both are sent.
 */

async function fresh() {
  vi.resetModules();
  process.env.GHL_API_TOKEN = 't';
  process.env.GHL_LOCATION_ID = 'loc123';
  return import('../../../api/ghl/_client');
}

let sent: Record<string, unknown> = {};

beforeEach(() => {
  sent = {};
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit = {}) => {
    sent = JSON.parse(String(init.body ?? '{}'));
    return new Response(JSON.stringify({ contact: { id: 'c1' } }), { status: 200 });
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('upsertContact', () => {
  it('sends the native companyName so the contacts list is not blank', async () => {
    const { upsertContact, ghlConfig } = await fresh();

    await upsertContact((await ghlConfig())!, {
      email: 'a@b.c',
      name: 'Ada Mbeki',
      companyName: 'Mbeki Build Ltd',
      customFields: { business_name: 'Mbeki Build Ltd' },
    });

    expect(sent.companyName).toBe('Mbeki Build Ltd');
    // And the custom field too — they are separate fields, not alternatives.
    expect(sent.customFields).toContainEqual({ key: 'business_name', field_value: 'Mbeki Build Ltd' });
  });

  it('omits it rather than blanking an existing value when the applicant gave none', async () => {
    const { upsertContact, ghlConfig } = await fresh();

    await upsertContact((await ghlConfig())!, { email: 'a@b.c', companyName: null });

    // Absent, not empty string: an upsert with '' would wipe a name already on the contact.
    expect('companyName' in sent).toBe(false);
  });
});
