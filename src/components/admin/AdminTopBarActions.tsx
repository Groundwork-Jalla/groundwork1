import { useState } from 'react';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { WhatsAppIcon } from '@/components/ui/WhatsAppIcon';
import { useT } from '@/lib/i18n';

// =========================================================
// The admin top bar's actions: WhatsApp · New · notifications.
//
// Both controls go somewhere real. WhatsApp opens the Inbox's WhatsApp channel — the
// conversation model (091) carries `channel`, so the filter is a real view of real rows.
//
// It pointed at `/admin/whatsapp` until the Inbox shipped, when the per-channel
// placeholders were removed and the sidebar moved to `?channel=`. This link was missed,
// and the `admin/:section` catch-all then served it as "There is no such section" — a
// dead end that no link check could see, because the catch-all matches every /admin/*
// path. `admin-links.test.ts` now excludes it for exactly that reason.
// "New" offers only what an admin can actually create today: a project and a client
// account, both existing routes. Nothing here reports a connection status — a badge
// saying "connected" that nothing proves is exactly the fiction we refuse.
//
// WhatsApp keeps its own green in both themes (Favour, 14 Sep 2026) — the one brand
// exception to the monochrome icon rule. See ui/WhatsAppIcon.tsx.
// =========================================================

export function AdminTopBarActions({ userId }: { userId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Link
        to="/admin/inbox?channel=whatsapp"
        title={t('admin.header.whatsapp')}
        aria-label={t('admin.header.whatsapp')}
        className="flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-[#25D366]/10"
      >
        <WhatsAppIcon className="size-4" />
      </Link>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-black dark:bg-white dark:text-brand-near-black dark:hover:bg-white/90"
        >
          <Plus className="size-3.5" />
          {t('admin.header.new')}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div role="menu"
              className="absolute right-0 z-20 mt-1.5 w-52 overflow-hidden rounded-xl border border-brand-border-grey bg-white py-1 shadow-lg dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              <Link to="/admin/projects/new" role="menuitem" onClick={() => setOpen(false)}
                className="block px-3 py-2 text-xs text-brand-near-black transition-colors hover:bg-brand-off-white dark:text-white dark:hover:bg-[#252525]">
                {t('admin.header.newProject')}
              </Link>
              <Link to="/admin/users/new" role="menuitem" onClick={() => setOpen(false)}
                className="block px-3 py-2 text-xs text-brand-near-black transition-colors hover:bg-brand-off-white dark:text-white dark:hover:bg-[#252525]">
                {t('admin.header.newClient')}
              </Link>
            </div>
          </>
        )}
      </div>

      <NotificationBell userId={userId} />
    </>
  );
}
