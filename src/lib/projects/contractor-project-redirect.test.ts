import { describe,expect,it } from 'vitest';
import { contractorProjectRedirect } from './contractor-project-redirect';
describe('old client project links after a contractor correction',()=>{
 it.each([null,{assignedContractor:false,primaryClient:true},{assignedContractor:false,primaryClient:false},{assignedContractor:true,primaryClient:true}])('requires a confirmed contractor-only project responsibility %j',access=>{
  expect(contractorProjectRedirect('build',access)).toBeNull();
 });
 it.each([['stages','work'],['costing','money'],['team','people'],['messages','messages'],['documents','documents']])('maps %s into the contractor %s tab without losing the action', (client,contractor)=>{
  const path=contractorProjectRedirect('build',{assignedContractor:true,primaryClient:false},`?tab=${client}&receipt_id=receipt-1`,'#receipt-receipt-1');
  expect(path).toBe(`/work/projects/build?tab=${contractor}&receipt_id=receipt-1#receipt-receipt-1`);
 });
 it('opens the actual work page for an old project bookmark',()=>{
  expect(contractorProjectRedirect('build',{assignedContractor:true,primaryClient:false})).toBe('/work/projects/build');
 });
});
