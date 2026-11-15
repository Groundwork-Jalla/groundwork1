import { supabase } from './client';

/** The server records the current primary client's own join, once per project. */
export async function recordPrimaryClientJoin(projectId:string):Promise<void> {
  const {error}=await supabase.rpc('record_primary_client_join',{p_project:projectId});
  if(error)throw error;
}
