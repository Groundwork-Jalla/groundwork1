/* =========================================================
   Groundwork · contractor screens — shared chrome
   Fills in the sidebar, the phone status bar and the phone tab bar so
   every mockup agrees about what the navigation contains. Edit here once.

   Usage, anywhere in the page:
     <aside class="side" data-nav="payouts"></aside>
     <div class="status"></div>
     <nav class="tabbar" data-tab="projects"></nav>
   then <script src="shell.js"></script> at the end of <body>.
   ========================================================= */

const ICON = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  projects:  '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  payouts:   '<path d="M3 10 12 4l9 6"/><path d="M5 10v9M19 10v9M9.5 10v9M14.5 10v9"/><path d="M3 20h18"/>',
  verification: '<path d="M12 3.5 19.5 6v6c0 4.2-3 7.4-7.5 8.6C7.5 19.4 4.5 16.2 4.5 12V6z"/><path d="m9.2 12 2 2 3.6-3.8"/>',
  partner:   '<path d="m11 17-2.4 2.3a2 2 0 0 1-2.8-2.8l5.6-5.4 2.6 2.4a2 2 0 0 0 2.8 0l2.7-2.6"/><path d="M3.5 8.5 7 5.3a3 3 0 0 1 3.6-.4L13 6.4"/><path d="M20.5 8.5 17 5.3"/>',
  profile:   '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20a7.4 7.4 0 0 1 14.4 0"/>',
};

/* The contractor sidebar, matching src/components/shell/WorkShell.tsx —
   less the "Needs action" entry, which this redesign drops. */
const NAV = [
  { id:'dashboard',    label:'Dashboard' },
  { id:'projects',     label:'Projects', count:'3' },
  { id:'payouts',      label:'Payouts' },
  { section:'Your account' },
  { id:'verification', label:'Verification' },
  { id:'partner',      label:'Partner programme' },
  { id:'profile',      label:'Profile' },
];

/* The first four also form the phone tab bar. */
const TABBAR = ['dashboard', 'projects', 'payouts', 'profile'];

const svg = body => `<svg viewBox="0 0 24 24">${body}</svg>`;

function sidebar(active) {
  const rows = NAV.map(item => {
    if (item.section) return `<div class="navsec">${item.section}</div>`;
    const on = item.id === active ? ' on' : '';
    const count = item.count ? `<span class="count">${item.count}</span>` : '';
    return `<div class="nav${on}">${svg(ICON[item.id])}${item.label}${count}</div>`;
  }).join('');

  return `
    <div class="wordmark"><b>Groundwork</b><span>by Jalla · Contractor</span></div>
    ${rows}
    <div class="side-foot">
      <div class="ava">BO</div>
      <div class="who"><b>Bob Ousmane</b><span>Verified contractor</span></div>
    </div>`;
}

function tabbar(active) {
  return TABBAR.map(id => {
    const label = NAV.find(n => n.id === id).label;
    return `<div class="tb${id === active ? ' on' : ''}">${svg(ICON[id])}${label}</div>`;
  }).join('');
}

const STATUS = `
  <span>9:41</span>
  <div class="right">
    <svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0.5" width="3" height="11.5" rx="1" opacity=".3"/></svg>
    <svg viewBox="0 0 16 12"><path d="M8 10.6 6 8.4a2.9 2.9 0 0 1 4 0zM8 6.1a6 6 0 0 0-4.3 1.8L2 6.2a8.4 8.4 0 0 1 12 0l-1.7 1.7A6 6 0 0 0 8 6.1z"/></svg>
    <svg viewBox="0 0 26 12"><rect x="0.6" y="0.6" width="21" height="10.8" rx="3" fill="none" stroke="#0a0a0a" stroke-width="1.1" opacity=".45"/><rect x="2.3" y="2.3" width="14" height="7.4" rx="1.7"/><path d="M23.5 4.3v3.4a2.3 2.3 0 0 0 0-3.4z" opacity=".45"/></svg>
  </div>`;

document.querySelectorAll('aside.side').forEach(el => { el.innerHTML = sidebar(el.dataset.nav); });
document.querySelectorAll('nav.tabbar').forEach(el => { el.innerHTML = tabbar(el.dataset.tab); });
document.querySelectorAll('div.status').forEach(el => { el.innerHTML = STATUS; });

/* =========================================================
   The project chrome — used by every "inside a project" screen so the
   header, the pipeline and the tab row can never drift apart.

     <div class="phead" data-ptab="money"></div>        (desktop)
     <div class="mtop"  data-mptab="money"></div>       (phone)
   ========================================================= */

const STAGES = [
  'Land', 'Design', 'Site prep', 'Foundation', 'Structure & walls',
  'Roofing', 'Elec & plumbing', 'Finishing', 'Exterior', 'Handover',
];
const CURRENT = 5;                       // stage 5 of 10, the one being worked
const PTABS = [
  ['work','Work'], ['money','Money'], ['documents','Documents','14'],
  ['messages','Messages','3'], ['people','People'],
];

function pipeline({ labels = false, big = false, current = CURRENT } = {}) {
  const steps = STAGES.map((name, i) => {
    const n = i + 1;
    const cls = n < current ? 'done' : n === current ? 'now' : '';
    const mark = n < current ? '✓' : n;
    const label = labels ? `<div class="step-l">${name}</div>` : '';
    return `<div class="step ${cls}"><div class="dot">${mark}</div>${label}</div>`;
  }).join('');
  return `<div class="pipe${big ? ' big' : ''}">${steps}</div>`;
}

function ptabs(active, mobile) {
  const list = mobile
    ? PTABS.filter(t => t[0] !== 'people').map(t => t[0] === 'messages' ? ['messages','Chat','3'] : t)
    : PTABS;
  return list.map(([id, label, n]) => {
    const count = n ? `<span class="n">${n}</span>` : '';
    return `<div class="tab${id === active ? ' on' : ''}">${label}${count}</div>`;
  }).join('');
}

const CHAT_ICON = '<path d="M21 11.5a8.4 8.4 0 0 1-11.8 7.7L4 20.5l1.4-4.9A8.4 8.4 0 1 1 21 11.5Z"/>';

function projectHead(tab) {
  return `
    <div class="crumb">Projects&nbsp; /&nbsp; <b>Mr Nas residence</b></div>
    <div class="ptitle">
      <h1>Mr Nas residence</h1>
      <span class="meta">G+1 · Limbe, South-West · started 28 Oct 2026</span>
      <span class="sp"></span>
      <span class="state held"><span class="d held"></span> Stage 5 · 2 of 4 evidence items</span>
      <div class="ghost">${svg(CHAT_ICON)}Message client</div>
      <div class="solid">${svg('<path d="M12 5v14M5 12h14"/>')}Add evidence</div>
    </div>
    ${pipeline({ labels: true, big: true })}
    <div class="tabs" style="margin-top:14px">${ptabs(tab, false)}</div>`;
}

function mProjectHead(tab) {
  return `
    <div class="bar1">
      <div class="ib back">${svg('<path d="m14.5 5-7 7 7 7"/>')}</div>
      <span class="sub" style="margin:0">Projects</span>
      <span class="sp"></span>
      <div class="ib">${svg(CHAT_ICON)}</div>
      <div class="ib">${svg('<circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none"/>')}</div>
    </div>
    <div class="ttl">Mr Nas residence</div>
    <div class="sub">G+1 · Limbe · stage 5 of 10 · client Mr Nas, invited</div>
    <div style="margin-top:12px">${pipeline()}</div>
    <div class="mtabs">${ptabs(tab, true)}</div>`;
}

document.querySelectorAll('div.phead[data-ptab]').forEach(el => { el.innerHTML = projectHead(el.dataset.ptab); });
document.querySelectorAll('div.mtop[data-mptab]').forEach(el => { el.innerHTML = mProjectHead(el.dataset.mptab); });
