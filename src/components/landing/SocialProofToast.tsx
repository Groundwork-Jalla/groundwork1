import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const ENTRIES = [
  { name: "Sarah", location: "Lagos", msg: "joined the community" },
  { name: "Michael", location: "London", msg: "joined" },
  { name: "James", location: "Texas", msg: "just signed up" },
  { name: "Anna", location: "Nairobi", msg: "is waiting for launch" },
  { name: "David", location: "Accra", msg: "joined the community" },
  { name: "Grace", location: "Toronto", msg: "signed up" },
  { name: "Emmanuel", location: "Douala", msg: "joined" },
  { name: "Fatima", location: "Dubai", msg: "just signed up" },
];

export default function SocialProofToast() {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(0);
  const indexRef = useRef(0);

  useEffect(() => {
    let showTimeout: ReturnType<typeof setTimeout>;
    let hideTimeout: ReturnType<typeof setTimeout>;

    function cycle() {
      const delay = 8000 + Math.random() * 4000;
      showTimeout = setTimeout(() => {
        setCurrent(indexRef.current % ENTRIES.length);
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
  }, []);

  const entry = ENTRIES[current];

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
              {entry.name[0]}
            </div>

            {/* Name + location */}
            <p className="text-[13px] font-semibold text-brand-near-black mt-3 leading-snug">
              {entry.name}
            </p>
            <p className="text-[11px] text-brand-mid-grey mt-0.5">
              from {entry.location}
            </p>

            {/* Divider */}
            <div className="w-8 h-px bg-brand-border-grey my-3" />

            {/* Action */}
            <p className="text-[12px] text-brand-near-black font-medium">{entry.msg}</p>
            <p className="text-[10px] text-brand-mid-grey/60 mt-1">just now</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
