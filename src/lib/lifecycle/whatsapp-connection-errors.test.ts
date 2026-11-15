import { afterEach,describe,expect,it,vi } from 'vitest';
import { metaErrorCode,postMetaMessage,type MetaWhatsAppConfig } from '../../../api/_lib/meta-whatsapp';
import { checkWhatsAppConnection } from '../../../api/_lib/whatsapp-communications';
import { whatsappEn,whatsappFr } from '../i18n/whatsapp';

const cfg:MetaWhatsAppConfig={enabled:false,mode:'test',phone_number_id:'123456789',business_account_id:'987654321',display_phone:'+15550001111',messaging_account_id:'',test_recipients:[],api_version:'v27.0',token:'private-token',appSecret:'private-app-secret',verifyToken:'private-verify-token',webhook_verified_at:null,signed_event_at:null,template_checked_at:null};
const blocked={error:{code:200,error_subcode:5258005,message:'API access blocked. private-provider-detail'}};
const unavailable={error:{code:100,error_subcode:33,message:'Unsupported get request. private-provider-detail'}};
const connectionFailures=[{payload:blocked,code:'meta_api_access_blocked'},{payload:unavailable,code:'meta_resource_unavailable'}];
const response=(body:unknown,status=400)=>new Response(JSON.stringify(body),{status});
function service() {
  const writes=vi.fn();
  const from=vi.fn((table:string)=>{
    const query:any={};
    query.select=()=>query;
    query.order=async()=>({data:[],error:null});
    query.upsert=(data:any)=>{writes(table,data);return Promise.resolve({data:null,error:null});};
    query.update=(data:any)=>{writes(table,data);return {eq:async()=>({data:null,error:null})};};
    return query;
  });
  return {svc:{from,rpc:vi.fn()},writes};
}
afterEach(()=>vi.unstubAllGlobals());

describe('Meta connection failure diagnosis',()=>{
  it('names the observed API block without conflating other permission errors or exposing the response',()=>{
    expect(metaErrorCode(400,blocked)).toBe('meta_api_access_blocked');
    expect(metaErrorCode(400,{error:{code:200,message:'missing permission'}})).toBe('meta_200');
    expect(metaErrorCode(403,{error:{code:200,error_subcode:99}})).toBe('meta_200');
    expect(metaErrorCode(400,{error:{code:190}})).toBe('meta_190');
    expect(metaErrorCode(403,{error:{code:10}})).toBe('meta_10');
    expect(metaErrorCode(400,unavailable)).toBe('meta_resource_unavailable');
    expect(metaErrorCode(400,{error:{code:100,error_subcode:2388339}})).toBe('meta_100');
    expect(metaErrorCode(502,null)).toBe('meta_http_502');
    expect(metaErrorCode(403,{error:{code:'private-provider-detail'}})).toBe('meta_http_403');
  });

  it.each(connectionFailures)('reports $code for a failed phone lookup without marking the connection ready',async({payload,code})=>{
    const fetcher=vi.fn().mockResolvedValue(response(payload));vi.stubGlobal('fetch',fetcher);
    const {svc,writes}=service();
    await expect(checkWhatsAppConnection(svc,cfg)).rejects.toThrow(code);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(writes).not.toHaveBeenCalled();
  });

  it.each(connectionFailures)('reports $code during the template lookup and preserves existing approval records',async({payload,code})=>{
    const fetcher=vi.fn().mockResolvedValueOnce(response({id:cfg.phone_number_id,display_phone_number:cfg.display_phone},200)).mockResolvedValueOnce(response(payload));vi.stubGlobal('fetch',fetcher);
    const {svc,writes}=service();
    await expect(checkWhatsAppConnection(svc,cfg)).rejects.toThrow(code);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(writes).not.toHaveBeenCalled();
    for(const [,request] of fetcher.mock.calls)expect(request.redirect).toBe('error');
  });

  it('preserves a permission failure as a permission failure and an expired token as an expired token',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(response({error:{code:200,message:'missing permission'}})).mockResolvedValueOnce(response({error:{code:190,message:'expired'}}));vi.stubGlobal('fetch',fetcher);
    const {svc,writes}=service();
    await expect(checkWhatsAppConnection(svc,cfg)).rejects.toThrow(/^meta_200$/);
    await expect(checkWhatsAppConnection(svc,cfg)).rejects.toThrow(/^meta_190$/);
    expect(writes).not.toHaveBeenCalled();
  });

  it('records a rejected send as an API block without retrying or claiming delivery',async()=>{
    const fetcher=vi.fn().mockResolvedValue(response(blocked));vi.stubGlobal('fetch',fetcher);
    await expect(postMetaMessage(cfg,'test-message',{type:'text',text:{body:'test'}})).resolves.toEqual({status:'failed',error:'meta_api_access_blocked'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('gives English and French admins an actionable message for both new and previously saved errors',()=>{
    expect(whatsappEn.errors.meta_api_access_blocked).toContain('blocked API access');
    expect(whatsappFr.errors.meta_api_access_blocked).toContain('bloqué');
    for(const copy of [whatsappEn,whatsappFr]) {
      expect(copy.errors.meta_api_access_blocked).toContain('5258005');
      expect(copy.errors.meta_200).toContain('whatsapp_business_management');
      expect(copy.errors.meta_200).toContain('whatsapp_business_messaging');
      expect(copy.errors.meta_10).toContain('whatsapp_business_management');
      expect(copy.errors.meta_resource_unavailable).toContain('100 / 33');
    }
  });
});
