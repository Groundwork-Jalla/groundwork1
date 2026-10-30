import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, MessageSquare } from 'lucide-react';
import { createSupportTicket } from '@/lib/supabase/support';
import { useT } from '@/lib/i18n';

// =========================================================
// The parts a help page is made of, shared by /help and /work/help.
//
// 30 Oct 2026, Favour: "the help button on the contractor page must not take them
// to client view … on no account should a contractor account see a client dashboard
// view for any reason no matter the button they click on."
//
// Answering that needed a SECOND help page, in the contractor's own shell. Branching
// the question list inside the one route was not enough: the route lives under the
// client layout, so a contractor who pressed Help got contractor answers wrapped in
// the client's sidebar — their own surface replaced by somebody else's.
//
// The accordion, the contact form and the index bookkeeping moved here rather than
// being copied, so a fix to the support form reaches both pages at once.
// =========================================================

export interface FaqItem { q: string; a: string }
export interface FaqSection { heading: string; items: FaqItem[] }

// ── One question ───────────────────────────────────────────

function FaqAccordion({ item, index, openIndex, onToggle }: {
  item: FaqItem; index: number; openIndex: number | null; onToggle: (i: number) => void;
}) {
  const isOpen = openIndex === index;

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(index)}
        aria-expanded={isOpen}
        className="flex items-center justify-between w-full text-left py-3.5 border-b border-brand-border-grey dark:border-[#2c2c2c]"
      >
        <span className="text-sm font-medium text-brand-near-black dark:text-white pr-4">
          {item.q}
        </span>
        <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }} className="shrink-0">
          <ChevronDown className="size-4 text-brand-mid-grey" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="answer"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="text-sm text-brand-mid-grey leading-relaxed pb-4 pt-2">{item.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── The whole list ─────────────────────────────────────────

/**
 * Sections of questions, one open at a time.
 *
 * The open index is flat across sections, so opening a question in "Getting paid"
 * closes the one in "Running a project" rather than leaving two answers on screen.
 */
export function FaqList({ sections }: { sections: FaqSection[] }) {
  const t = useT();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  let offset = 0;
  const numbered = sections.map(section => {
    const at = offset;
    offset += section.items.length;
    return { section, at };
  });

  return (
    <div>
      <h2 className="text-lg font-bold text-brand-near-black dark:text-white mb-4">{t('help.faq')}</h2>
      {numbered.map(({ section, at }) => (
        <div key={section.heading}>
          <p className="text-xs font-semibold text-brand-mid-grey uppercase tracking-widest mt-8 mb-1">
            {section.heading}
          </p>
          {section.items.map((item, i) => (
            <FaqAccordion
              key={at + i}
              item={item}
              index={at + i}
              openIndex={openFaq}
              onToggle={globalIndex => setOpenFaq(prev => (prev === globalIndex ? null : globalIndex))}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Contact form ───────────────────────────────────────────

type FormState = 'idle' | 'submitting' | 'success' | 'error';

export function ContactForm({ userEmail, userId }: { userEmail: string; userId: string | undefined }) {
  const t = useT();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(userEmail);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [formState, setFormState] = useState<FormState>('idle');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormState('submitting');
    // This used to read "graceful degradation": a missing table counted as success, and
    // the bare catch turned ANY failure into "Message sent." The table did not exist, so
    // every message since launch was dropped and every sender was thanked for it. There
    // is nothing graceful about telling someone you have their problem when you do not.
    if (!userId) { setFormState('error'); return; }
    try {
      await createSupportTicket({ userId, name, email, subject, message });
      setFormState('success');
    } catch {
      setFormState('error');
    }
  }

  const inputCls =
    'flex h-10 w-full rounded-md border border-brand-border-grey bg-white dark:bg-[#1c1c1c] dark:border-[#2c2c2c] px-3 py-2 text-sm text-brand-near-black dark:text-white outline-none transition-colors placeholder:text-brand-mid-grey focus-visible:border-brand-near-black dark:focus-visible:border-white';

  if (formState === 'success') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-brand-off-white dark:bg-[#222]">
          <MessageSquare className="size-7 text-brand-near-black dark:text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">{t('help.sent')}</p>
          <p className="text-xs text-brand-mid-grey leading-relaxed max-w-xs mx-auto">{t('help.sentBody')}</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="helpName" className="text-xs font-medium text-brand-near-black dark:text-white">{t('help.name')}</label>
          <input id="helpName" type="text" required placeholder={t('help.yourName')}
            value={name} onChange={e => setName(e.target.value)} className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="helpEmail" className="text-xs font-medium text-brand-near-black dark:text-white">{t('help.email')}</label>
          <input id="helpEmail" type="email" required placeholder="you@example.com"
            value={email} onChange={e => setEmail(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="helpSubject" className="text-xs font-medium text-brand-near-black dark:text-white">{t('help.subject')}</label>
        <input id="helpSubject" type="text" required placeholder={t('help.subjectHint')}
          value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="helpMessage" className="text-xs font-medium text-brand-near-black dark:text-white">{t('help.message')}</label>
        <textarea id="helpMessage" required rows={4} placeholder={t('help.messageHint')}
          value={message} onChange={e => setMessage(e.target.value)}
          className={`${inputCls} h-auto min-h-[100px] resize-y`} />
      </div>

      {formState === 'error' && <p role="alert" className="text-xs text-state-alert">{t('help.sendFailed')}</p>}

      <button
        type="submit"
        disabled={formState === 'submitting'}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black text-sm font-semibold px-5 py-2.5 transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {formState === 'submitting' ? t('help.sending') : t('help.sendMessage')}
      </button>
    </form>
  );
}

/** The support box, identical on both help pages. */
export function ContactBox({ userEmail, userId, innerRef }: {
  userEmail: string; userId: string | undefined; innerRef?: React.Ref<HTMLDivElement>;
}) {
  const t = useT();
  return (
    <div ref={innerRef} id="contact-form"
      className="rounded-2xl border border-brand-border-grey bg-white dark:bg-brand-dark-grey dark:border-[#2c2c2c] p-6">
      <h2 className="text-lg font-bold text-brand-near-black dark:text-white mb-1">{t('help.sendMessage')}</h2>
      <p className="text-xs text-brand-mid-grey mb-6">{t('help.responseTime')}</p>
      <ContactForm userEmail={userEmail} userId={userId} />
    </div>
  );
}
