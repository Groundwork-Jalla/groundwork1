import { beforeEach, describe, expect, it, vi } from 'vitest';
const read = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/project-team', () => ({ fetchProjectTeamAccess: read }));
import { destinationFor, notificationData, notificationFocus, resolveNotificationDestination } from './notification-destination';
const project = '11111111-2222-3333-4444-555555555555';
beforeEach(() => { vi.clearAllMocks(); });
it('opens a role-change notice in the current account workspace',async()=>{
  const notice={account_role_notification_id:project,account_role:'admin'};
  expect(await resolveNotificationDestination(notice,{isContractor:true})).toBe('/work/onboarding');
  expect(destinationFor(notice,{isVerifier:true})).toBe('/verifiers');
  expect(destinationFor(notice,{isAdmin:true})).toBe('/admin');
  expect(destinationFor(notice,{})).toBe('/dashboard');
  expect(read).not.toHaveBeenCalled();
});
it('opens a WhatsApp reply at the exact Admin contact and rejects an unsafe target',async()=>{
  expect(await resolveNotificationDestination({whatsapp_contact_id:project},{isAdmin:true})).toBe(`/admin/sequences?tab=whatsapp&contact=${project}`);
  expect(destinationFor({whatsapp_contact_id:project},{isAdmin:false})).toBeNull();
  expect(destinationFor({whatsapp_contact_id:'../../other'},{isAdmin:true})).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

describe('project actions open in the current accepted project role', () => {
  it.each([
    ['primary_client', '/projects'], ['primary_contractor', '/work/projects'],
    ['contractor', '/work/projects'], ['observer', '/projects'], ['verifier', '/verifiers/projects'],
  ])('%s overrides stale account and notification roles', async (projectRole, base) => {
    read.mockResolvedValue({ projectRole });
    const url = new URL((await resolveNotificationDestination({ project_id: project, role: 'contractor', project_tab: 'work', stage_number: 4, receipt_id: 'receipt-1' }, { isContractor: true }))!, 'https://test.invalid');
    expect(url.pathname).toBe(`${base}/${project}`);
    expect(url.searchParams.get('tab')).toBe(base === '/work/projects' ? 'work' : 'stages');
    expect(url.searchParams.get('stage')).toBe('4');
    expect(url.searchParams.get('receipt_id')).toBe('receipt-1');
    expect(read).toHaveBeenCalledWith(project);
  });
  it('a staff member opens the admin workspace at its actual tab', async () => {
    read.mockResolvedValue({ projectRole: 'staff' });
    expect(await resolveNotificationDestination({ project_id: project, project_tab: 'costing', proposal_id: 'price-1' }))
      .toBe(`/admin/projects/${project}?tab=financials&proposal_id=price-1`);
  });
  it('an assigned verifier opens the requested verification', async () => {
    read.mockResolvedValue({ projectRole: 'verifier' });
    expect(await resolveNotificationDestination({ project_id: project, verification_id: 'verification-1' })).toBe('/verifiers/verification-1');
  });
  it.each([null, undefined])('does not guess a surface after membership was revoked (%s)', async projectRole => {
    read.mockResolvedValue({ projectRole });
    await expect(resolveNotificationDestination({ project_id: project }, { isContractor: true })).rejects.toThrow('project_access_unavailable');
  });
  it('surfaces a membership lookup failure without marking an unrelated project as the destination', async () => {
    read.mockRejectedValue(new Error('offline'));
    await expect(resolveNotificationDestination({ project_id: project })).rejects.toThrow('offline');
  });
});

describe('notification action addresses', () => {
  it.each([null, {}])('uses the real project reference when a legacy payload is missing (%s)', async data => {
    read.mockResolvedValue({ projectRole: 'primary_client' });
    expect(await resolveNotificationDestination(notificationData({ data, project_id: project }))).toBe(`/projects/${project}`);
  });
  it('preserves the exact action while filling a missing project reference', async () => {
    read.mockResolvedValue({ projectRole: 'primary_client' });
    expect(await resolveNotificationDestination(notificationData({ data: { receipt_id: 'receipt-8', stage_id: 'stage-4', stage_number: 4 }, project_id: project })))
      .toBe(`/projects/${project}?tab=stages&stage=4&receipt_id=receipt-8&stage_id=stage-4`);
  });
  it('does not overwrite a valid project ID already in the action payload', () => {
    expect(notificationData({ data: { project_id: 'original', document_id: 'doc-1' }, project_id: project }))
      .toEqual({ project_id: 'original', document_id: 'doc-1' });
  });
  it.each([['contractor', '/invite/'], ['viewer', '/share/']])('a pending %s invitation opens acceptance before project access', async (kind, base) => {
    expect(await resolveNotificationDestination({ project_id: project, invitation_kind: kind, invitation_token: 'original-token' })).toBe(`${base}original-token`);
    expect(read).not.toHaveBeenCalled();
  });
  it('a message retains its exact conversation and message', () => {
    const url = destinationFor({ project_id: project, role: 'contractor', conversation_id: 'thread-2', message_id: 'message-8' });
    expect(url).toContain('tab=messages'); expect(url).toContain('conversation_id=thread-2'); expect(url).toContain('message_id=message-8');
  });
  it('opens the messages tab when an older notice carries only its message ID', () => {
    expect(destinationFor({ project_id: project, message_id: 'message-8' }))
      .toBe(`/projects/${project}?tab=messages&message_id=message-8`);
  });
  it('infers the correct Admin tab from a proposal and preserves canonical Admin tabs', async () => {
    read.mockResolvedValue({ projectRole: 'staff' });
    expect(await resolveNotificationDestination({ project_id: project, proposal_id: 'proposal-1' }, { isAdmin: true }))
      .toBe(`/admin/projects/${project}?tab=financials&proposal_id=proposal-1`);
    expect(await resolveNotificationDestination({ project_id: project, project_tab: 'financials', receipt_id: 'receipt-1' }, { isAdmin: true }))
      .toBe(`/admin/projects/${project}?tab=financials&receipt_id=receipt-1`);
  });
  it('uses a proposal or document to choose a useful tab for older notifications', () => {
    expect(destinationFor({ project_id: project, proposal_id: 'price-1' })).toContain('tab=costing&proposal_id=price-1');
    expect(destinationFor({ project_id: project, document_id: 'doc-1' })).toContain('tab=documents&document_id=doc-1');
  });
  it('ignores URL injection attempts in entity IDs and stage numbers', () => {
    expect(destinationFor({ project_id: '../../other' })).toBeNull();
    expect(destinationFor({ project_id: project, stage_number: '4&tab=team', receipt_id: 'bad#tab=team' })).toBe(`/projects/${project}?tab=stages`);
    expect(notificationFocus({ receipt_id: 'bad#tab=team' })).toBeNull();
  });
  it('focuses the most specific review item before the stage payment section', () => {
    expect(notificationFocus({ stage_id: 'stage-4', receipt_id: 'receipt-8' })).toEqual({ key: 'receipt_id', id: 'receipt-receipt-8' });
    expect(notificationFocus({ proposal_id: 'proposal-4' })?.id).toBe('price-proposal-proposal-4');
    const url = new URL(destinationFor({ project_id: project, project_event: 'stage_review_requested', stage_id: 'stage-4', stage_number: 4 })!, 'https://test.invalid');
    expect(notificationFocus(Object.fromEntries(url.searchParams))?.id).toBe('project-stage-stage-4');
  });
  it('opens approved work at the work section rather than the stage payment form', () => {
    const url = new URL(destinationFor({ project_id: project, project_event: 'stage_work_approved', stage_id: 'stage-4' })!, 'https://test.invalid');
    expect(notificationFocus(Object.fromEntries(url.searchParams))?.id).toBe('project-stage-stage-4');
  });
});
