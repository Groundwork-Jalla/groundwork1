import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/lib/supabase/client";
import { useDomainLabels } from "@/lib/domain-labels";
import { useFormat, useT } from "@/lib/i18n";

// =========================================================
// Social proof — real signups only.
//
// This used to cycle eight invented people ("Sarah from Lagos", "Michael from
// London"). On a product selling verified, accountable records, inventing the social
// proof on the front door is the one place it cannot be done.
//
// Rows come from `recent_signups()` (migration 045): first name, country and join date.
// The age is stated rather than implied — "Neo joined 79 days ago" — so the whole user
// base can appear without the toast ever claiming more recency than it has. Someone who
// joined moments ago reads "joined just now"; the rest read their real age.
//
// No rows means no toast. An empty product showing nothing is honest; an empty product
// showing fictional crowds is not.
// =========================================================

interface Signup {
  first_name: string;
  country: string | null;
  joined_at: string;
}

/** Below this, "joined just now" rather than a count. */
const JUST_NOW_MS = 2 * 60 * 1000;

/**
 * Age in minutes, hours or DAYS — never months or years.
 *
 * `formatRelative` in lib/format escalates through month and year, which turned a
 * 79-day-old account into "joined 3 months ago". Days are the unit that reads as
 * evidence: "79 days ago" says someone has been here a while and can be checked
 * against, where "3 months ago" is a rounding of it.
 *
 * Still Intl, so the phrasing and the negative-number convention stay localised.
 */
function joinedAgo(iso: string, rtf: Intl.RelativeTimeFormat): string {
  const ms = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(ms / 86_400_000), 'day');
}

/** Picks up someone who signs up while a visitor is already on the page. */
const REFRESH_MS = 60_000;

export default function SocialProofToast() {
  const t = useT();
  const f = useFormat();
  const rtf = useMemo(
    () => new Intl.RelativeTimeFormat(f.locale, { numeric: 'auto' }),
    [f.locale],
  );
  const labels = useDomainLabels();
  const [entries, setEntries] = useState<Signup[]>([]);
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(0);
  const indexRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await supabase.rpc('recent_signups', { max_rows: 12 });
      if (cancelled || error || !Array.isArray(data)) return;
      setEntries(data.filter((d: Signup) => d.first_name));
    }
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (entries.length === 0) return;
    let showTimeout: ReturnType<typeof setTimeout>;
    let hideTimeout: ReturnType<typeof setTimeout>;

    function cycle() {
      const delay = 8000 + Math.random() * 4000;
      showTimeout = setTimeout(() => {
        setCurrent(indexRef.current % entries.length);
        indexRef.current += 1;
        setVisible(true);
        hideTimeout = setTimeout(() => {
          setVisible(false);
          cycle();
        }, 4000);
      }, delay);
    }

    const initial = setTimeout(() => cycle(), 4000);

    return () => {
      clearTimeout(initial);
      clearTimeout(showTimeout);
      clearTimeout(hideTimeout);
    };
  }, [entries.length]);

  const entry = entries[current];
  if (!entry) return null;

  return (
    <div className="fixed bottom-6 left-6 z-40 pointer-events-none">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ y: 60, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 60, opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="flex flex-col items-center text-center bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-brand-border-grey p-4 w-44"
          >
            {/* Avatar */}
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-near-black text-white text-sm font-semibold">
              {entry.first_name[0]?.toUpperCase()}
            </div>

            {/* Name + location */}
            <p className="text-[12px] font-semibold text-brand-near-black mt-2.5 leading-snug">
              {entry.first_name}
            </p>
            {entry.country && (
              <p className="text-[10px] text-brand-mid-grey mt-0.5">
                {t('landing.social.from', { location: labels.country(entry.country) })}
              </p>
            )}

            {/* Divider */}
            <div className="w-6 h-px bg-brand-border-grey my-2.5" />

            {/* Action */}
            <p className="text-[11px] text-brand-near-black font-medium">
              {Date.now() - new Date(entry.joined_at).getTime() < JUST_NOW_MS
                ? t('landing.social.joinedJustNow')
                : t('landing.social.joinedAgo', { when: joinedAgo(entry.joined_at, rtf) })}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
