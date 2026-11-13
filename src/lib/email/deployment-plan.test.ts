import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe,expect,it } from 'vitest';

const root=resolve(__dirname,'..','..','..');
const read=(file:string)=>readFileSync(resolve(root,file),'utf8');

describe('the confirmed Vercel Pro deployment',()=>{
  it('records the selected account plan',()=>{
    expect(JSON.parse(read('package.json')).groundwork.vercelPlan).toBe('pro');
  });
  it('routes the recurring communication worker to its authenticated handler',()=>{
    const config=JSON.parse(read('vercel.json'));
    expect(config.crons).toContainEqual({path:'/api/lifecycle-run',schedule:'*/5 * * * *'});
    expect(config.rewrites).toContainEqual({source:'/api/lifecycle-run',destination:'/api/events?action=lifecycle-run'});
    expect(read('api/events.ts')).toContain("'lifecycle-run': lifecycleRun");
    expect(config.functions['api/events.ts'].maxDuration).toBe(300);
    expect(read('api/_handlers/lifecycle-run.ts')).toContain('CRON_SECRET');
  });
  it('preserves the existing payment polling schedule',()=>{
    expect(JSON.parse(read('vercel.json')).crons).toContainEqual({path:'/api/swychr-poll',schedule:'*/5 * * * *'});
  });
});
