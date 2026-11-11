/** Keep one authoring component in the participant's own workspace. */
export function boqEditorPaths(projectId: string, pathname: string, admin: boolean) {
  const role = pathname.startsWith('/admin/') ? 'admin'
    : pathname.startsWith('/work/') ? 'work' : admin ? 'admin' : 'work';
  const project = `/${role}/projects/${encodeURIComponent(projectId)}`;
  return {
    project: `${project}?tab=${role === 'admin' ? 'financials' : 'money'}`,
    list: `${project}/takeoff`,
    legacy: !pathname.startsWith('/admin/') && !pathname.startsWith('/work/'),
  };
}
