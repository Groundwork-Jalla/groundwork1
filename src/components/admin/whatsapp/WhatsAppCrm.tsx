import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ExternalLink, Loader2, MessageCircle, Phone, PhoneCall, Plus, Search, X } from 'lucide-react';
import { linkConversation, sendConversationMessage, type Conversation, type ConversationPreview } from '@/lib/supabase/conversations';
import type { AdminUser } from '@/lib/supabase/admin-users';
import type { InboxProject } from '@/lib/supabase/inbox-context';
import { fetchPersonRecord, type PersonRecord } from '@/lib/supabase/admin-person';
import { listProjectsForJalla, type JallaProject } from '@/lib/supabase/jalla-projects';
import { openPersonWhatsApp, openProjectWhatsApp } from '@/lib/supabase/project-whatsapp';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ConversationThread } from '@/components/admin/conversations/ConversationThread';
import { PersonPreview } from '@/components/admin/PersonPreview';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { chatRole, filterChats, phoneLinks, type ChatFilter, type ChatRole } from '@/lib/admin/whatsapp-crm';

// =========================================================
// WhatsApp, as a CRM (18 Nov 2026, docs/mockups/2026-11-18-admin-whatsapp).
//
// The same live data the Inbox reads — `conversations` on the whatsapp channel, carried by
// the provider the server chooses — laid out as chats, the conversation, and the person
// beside it. Nothing here is invented: no unread counts (there is no per-admin read state;
// "needs reply" is `waiting_on_us`), no call recordings (WhatsApp calling is not connected:
// Call opens WhatsApp or the dialer on this device, and the call is logged as a staff note
// in the thread). Consent and templates come from the Meta tables and show only when a row
// exists.
// =========================================================

const WA = '#25D366';
type Tab = 'chats' | 'templates';

export interface WhatsAppCrmProps {
  rows: Conversation[];
  previews: Map<string, ConversationPreview>;
  projectsByPerson: Map<string, InboxProject[]>;
  people: Map<string, AdminUser> | null;
  staff: { id: string; label: string }[] | null;
  staffName: (id: string | null) => string;
  title: (conversation: Conversation) => string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void | Promise<void>;
}

const ROLE_TONE: Record<ChatRole, string> = {
  homeowner: 'bg-brand-green/10 text-brand-green dark:text-[#b4d8bf]',
  contractor: 'bg-state-held/10 text-state-held',
  verifier: 'bg-[#4b4370]/10 text-[#4b4370] dark:text-[#b9b0e6]',
  staff: 'bg-brand-light-grey text-brand-mid-grey',
  new: 'bg-state-alert/10 text-state-alert',
};
function RoleTag({ role }: { role: ChatRole }) {
  const t = useT();
  return <span className={cn('shrink-0 rounded-md px-1.5 py-px text-[10px] font-bold uppercase tracking-wide', ROLE_TONE[role])}>{t(`admin.whatsappCrm.role.${role}` as TKey)}</span>;
}
const initials = (name: string) => /^\+?\d/.test(name.trim()) ? '#' : name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?';

export function WhatsAppCrm({ rows, previews, projectsByPerson, people, staff, staffName, title, selectedId, onSelect, onChanged }: WhatsAppCrmProps) {
  const t = useT();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('chats');
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [query, setQuery] = useState('');
  const [newChat, setNewChat] = useState(false);
  const roleOf = useCallback((c: Conversation) => chatRole(c.personId, c.personId ? people?.get(c.personId)?.roles : undefined), [people]);
  const shown = useMemo(() => filterChats(rows, { filter, query, me: user?.id ?? null, title, preview: id => previews.get(id)?.content ?? '' }),
    [rows, filter, query, user?.id, title, previews]);
  const selected = rows.find(c => c.id === selectedId) ?? null;
  const counts = useMemo(() => ({
    all: rows.length,
    needsReply: rows.filter(c => c.status === 'waiting_on_us').length,
    mine: rows.filter(c => !!user?.id && c.assignedTo === user.id).length,
    newNumbers: rows.filter(c => !c.personId).length,
  }), [rows, user?.id]);

  const card = 'rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]';
  return (
    <div className="space-y-4" data-whatsapp-crm>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-brand-near-black dark:text-white">
            <MessageCircle className="size-6" style={{ color: WA }} aria-hidden />{t('admin.whatsappCrm.title')}
          </h1>
          <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.whatsappCrm.sub')}</p>
        </div>
        <button type="button" onClick={() => setNewChat(true)} data-action="new-chat"
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-hover">
          <Plus className="size-4" aria-hidden />{t('admin.whatsappCrm.newChat')}
        </button>
      </header>

      <nav className="flex gap-5 border-b border-brand-border-grey text-sm font-semibold dark:border-[#2c2c2c]">
        {(['chats', 'templates'] as Tab[]).map(key => (
          <button key={key} type="button" onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined} data-tab={key}
            className={cn('-mb-px border-b-2 py-2.5', tab === key ? 'border-brand-green text-brand-near-black dark:text-white' : 'border-transparent text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white')}>
            {t(`admin.whatsappCrm.tab.${key}` as TKey)}{key === 'chats' && <span className="ml-1 font-mono text-[11px] opacity-70">{rows.length}</span>}
          </button>
        ))}
        {/* The provider connection lives where it always has; this is the way there. */}
        <Link to="/admin/sequences?tab=whatsapp" className="-mb-px inline-flex items-center gap-1 border-b-2 border-transparent py-2.5 text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white" data-action="connection-settings">
          {t('admin.whatsappCrm.tab.settings')}<ExternalLink className="size-3" aria-hidden />
        </Link>
      </nav>

      {tab === 'templates' ? <TemplatesTab /> : (
        <div className="grid min-h-[34rem] gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)_18rem]">
          {/* ── Chats ─────────────────────────────────────────────────────────────── */}
          <section className={cn(card, 'flex min-w-0 flex-col overflow-hidden lg:self-start', selected && 'hidden lg:flex')} aria-label={t('admin.whatsappCrm.tab.chats')}>
            <label className="m-3 flex items-center gap-2 rounded-xl border border-brand-border-grey px-3 py-2 text-sm dark:border-[#2c2c2c]">
              <Search className="size-4 text-brand-muted-grey" aria-hidden />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('admin.whatsappCrm.search')} aria-label={t('admin.whatsappCrm.search')}
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-brand-muted-grey" />
            </label>
            <div className="flex flex-wrap gap-1.5 px-3 pb-3" role="group" aria-label={t('admin.whatsappCrm.filters')}>
              {([['all', counts.all], ['needsReply', counts.needsReply], ['mine', counts.mine], ['newNumbers', counts.newNumbers]] as [ChatFilter, number][]).map(([key, n]) => (
                <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key} data-filter={key}
                  className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold',
                    filter === key ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-[#0a0a0a]' : 'border-brand-border-grey text-brand-mid-grey hover:text-brand-near-black dark:border-[#2c2c2c] dark:hover:text-white')}>
                  {t(`admin.whatsappCrm.filter.${key}` as TKey)}<span className="font-mono opacity-70">{n}</span>
                </button>
              ))}
            </div>
            {shown.length === 0
              ? <p className="border-t border-brand-border-grey px-4 py-8 text-center text-xs text-brand-mid-grey dark:border-[#2c2c2c]">{t(rows.length ? 'admin.whatsappCrm.noMatches' : 'admin.whatsappCrm.empty')}</p>
              : <ul className="max-h-[40rem] overflow-y-auto">
                {shown.map(c => {
                  const name = title(c); const p = previews.get(c.id); const on = c.id === selected?.id;
                  return (
                    <li key={c.id} className="border-t border-brand-border-grey dark:border-[#2c2c2c]">
                      <button type="button" onClick={() => onSelect(c.id)} aria-current={on ? 'true' : undefined} data-chat={c.id}
                        className={cn('grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] gap-2.5 px-3.5 py-3 text-left transition-colors',
                          on ? 'bg-brand-green/[0.06] shadow-[inset_3px_0_0_var(--color-brand-green)]' : 'hover:bg-brand-off-white dark:hover:bg-[#242424]')}>
                        <span className="flex size-9 items-center justify-center rounded-full bg-brand-light-grey text-xs font-bold text-brand-near-black dark:text-white">{initials(name)}</span>
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-1.5"><span className="min-w-[4rem] truncate text-[13.5px] font-semibold text-brand-near-black dark:text-white">{name}</span><RoleTag role={roleOf(c)} /></span>
                          {p && <span className="mt-0.5 block truncate text-xs text-brand-mid-grey">{p.direction === 'outbound' ? `${t('admin.inbox.youPrefix')} ` : p.direction === 'internal' ? `${t('admin.workspace.conversations.internal')}: ` : ''}{p.content}</span>}
                        </span>
                        <span className="flex max-w-[5.5rem] flex-col items-end gap-1 text-right text-[11px] text-brand-muted-grey">
                          {c.lastMessageAt && formatRelative(c.lastMessageAt)}
                          {c.status === 'waiting_on_us' && <span className="size-2.5 rounded-full" style={{ background: WA }} aria-label={t('admin.whatsappCrm.filter.needsReply')} />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>}
          </section>

          {/* ── The conversation ───────────────────────────────────────────────────── */}
          {selected
            ? <ChatColumn key={selected.id} conversation={selected} name={title(selected)} role={roleOf(selected)} staff={staff} staffName={staffName}
                projects={selected.personId ? projectsByPerson.get(selected.personId) ?? [] : []} onBack={() => onSelect(null)} onChanged={onChanged} />
            : <section className={cn(card, 'hidden items-center justify-center lg:flex xl:col-span-2')}>
                <EmptyState icon={<MessageCircle className="size-8" />} title={t('admin.whatsappCrm.pick')} description={t('admin.whatsappCrm.pickBody')} />
              </section>}
        </div>
      )}

      {newChat && <NewChatDialog people={people} onClose={() => setNewChat(false)}
        onOpened={async id => { setNewChat(false); setTab('chats'); await onChanged(); onSelect(id); }} />}
    </div>
  );
}

/** The thread, with the person's record beside it on a wide screen and under it on a narrow one. */
function ChatColumn({ conversation, name, role, staff, staffName, projects, onBack, onChanged }: {
  conversation: Conversation; name: string; role: ChatRole;
  staff: { id: string; label: string }[] | null; staffName: (id: string | null) => string;
  projects: InboxProject[]; onBack: () => void; onChanged: () => void | Promise<void>;
}) {
  const t = useT();
  const [record, setRecord] = useState<PersonRecord | null>(null);
  useEffect(() => {
    let live = true; setRecord(null);
    if (conversation.personId) fetchPersonRecord({ userId: conversation.personId }).then(r => { if (live) setRecord(r); }).catch(() => {});
    return () => { live = false; };
  }, [conversation.personId]);
  const phone = record?.account?.phone ?? null;
  const reach = phoneLinks(phone);
  const card = 'rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]';
  return <>
    <section className={cn(card, 'flex min-w-0 flex-col overflow-hidden')} aria-label={name} data-chat-open={conversation.id}>
      <div className="flex flex-wrap items-center gap-3 border-b border-brand-border-grey px-4 py-3 dark:border-[#2c2c2c]">
        <button type="button" onClick={onBack} aria-label={t('common.back')} className="-ml-1 rounded-lg p-1 text-brand-green lg:hidden" data-action="back"><ArrowLeft className="size-5" /></button>
        <span className="flex size-9 items-center justify-center rounded-full bg-brand-light-grey text-xs font-bold">{initials(name)}</span>
        <div className="min-w-[9rem] flex-1">
          <p className="flex items-center gap-1.5 text-[15px] font-bold text-brand-near-black dark:text-white"><span className="truncate">{name}</span><RoleTag role={role} /></p>
          {phone && <p className="text-xs text-brand-mid-grey">{phone}</p>}
        </div>
        {reach && <div className="flex w-full gap-2 sm:w-auto">
          <a href={reach.whatsapp} target="_blank" rel="noopener noreferrer" data-action="open-whatsapp"
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-2 text-xs font-semibold text-brand-near-black hover:border-brand-near-black dark:border-[#2c2c2c] dark:text-white">
            <MessageCircle className="size-3.5" style={{ color: WA }} aria-hidden />{t('admin.whatsappCrm.openWhatsApp')}</a>
          <a href={reach.tel} data-action="call"
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-2 text-xs font-semibold text-brand-near-black hover:border-brand-near-black dark:border-[#2c2c2c] dark:text-white">
            <Phone className="size-3.5" aria-hidden />{t('admin.whatsappCrm.call')}</a>
        </div>}
      </div>
      <ConversationThread conversation={conversation} staff={staff} staffName={staffName} onChanged={() => { void onChanged(); }} realtimeProjectId={conversation.projectId} />
    </section>
    <PersonPanel conversation={conversation} name={name} role={role} record={record} projects={projects} staffName={staffName} onChanged={onChanged} />
  </>;
}

/** Who this is: what Groundwork knows about the person, and the call log. */
function PersonPanel({ conversation, name, role, record, projects, staffName, onChanged }: {
  conversation: Conversation; name: string; role: ChatRole; record: PersonRecord | null; projects: InboxProject[];
  staffName: (id: string | null) => string; onChanged: () => void | Promise<void>;
}) {
  const t = useT();
  const [consent, setConsent] = useState<{ consent_at: string | null; opted_out_at: string | null; automation_paused: boolean } | null>(null);
  const [profile, setProfile] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setConsent(null);
    if (conversation.personId) void supabase.from('communication_whatsapp_contacts').select('consent_at,opted_out_at,automation_paused')
      .eq('user_id', conversation.personId).order('last_message_at', { ascending: false }).limit(1)
      .then(({ data }) => { if (live && data?.[0]) setConsent(data[0] as never); }, () => {});
    return () => { live = false; };
  }, [conversation.personId]);
  const owned = record?.projects?.length ? record.projects : projects;
  const link = async (projectId: string) => {
    setLinking(projectId); setError(null);
    try { await linkConversation(conversation.id, projectId); await onChanged(); }
    catch (err) { const msg = errorMessage(err, ''); setError(msg.includes('already_linked') ? t('admin.inbox.alreadyLinked') : msg || t('common.somethingWrong')); }
    finally { setLinking(null); }
  };
  const lang = record?.account?.preferredLang;
  const section = 'border-t border-brand-border-grey px-4 py-3.5 first:border-t-0 dark:border-[#2c2c2c]';
  const heading = 'mb-2 text-[11px] font-bold uppercase tracking-wider text-brand-muted-grey';
  return (
    <aside className="min-w-0 overflow-hidden rounded-2xl border border-brand-border-grey bg-white lg:col-start-2 xl:col-start-auto xl:self-start dark:border-[#2c2c2c] dark:bg-[#1e1e1e]" aria-label={t('admin.whatsappCrm.person')} data-person-panel>
      <div className={cn(section, 'flex items-center gap-3')}>
        <span className="flex size-11 items-center justify-center rounded-full bg-brand-light-grey text-sm font-bold">{initials(name)}</span>
        <div className="min-w-0">
          <p className="truncate font-bold text-brand-near-black dark:text-white">{name}</p>
          <p className="text-xs text-brand-mid-grey">{[t(`admin.whatsappCrm.role.${role}` as TKey), record?.account?.signupCountry, lang ? t(lang === 'fr' ? 'admin.whatsappCrm.french' : 'admin.whatsappCrm.english') : null].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className={section}>
        <p className={heading}>{t('admin.whatsappCrm.contact')}</p>
        <dl className="space-y-1 text-[12.5px]">
          <Row label={t('admin.whatsappCrm.phone')} value={record?.account?.phone ?? '—'} />
          {record?.account?.email && <Row label={t('admin.whatsappCrm.email')} value={record.account.email} />}
          {consent && <Row label={t('admin.whatsappCrm.consent')} value={consent.opted_out_at ? t('admin.whatsappCrm.optedOut', { date: formatRelative(consent.opted_out_at) })
            : consent.consent_at ? t('admin.whatsappCrm.consentGiven', { date: formatRelative(consent.consent_at) }) : t('admin.whatsappCrm.consentNone')}
            tone={consent.opted_out_at ? 'alert' : consent.consent_at ? 'ok' : undefined} />}
          {consent && <Row label={t('admin.whatsappCrm.automatic')} value={t(consent.automation_paused ? 'admin.whatsappCrm.paused' : 'admin.whatsappCrm.on')} />}
          <Row label={t('admin.whatsappCrm.owner')} value={conversation.assignedTo ? staffName(conversation.assignedTo) : t('admin.workspace.conversations.unassigned')} />
        </dl>
        {conversation.personId && <button type="button" onClick={() => setProfile(true)} data-action="full-profile" className="mt-2.5 text-xs font-semibold text-brand-green underline underline-offset-2 dark:text-[#b4d8bf]">{t('admin.whatsappCrm.fullProfile')}</button>}
      </div>
      <div className={section}>
        <p className={heading}>{t('admin.whatsappCrm.projects')}</p>
        {owned.length === 0 ? <p className="text-xs text-brand-mid-grey">{t('admin.inbox.noProject')}</p> : <ul className="space-y-2">
          {owned.map(project => (
            <li key={project.id} className="rounded-xl border border-brand-border-grey p-3 text-xs dark:border-[#2c2c2c]">
              <p className="font-semibold text-brand-near-black dark:text-white">{project.name}</p>
              <p className="mt-0.5 text-brand-mid-grey">{[project.currentStage != null ? `${t('admin.inbox.stage')} ${project.currentStage}` : null, [project.city, project.country].filter(Boolean).join(', ') || null].filter(Boolean).join(' · ')}</p>
              <p className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <Link to={`/admin/projects/${project.id}`} className="font-semibold text-brand-green underline underline-offset-2 dark:text-[#b4d8bf]" data-action="open-project">{t('admin.inbox.openProject')}</Link>
                {conversation.projectId === project.id
                  ? <span className="text-brand-mid-grey">{t('admin.inbox.projectLinked')}</span>
                  : !conversation.projectId && <button type="button" onClick={() => void link(project.id)} disabled={linking !== null} data-action="link-project"
                      className="rounded-lg border border-brand-border-grey px-2 py-0.5 font-semibold disabled:opacity-40 dark:border-[#2c2c2c]">
                      {linking === project.id ? <Loader2 className="size-3 animate-spin" /> : t('admin.inbox.linkThis')}</button>}
              </p>
            </li>
          ))}
        </ul>}
        {error && <p role="alert" className="mt-2 text-[11px] text-state-alert">{error}</p>}
      </div>
      <CallLog conversation={conversation} onChanged={onChanged} />
      {profile && conversation.personId && <PersonPreview reference={{ userId: conversation.personId }} rolesHint={null} onClose={() => setProfile(false)} />}
    </aside>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'alert' }) {
  return <div className="flex justify-between gap-3"><dt className="text-brand-mid-grey">{label}</dt>
    <dd className={cn('min-w-0 truncate text-right font-medium', tone === 'ok' ? 'text-state-complete' : tone === 'alert' ? 'text-state-alert' : 'text-brand-near-black dark:text-white')}>{value}</dd></div>;
}

/**
 * A call, written into the thread as a staff note: calling happens on the phone, the
 * record of it belongs with the conversation it was part of.
 */
function CallLog({ conversation, onChanged }: { conversation: Conversation; onChanged: () => void | Promise<void> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);
  async function save() {
    if (working.current || !note.trim()) return;
    working.current = true; setBusy(true); setError(null);
    try {
      const length = Number(minutes);
      const head = Number.isFinite(length) && length > 0 ? t('admin.whatsappCrm.callNoteWithLength', { minutes: Math.round(length) }) : t('admin.whatsappCrm.callNote');
      await sendConversationMessage(conversation.id, `${head}\n${note.trim()}`, 'internal');
      setOpen(false); setMinutes(''); setNote(''); await onChanged();
    } catch (err) { setError(errorMessage(err, t('common.somethingWrong'))); }
    finally { working.current = false; setBusy(false); }
  }
  return (
    <div className="border-t border-brand-border-grey px-4 py-3.5 dark:border-[#2c2c2c]">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-brand-muted-grey">{t('admin.whatsappCrm.calls')}</p>
      {!open ? <button type="button" onClick={() => setOpen(true)} data-action="log-call"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-2 text-xs font-semibold dark:border-[#2c2c2c]">
          <PhoneCall className="size-3.5" aria-hidden />{t('admin.whatsappCrm.logCall')}</button>
        : <form className="space-y-2" onSubmit={event => { event.preventDefault(); void save(); }} data-call-form>
          <label className="block text-xs">{t('admin.whatsappCrm.callMinutes')}
            <input inputMode="numeric" value={minutes} onChange={event => setMinutes(event.target.value.replace(/[^\d]/g, ''))} className="mt-1 w-full rounded-lg border border-brand-border-grey bg-transparent px-3 py-2 text-sm dark:border-[#2c2c2c]" /></label>
          <label className="block text-xs">{t('admin.whatsappCrm.callWhat')}
            <textarea value={note} onChange={event => setNote(event.target.value)} rows={3} maxLength={2000} required className="mt-1 w-full rounded-lg border border-brand-border-grey bg-transparent p-3 text-sm dark:border-[#2c2c2c]" /></label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !note.trim()} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
              {busy && <Loader2 className="size-3.5 animate-spin" />}{t('admin.whatsappCrm.saveCall')}</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-brand-border-grey px-3 py-2 text-xs dark:border-[#2c2c2c]">{t('common.cancel')}</button>
          </div>
          <p className="text-[11px] text-brand-mid-grey">{t('admin.whatsappCrm.callHint')}</p>
          {error && <p role="alert" className="text-[11px] text-state-alert">{error}</p>}
        </form>}
    </div>
  );
}

/** Approved message templates, as Meta last reported them. Read-only. */
function TemplatesTab() {
  const t = useT();
  const [rows, setRows] = useState<{ name: string; language: string; status: string; checked_at: string | null }[] | null>(null);
  useEffect(() => {
    let live = true;
    void supabase.from('communication_whatsapp_templates').select('name,language,status,checked_at').order('name')
      .then(({ data, error }) => { if (live) setRows(error ? [] : (data ?? []) as never); }, () => { if (live) setRows([]); });
    return () => { live = false; };
  }, []);
  if (rows === null) return <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>;
  if (rows.length === 0) return <div className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"><EmptyState icon={<MessageCircle className="size-8" />} title={t('admin.whatsappCrm.noTemplates')} description={t('admin.whatsappCrm.noTemplatesBody')} /></div>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <table className="w-full text-left text-sm">
        <thead className="bg-brand-off-white text-[11px] uppercase tracking-wider text-brand-muted-grey dark:bg-[#181818]"><tr>
          <th className="px-4 py-2.5">{t('admin.whatsappCrm.templateName')}</th><th className="px-4 py-2.5">{t('admin.whatsappCrm.templateLanguage')}</th>
          <th className="px-4 py-2.5">{t('admin.whatsappCrm.templateStatus')}</th><th className="px-4 py-2.5">{t('admin.whatsappCrm.templateChecked')}</th></tr></thead>
        <tbody>{rows.map(row => <tr key={`${row.name}:${row.language}`} className="border-t border-brand-border-grey dark:border-[#2c2c2c]">
          <td className="px-4 py-2.5 font-mono text-xs">{row.name}</td><td className="px-4 py-2.5">{row.language}</td>
          <td className="px-4 py-2.5"><span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', row.status.toUpperCase() === 'APPROVED' ? 'bg-state-complete/10 text-state-complete' : 'bg-state-held/10 text-state-held')}>{row.status}</span></td>
          <td className="px-4 py-2.5 text-xs text-brand-mid-grey">{row.checked_at ? formatRelative(row.checked_at) : '—'}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

type Source = 'users' | 'contractors' | 'project';

/**
 * Start a WhatsApp chat (18 Nov, Favour): with any user who signed up, with a contractor, or
 * with someone on a project. Outreach is the point — the team following up people who signed
 * up and have no project yet — so Users comes first.
 *
 * A person chosen directly goes to `person-whatsapp`; through a project, to
 * `project-whatsapp`, which also names the candidates when a role is held by several people.
 * Both end in the same place: the person's one WhatsApp thread, found or opened.
 */
function NewChatDialog({ people, onClose, onOpened }: { people: Map<string, AdminUser> | null; onClose: () => void; onOpened: (conversationId: string) => void | Promise<void> }) {
  const t = useT();
  const [source, setSource] = useState<Source>('users');
  const [projects, setProjects] = useState<JallaProject[] | null>(null);
  const [query, setQuery] = useState('');
  const [project, setProject] = useState<JallaProject | null>(null);
  const [choice, setChoice] = useState<{ role: 'client' | 'contractor' | 'verifier'; candidates: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (source !== 'project' || projects !== null) return;
    let live = true;
    listProjectsForJalla().then(r => { if (live) setProjects(r.rows); }).catch(() => { if (live) setProjects([]); });
    return () => { live = false; };
  }, [source, projects]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const q = query.trim().toLowerCase();
  // Staff are colleagues, not people to reach out to.
  const accounts = [...(people?.values() ?? [])].filter(person => chatRole(person.id, person.roles) !== 'staff')
    .filter(person => source !== 'contractors' || chatRole(person.id, person.roles) === 'contractor')
    .filter(person => !q || `${person.fullName} ${person.email}`.toLowerCase().includes(q))
    .sort((a, b) => (a.fullName || a.email).localeCompare(b.fullName || b.email));
  const shownAccounts = accounts.slice(0, 12);
  const matches = (projects ?? []).filter(p => !q || `${p.name} ${p.city ?? ''} ${p.ownerName ?? ''}`.toLowerCase().includes(q)).slice(0, 8);
  const failed = (reason: string) => setNotice(t(`admin.workspace.header.whatsappFail.${reason}` as TKey));
  async function openPerson(personId: string) {
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      const r = await openPersonWhatsApp(personId);
      if (r.ok) { await onOpened(r.conversationId); return; }
      failed(r.reason);
    } catch { failed('error'); }
    finally { setBusy(false); }
  }
  async function open(role: 'client' | 'contractor' | 'verifier', personId?: string) {
    if (!project || busy) return;
    setBusy(true); setNotice(null);
    try {
      const r = await openProjectWhatsApp(project.id, role, personId);
      if (r.ok) { await onOpened(r.conversationId); return; }
      if (r.reason === 'choose_person') { setChoice({ role, candidates: r.candidates ?? [] }); return; }
      failed(r.reason);
    } catch { failed('error'); }
    finally { setBusy(false); }
  }
  const pick = (next: Source) => { setSource(next); setQuery(''); setProject(null); setChoice(null); setNotice(null); };
  const nameOf = (id: string) => { const p = people?.get(id); return p ? p.fullName || p.email : t('admin.workspace.header.unknownAccount'); };
  const searchBox = (placeholder: string) => (
    <label className="mt-3 flex items-center gap-2 rounded-xl border border-brand-border-grey px-3 py-2 text-sm dark:border-[#2c2c2c]">
      <Search className="size-4 text-brand-muted-grey" aria-hidden />
      <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={placeholder} aria-label={placeholder} className="min-w-0 flex-1 bg-transparent outline-none" />
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="new-whatsapp-chat"
      onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }} data-new-chat>
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl dark:bg-[#1e1e1e]">
        <div className="flex items-center justify-between border-b border-brand-border-grey px-5 py-4 dark:border-[#2c2c2c]">
          <h2 id="new-whatsapp-chat" className="flex items-center gap-2 text-lg font-extrabold"><MessageCircle className="size-5" style={{ color: WA }} aria-hidden />{t('admin.whatsappCrm.newChatTitle')}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('common.close')} className="rounded-lg p-1.5 text-brand-mid-grey"><X className="size-5" /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-brand-muted-grey">{t('admin.whatsappCrm.chooseFrom')}</p>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-brand-off-white p-1 dark:bg-[#141414]" role="group" aria-label={t('admin.whatsappCrm.chooseFrom')}>
              {(['users', 'contractors', 'project'] as Source[]).map(key => (
                <button key={key} type="button" onClick={() => pick(key)} aria-pressed={source === key} data-source={key}
                  className={cn('rounded-lg px-3 py-2 text-sm font-semibold', source === key ? 'bg-white text-brand-near-black shadow-sm dark:bg-[#2c2c2c] dark:text-white' : 'text-brand-mid-grey')}>
                  {t(`admin.whatsappCrm.source.${key}` as TKey)}</button>
              ))}
            </div>
          </div>

          {source !== 'project' ? <div>
            {searchBox(t(source === 'users' ? 'admin.whatsappCrm.findUser' : 'admin.whatsappCrm.findContractor'))}
            {people === null ? <p className="mt-3 flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
              : shownAccounts.length === 0 ? <p className="mt-3 text-xs text-brand-mid-grey">{t('admin.whatsappCrm.noPeople')}</p>
              : <ul className="mt-2 space-y-1">{shownAccounts.map(person => (
                  <li key={person.id}><button type="button" onClick={() => void openPerson(person.id)} disabled={busy} data-person={person.id}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-brand-off-white disabled:opacity-50 dark:hover:bg-[#242424]">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-light-grey text-[11px] font-bold">{initials(person.fullName || person.email)}</span>
                    <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{person.fullName || person.email}</span><RoleTag role={chatRole(person.id, person.roles)} /></span>
                      <span className="block truncate text-xs text-brand-mid-grey">{person.email}{person.projectCount ? ` · ${t('admin.whatsappCrm.projectCount', { n: person.projectCount })}` : ''}</span></span>
                    {busy && <Loader2 className="size-3.5 animate-spin text-brand-mid-grey" aria-hidden />}
                  </button></li>))}</ul>}
            {accounts.length > shownAccounts.length && <p className="mt-2 text-[11px] text-brand-mid-grey">{t('admin.whatsappCrm.moreMatches', { shown: shownAccounts.length, total: accounts.length })}</p>}
            <p className="mt-3 text-xs text-brand-mid-grey">{t('admin.whatsappCrm.directHint')}</p>
          </div> : <>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-brand-muted-grey">{t('admin.whatsappCrm.step1')}</p>
              {project
                ? <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border-[1.5px] border-brand-green bg-brand-green/[0.05] px-3 py-2.5 text-sm">
                    <span className="min-w-0"><span className="block truncate font-semibold">{project.name}</span><span className="text-xs text-brand-mid-grey">{[project.ownerName, project.city].filter(Boolean).join(' · ')}</span></span>
                    <button type="button" onClick={() => { setProject(null); setChoice(null); setNotice(null); }} className="text-xs font-semibold text-brand-green underline" data-action="change-project">{t('admin.whatsappCrm.change')}</button>
                  </div>
                : <>
                  {searchBox(t('admin.whatsappCrm.findProject'))}
                  {projects === null ? <p className="mt-3 flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
                    : matches.length === 0 ? <p className="mt-3 text-xs text-brand-mid-grey">{t('admin.whatsappCrm.noProjects')}</p>
                    : <ul className="mt-2 space-y-1">{matches.map(p => <li key={p.id}><button type="button" onClick={() => setProject(p)} data-project={p.id}
                        className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-brand-off-white dark:hover:bg-[#242424]">
                        <span className="block font-semibold">{p.name}</span><span className="text-xs text-brand-mid-grey">{[p.ownerName, p.city, p.country].filter(Boolean).join(' · ')}</span></button></li>)}</ul>}
                </>}
            </div>
            {project && <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-brand-muted-grey">{t('admin.whatsappCrm.step2')}</p>
              {choice
                ? <ul className="mt-2 space-y-1">{choice.candidates.map(id => <li key={id}><button type="button" onClick={() => void open(choice.role, id)} disabled={busy} data-candidate={id}
                    className="w-full rounded-xl border border-brand-border-grey px-3 py-2.5 text-left text-sm font-semibold hover:border-brand-green disabled:opacity-40 dark:border-[#2c2c2c]">{nameOf(id)}</button></li>)}</ul>
                : <div className="mt-2 grid gap-2 sm:grid-cols-3">{(['client', 'contractor', 'verifier'] as const).map(role => (
                    <button key={role} type="button" onClick={() => void open(role)} disabled={busy} data-role={role}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-3 text-sm font-semibold hover:border-brand-green disabled:opacity-40 dark:border-[#2c2c2c]">
                      {busy && <Loader2 className="size-3.5 animate-spin" />}{t(`admin.whatsappCrm.to.${role}` as TKey)}</button>))}</div>}
              <p className="mt-2 text-xs text-brand-mid-grey">{t('admin.whatsappCrm.newChatHint')}</p>
            </div>}
          </>}
          {notice && <p role="alert" className="rounded-lg border border-state-alert/30 p-3 text-sm text-state-alert">{notice}</p>}
        </div>
      </div>
    </div>
  );
}
