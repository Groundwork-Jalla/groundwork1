import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/lib/supabase/client";
import { useDomainLabels } from "@/lib/domain-labels";
import { useT } from "@/lib/i18n";

// =========================================================
// Social proof — real signups only.
//
// This used to cycle eight invented people ("Sarah from Lagos", "Michael from
// London"). On a product selling verified, accountable records, inventing the social
// proof on the front door is the one place it cannot be done.
//
// Rows come from `recent_signups()` (migration 044): first name and country of people
// who signed up in the last 30 days, nothing else, and nothing older — the toast says
// "joined just now" and a signup from last quarter would make that untrue.
//
// No rows means no toast. An empty product showing nothing is honest; an empty product
// showing fictional crowds is not.
// =========================================================

interface Signup {
  first_name: string;
  country: string | null;
}

export default function SocialProofToast() {
  const t = useT();
  const labels = useDomainLabels();
  const [entries, setEntries] = useState<Signup[]>([]);
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(0);
  const indexRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc('recent_signups', { max_rows: 8 });
      if (cancelled || error || !Array.isArray(data)) return;
      setEntries(data.filter((d: Signup) => d.first_name));
    })();
    return () => { cancelled = true; };
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
            className="flex flex-col items-center text-center bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-brand-border-grey p-6 w-52"
          >
            {/* Avatar */}
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-near-black text-white text-base font-semibold">
              {entry.first_name[0]?.toUpperCase()}
            </div>

            {/* Name + location */}
            <p className="text-[13px] font-semibold text-brand-near-black mt-3 leading-snug">
              {entry.first_name}
            </p>
            <p className="text-[11px] text-brand-mid-grey mt-0.5">
              {t('landing.social.from', { location: entry.location })}
            </p>

            {/* Divider */}
            <div className="w-8 h-px bg-brand-border-grey my-3" />

            {/* Action */}
            <p className="text-[12px] text-brand-near-black font-medium">{t(entry.msgKey)}</p>
            <p className="text-[10px] text-brand-mid-grey/60 mt-1">{t('landing.social.justNow')}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
