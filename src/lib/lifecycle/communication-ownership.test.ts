import { beforeEach,describe,expect,it,vi } from 'vitest';
const h=vi.hoisted(()=>({config:vi.fn(),upsert:vi.fn(),tags:vi.fn(),move:vi.fn(),fetch:vi.fn(),stage:vi.fn(),settings:vi.fn()}));
vi.mock('../../../api/ghl/_client.js',()=>({ghlConfig:h.config,upsertContact:h.upsert,addContactTags:h.tags,moveToStage:h.move,updateContactEmail:vi.fn(),findContactByEmail:vi.fn()}));
vi.mock('../../../api/ghl/_config.js',()=>({ghlSettings:h.settings}));
vi.mock('../../../api/ghl/_pipeline.js',()=>({tagsFor:()=>['sales-tag'],stageFor:h.stage,partyFor:()=> 'Homeowner'}));
vi.mock('../../../api/_lib/lifecycle.js',()=>({enrollForEvent:vi.fn()}));
vi.mock('../../../api/_lib/stripe.js',()=>({getSupabaseAdmin:vi.fn()}));
import { deliver } from '../../../api/ghl/_forward';
import { groundworkOwnsCommunication } from '../../../api/_lib/communication-ownership';
beforeEach(()=>{vi.clearAllMocks();h.config.mockResolvedValue({token:'test',locationId:'location'});h.upsert.mockResolvedValue({ok:true,data:{contactId:'contact'}});h.tags.mockResolvedValue({ok:true});h.stage.mockResolvedValue(null);});
describe('Groundwork is the activation sender',()=>{
 it.each(['user_signup','project_created','contractor_onboarding_completed','client_invited','contractor_invited','invitation_accepted','project_membership_active','contractor_support_requested','no_active_project_selected'] as const)('mirrors %s without event tags, stage moves or legacy automation webhooks',async event=>{
  expect(groundworkOwnsCommunication(event)).toBe(true);
  const result=await deliver(event,'client@example.test',{email:'client@example.test',lang:'fr'},{project_id:'project'});
  expect(result).toMatchObject({ok:true,reason:'groundwork_managed'});
  expect(h.upsert.mock.calls[0][1]).toMatchObject({source:'groundwork_account_sync',customFields:{communication_owner:'groundwork',lang:'fr'}});
  expect(h.upsert.mock.calls[0][1].tags).toBeUndefined();expect(h.tags).toHaveBeenCalledWith(expect.anything(),'contact',['groundwork','communications:groundwork']);
  expect(h.stage).not.toHaveBeenCalled();expect(h.move).not.toHaveBeenCalled();expect(h.settings).not.toHaveBeenCalled();
 });
 it('does not fall back to a GHL workflow webhook when the CRM is not configured',async()=>{
  h.config.mockResolvedValue(null);expect(await deliver('project_created','client@example.test',{email:'client@example.test'},{})).toMatchObject({ok:true,reason:'groundwork_managed'});
  expect(h.upsert).not.toHaveBeenCalled();expect(h.settings).not.toHaveBeenCalled();
 });
 it('preserves the existing sales/application pathway',async()=>{
  await deliver('application_decision','contractor@example.test',{email:'contractor@example.test'},{},{variant:'accepted'});
  expect(h.upsert.mock.calls[0][1]).toMatchObject({tags:['sales-tag'],source:'groundwork_application_decision'});expect(h.stage).toHaveBeenCalled();
 });
});
