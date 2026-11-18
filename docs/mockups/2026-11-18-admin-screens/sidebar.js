// The admin sidebar, exactly as src/components/shell/nav-config.ts (ADMIN_NAV) defines it:
// every section, every item, the same labels, order and destinations. Only the look is new
// (white, the calm theme). Nothing is removed, renamed or moved.
//
// The one behaviour change in the design: an item is lit only when the whole address
// matches, including ?channel=. Today Inbox, WhatsApp, Jalla Messages, Email and Calls are
// all /admin/inbox with a different ?channel=, and the link check ignores the ? part, so
// they all light up together.
const P = {
  dash:'<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  list:'<path d="M3 6l2 2 3-3M3 13l2 2 3-3M11 7h10M11 14h10M11 20h10"/>',
  folder:'<path d="M3 7h6l2 2h10v10H3z"/>', clip:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 13l2 2 4-4"/>',
  camera:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', search:'<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4M9 11l1.5 1.5L13 10"/>',
  todo:'<rect x="3" y="5" width="6" height="6" rx="1"/><path d="M13 7h8M13 17h8M3 17l2 2 4-4"/>', bank:'<path d="M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18M12 3l9 5H3z"/>',
  in:'<path d="M17 7L7 17M7 9v8h8"/>', out:'<path d="M7 17L17 7M9 7h8v8"/>', wallet:'<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h2M3 9h18"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', hat:'<path d="M3 18h18M5 18v-3a7 7 0 0 1 14 0v3M10 8V5h4v3"/>',
  hand:'<path d="M8 12l3 3 5-5M3 12l4-4 4 2 4-2 6 6-6 6-4-2"/>', shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  usercog:'<circle cx="10" cy="8" r="4"/><path d="M3 21c1-4 4-6 7-6M18 15v6M15 18h6"/>', users:'<circle cx="9" cy="8" r="4"/><path d="M2 21c1-4 4-6 7-6s6 2 7 6M17 4a4 4 0 0 1 0 8M22 21c-.5-2.5-2-4-4-5"/>',
  inbox:'<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 2h6l1-2h5"/>',
  wa:'<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9.5 9.5c.3 1.8 2.2 3.8 4.4 4.4l1-1.1 1.8.8-.3 1.6c-3.3.2-7.2-3.5-7.1-6.9l1.6-.3.8 1.8z"/>',
  bell:'<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/>', chats:'<path d="M3 5h12v8H7l-4 3zM9 15v2h8l4 3V9h-4"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>', phone:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  file:'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>', pen:'<path d="M6 3h9l4 4v6M6 3v18h6"/><path d="M14 21l1-3 5-5 2 2-5 5z"/>',
  mailbox:'<path d="M4 10a4 4 0 0 1 8 0v10H4zM12 10h8v10h-8M7 13h2"/>', quest:'<path d="M6 3h9l4 4v14H6z"/><path d="M10 11a2 2 0 1 1 3 1.7c-.6.4-1 .8-1 1.3M12 17h.01"/>',
  radio:'<circle cx="12" cy="12" r="2"/><path d="M8 8a6 6 0 0 0 0 8M16 8a6 6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  buoy:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', plug:'<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
  clap:'<path d="M4 9h16v11H4zM4 9l2-5 14 2-1 3"/>', scroll:'<path d="M7 3h11v15a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-2h11v2a3 3 0 0 0 3 3"/><path d="M7 3a2 2 0 0 0-2 2v11M10 8h5M10 12h5"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
};
const NAV = [
  ['Overview', [['Overview','/admin','dash'],['Action Center','/admin/action-center','list']]],
  ['Work', [['Projects','/admin/projects','folder'],['Reviews & Approvals','/admin/reviews','clip'],['Site Updates','/admin/site-updates','camera'],['Inspections','/admin/inspections','search'],['Tasks','/admin/tasks','todo']]],
  ['Finance', [['Finance overview','/admin/finance','bank'],['Inflows','/admin/finance/inflows','in'],['Disbursements','/admin/finance/disbursements','out'],['Budgets & fees','/admin/budgets','wallet']]],
  ['People', [['Homeowners','/admin/clients','user'],['Contractors','/admin/contractors','hat'],['Contractor records','/admin/contractors/records','clip'],['Partner pipeline','/admin/partners','hand'],['Verifiers','/admin/verifiers','shield'],['Site Managers','/admin/site-managers','usercog'],['Users','/admin/users','users'],['Agents','/admin/agents','hand']]],
  ['Communication', [['Inbox','/admin/inbox','inbox'],['WhatsApp','/admin/inbox?channel=whatsapp','wa'],['Notifications','/admin/notifications','bell'],['Jalla Messages','/admin/inbox?channel=jalla','chats'],['Email','/admin/inbox?channel=email','mail'],['Calls','/admin/inbox?channel=call','phone']]],
  ['Acquisition', [['Applications','/admin/applications','file'],['Started Applications','/admin/drafts','pen'],['Waitlist','/admin/waitlist','mailbox'],['Communications','/admin/sequences','mailbox'],['Quote Requests','/admin/inquiries','quest'],['CRM','/admin/crm','radio']]],
  ['Support', [['Support','/admin/support','buoy']]],
  ['Analytics', [['Analytics','/admin/analytics','chart']]],
  ['System', [['Integrations','/admin/integrations','plug'],['Automation Requests','/admin/requests','clap'],['Team & Permissions','/admin/team','shield'],['Audit Log','/admin/audit-log','scroll'],['Settings','/admin/settings','gear']]],
];
window.ADMIN_NAV_SPEC = NAV;
const ic = (k, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24">${P[k]}</svg>`;
const ACTIVE = document.body.dataset.active || "/admin";
// Dropdown sections (18 Nov, Favour): each group folds away, so the sidebar no longer scrolls.
// The group holding the current page opens by itself; any other opens on a click and stays
// open for that admin. Overview / Action Center sit at the top as plain links, and the two
// one-item groups (Support, Analytics) are plain links too: a dropdown holding a single
// link is a click for nothing. Every item keeps its label and destination.
const FLAT = new Set(['Overview', 'Support', 'Analytics']);
const chev = open => `<svg class="ico chev" viewBox="0 0 24 24" style="transform:rotate(${open ? 90 : 0}deg)"><path d="M9 6l6 6-6 6"/></svg>`;
const link = ([label, to, icon], showRoutes) => `<a class="${to === ACTIVE ? 'on' : ''}" data-to="${to}">${ic(icon, icon === 'wa' ? 'wa-ico' : '')}<span>${label}</span>${to === ACTIVE && to.includes('whatsapp') ? '<span class="n">3</span>' : ''}${showRoutes ? `<code>${to}</code>` : ''}</a>`;
function sidebarHtml(showRoutes, expandAll, extraOpen) {
  const groups = NAV.map(([section, items]) => {
    if (FLAT.has(section)) return (section === 'Overview' ? '' : '<div class="gap"></div>') + items.map(item => link(item, showRoutes)).join('');
    const open = expandAll || items.some(([, to]) => to === ACTIVE) || extraOpen.includes(section);
    return `<div class="grp${open ? ' open' : ''}"><button class="grph">${section}<span class="cnt">${items.length}</span>${chev(open)}</button>${open ? `<div class="grpi">${items.map(item => link(item, showRoutes)).join('')}</div>` : ''}</div>`;
  }).join('');
  return `<div class="logo">Groundwork<small>by Jalla</small></div><span class="admin">Admin</span>
  <div class="navscroll">${groups}</div><div class="me"><div class="av sm c1">RU</div><div><b>Ruth</b><div class="muted" style="font-size:11px">Operations</div></div></div>`;
}
document.querySelectorAll('[data-sidebar]').forEach(el => {
  el.innerHTML = sidebarHtml(el.hasAttribute('data-routes'), el.hasAttribute('data-expand-all'), (el.dataset.open || '').split(',').filter(Boolean));
});
// The admin top bar (search, language, bell, account), and the phone header.
document.querySelectorAll('[data-topbar]').forEach(el => { el.innerHTML = `
  <div class="search"><svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></svg>Search projects and people</div>
  <div style="display:flex;gap:16px;align-items:center;color:var(--mid);font-weight:600">EN<svg class="ico" viewBox="0 0 24 24"><path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/></svg><svg class="ico" viewBox="0 0 24 24">${P.bell}</svg><div class="av sm c1">RU</div></div>`; });
document.querySelectorAll('[data-phonebar]').forEach(el => { el.innerHTML = `
  <span style="font-family:var(--sans);font-weight:800;color:var(--green);font-size:18px">Groundwork</span>
  <div style="display:flex;gap:14px;align-items:center;color:var(--mid)"><svg class="ico" viewBox="0 0 24 24">${P.search}</svg><svg class="ico" viewBox="0 0 24 24">${P.bell}</svg><svg class="ico" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg></div>`; });
// The phone tab bar: the first five admin items, as today (nav-config: "the first five items feed the mobile tab bar").
document.querySelectorAll('[data-ptab]').forEach(el => {
  const five = [['Overview','/admin','dash'],['Action Center','/admin/action-center','list'],['Projects','/admin/projects','folder'],['Reviews','/admin/reviews','clip'],['Site Updates','/admin/site-updates','camera']];
  el.innerHTML = five.map(([label, to, icon]) => `<div class="${to === ACTIVE ? 'on' : ''}"><svg class="ico" viewBox="0 0 24 24" style="width:20px;height:20px">${P[icon]}</svg>${label}</div>`).join('');
});
