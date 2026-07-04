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
    <div className="fixed bottom-4 left-4 z-40 pointer-events-none">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col items-center bg-white rounded-xl shadow-lg border border-brand-border-grey px-4 py-4 text-center w-45"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-near-black text-white text-sm font-semibold">
              {entry.name[0]}
            </div>
            <p className="text-[12px] font-semibold text-brand-near-black mt-2.5 leading-snug">
              {entry.name} from {entry.location}
            </p>
            <p className="text-[11px] text-brand-mid-grey mt-0.5">{entry.msg}</p>
            <p className="text-[10px] text-brand-mid-grey/60 mt-1">just now</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
