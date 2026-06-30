import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Users } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Reveal } from "./Reveal";

type Member = {
  id: string;
  name: string | null;
  location: string | null;
  created_at: string;
};

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function SocialProofFeed() {
  const [members, setMembers] = useState<Member[]>([]);
  const [, setTick] = useState(0);

  useEffect(() => {
    supabase
      .from("waitlist_members")
      .select("id, name, location, created_at")
      .order("created_at", { ascending: false })
      .limit(6)
      .then(({ data }) => {
        if (data) setMembers(data);
      });

    const channel = supabase
      .channel("waitlist_members_feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "waitlist_members" },
        (payload) => {
          setMembers((prev) => [payload.new as Member, ...prev].slice(0, 6));
        }
      )
      .subscribe();

    const refreshTimer = setInterval(() => setTick((t) => t + 1), 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(refreshTimer);
    };
  }, []);

  return (
    <section className="bg-brand-off-white border-t border-brand-border-grey py-16 px-7">
      <div className="max-w-[600px] mx-auto">
        <Reveal className="text-center mb-8">
          <div className="inline-flex items-center justify-center size-10 rounded-full bg-brand-near-black text-white mb-3">
            <Users className="size-4" />
          </div>
          <h2 className="font-sans text-2xl font-bold text-brand-near-black">
            Builders Are Already Joining
          </h2>
          <p className="text-brand-mid-grey mt-2 text-sm">Real people getting notified the moment we launch.</p>
        </Reveal>

        {members.length === 0 ? (
          <p className="text-center text-sm text-brand-mid-grey">Be the first to join the community.</p>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {members.map((member) => (
                <motion.li
                  key={member.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex items-center justify-between gap-3 bg-white border border-brand-border-grey rounded-lg px-4 py-2.5"
                >
                  <span className="text-sm text-brand-near-black font-medium">
                    {member.name || "A builder"}
                    {member.location ? (
                      <span className="text-brand-mid-grey font-normal"> from {member.location}</span>
                    ) : null}{" "}
                    just joined
                  </span>
                  <span className="text-xs text-brand-mid-grey shrink-0">{timeAgo(member.created_at)}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  );
}
