import { useState } from "react";
import { Link } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CountdownClock from "@/components/landing/CountdownClock";

const SKOOL_URL = "https://www.skool.com/jalla-community-1888/about";

function BlueprintPanel() {
  return (
    <div className="relative w-full h-full overflow-hidden" style={{ backgroundColor: "#0a0a0a" }}>
      {/* Blueprint — faint watermark, no bounding box, extends to edges */}
      <svg
        viewBox="0 0 520 700"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        {/* Fine grid */}
        <defs>
          <pattern id="bp-grid" width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M 36 0 L 0 0 0 36" fill="none" stroke="white" strokeWidth="0.3" strokeOpacity="0.05" />
          </pattern>
        </defs>
        <rect width="520" height="700" fill="url(#bp-grid)" />

        {/* Interior walls only — no outer bounding rect, so plan bleeds to edges */}
        {/* Horizontal partitions */}
        <line x1="-20"  y1="200" x2="360" y2="200" stroke="white" strokeWidth="1.4" strokeOpacity="0.14" />
        <line x1="0"    y1="390" x2="540" y2="390" stroke="white" strokeWidth="1.4" strokeOpacity="0.14" />
        <line x1="200"  y1="390" x2="200" y2="710" stroke="white" strokeWidth="1.4" strokeOpacity="0.14" />
        <line x1="0"    y1="560" x2="540" y2="560" stroke="white" strokeWidth="1.4" strokeOpacity="0.10" />

        {/* Vertical partitions */}
        <line x1="240" y1="-20"  x2="240" y2="390" stroke="white" strokeWidth="1.4" strokeOpacity="0.14" />
        <line x1="360" y1="-20"  x2="360" y2="560" stroke="white" strokeWidth="1.4" strokeOpacity="0.14" />

        {/* Outer edges (bleed off-canvas so no visible box) */}
        <line x1="-20" y1="-20"  x2="-20" y2="710"  stroke="white" strokeWidth="2"   strokeOpacity="0.12" />
        <line x1="-20" y1="-20"  x2="540" y2="-20"  stroke="white" strokeWidth="2"   strokeOpacity="0.12" />
        <line x1="520" y1="-20"  x2="520" y2="710"  stroke="white" strokeWidth="2"   strokeOpacity="0.12" />
        <line x1="-20" y1="700"  x2="540" y2="700"  stroke="white" strokeWidth="2"   strokeOpacity="0.12" />

        {/* Door arcs — very faint */}
        <path d="M240 200 A38 38 0 0 0 202 162" fill="none" stroke="white" strokeWidth="0.8" strokeOpacity="0.12" strokeDasharray="4 3" />
        <path d="M360 390 A34 34 0 0 1 394 356" fill="none" stroke="white" strokeWidth="0.8" strokeOpacity="0.12" strokeDasharray="4 3" />
        <path d="M200 390 A34 34 0 0 0 166 424" fill="none" stroke="white" strokeWidth="0.8" strokeOpacity="0.12" strokeDasharray="4 3" />

        {/* Top dimension line */}
        <line x1="-20" y1="14"  x2="240" y2="14"  stroke="white" strokeWidth="0.8" strokeOpacity="0.2" />
        <line x1="240" y1="14"  x2="360" y2="14"  stroke="white" strokeWidth="0.8" strokeOpacity="0.2" />
        <line x1="360" y1="14"  x2="540" y2="14"  stroke="white" strokeWidth="0.8" strokeOpacity="0.2" />
        {[0, 240, 360, 520].map((x) => (
          <line key={x} x1={x} y1="8" x2={x} y2="20" stroke="white" strokeWidth="0.8" strokeOpacity="0.2" />
        ))}
        <text x="118"  y="9" textAnchor="middle" fontSize="8.5" fill="white" fillOpacity="0.3" fontFamily="'Plus Jakarta Sans', sans-serif">7,200</text>
        <text x="300"  y="9" textAnchor="middle" fontSize="8.5" fill="white" fillOpacity="0.3" fontFamily="'Plus Jakarta Sans', sans-serif">2,500</text>
        <text x="440"  y="9" textAnchor="middle" fontSize="8.5" fill="white" fillOpacity="0.3" fontFamily="'Plus Jakarta Sans', sans-serif">4,400</text>

        {/* Left dimension line */}
        <line x1="14" y1="-20"  x2="14" y2="200"  stroke="white" strokeWidth="0.8" strokeOpacity="0.2" />
        <line x1="14" y1="200"  x2="14" y2="390"  stroke="white" strokeWidth="0.8" strokeOpacity="0.2" />
        <line x1="14" y1="390"  x2="14" y2="560"  stroke="white" strokeWidth="0.8" strokeOpacity="0.2" />
        <line x1="14" y1="560"  x2="14" y2="710"  stroke="white" strokeWidth="0.8" strokeOpacity="0.2" />
        {[0, 200, 390, 560, 700].map((y) => (
          <line key={y} x1="8" y1={y} x2="20" y2={y} stroke="white" strokeWidth="0.8" strokeOpacity="0.2" />
        ))}
        <text x="8" y="106" textAnchor="middle" fontSize="8.5" fill="white" fillOpacity="0.3" fontFamily="'Plus Jakarta Sans', sans-serif" transform="rotate(-90 8 106)">3,600</text>
        <text x="8" y="298" textAnchor="middle" fontSize="8.5" fill="white" fillOpacity="0.3" fontFamily="'Plus Jakarta Sans', sans-serif" transform="rotate(-90 8 298)">7,200</text>
        <text x="8" y="480" textAnchor="middle" fontSize="8.5" fill="white" fillOpacity="0.3" fontFamily="'Plus Jakarta Sans', sans-serif" transform="rotate(-90 8 480)">5,400</text>
        <text x="8" y="636" textAnchor="middle" fontSize="8.5" fill="white" fillOpacity="0.3" fontFamily="'Plus Jakarta Sans', sans-serif" transform="rotate(-90 8 636)">1,800</text>

        {/* Room number circles */}
        {[
          { cx: 118, cy: 100, n: "1" },
          { cx: 300, cy: 100, n: "2" },
          { cx: 440, cy: 200, n: "3" },
          { cx: 280, cy: 295, n: "4" },
        ].map(({ cx, cy, n }) => (
          <g key={n}>
            <circle cx={cx} cy={cy} r="14" fill="none" stroke="white" strokeWidth="1" strokeOpacity="0.18" />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fill="white" fillOpacity="0.25" fontFamily="'Plus Jakarta Sans', sans-serif">{n}</text>
          </g>
        ))}

        {/* Window notches on walls */}
        <line x1="60"  y1="-20" x2="140" y2="-20" stroke="white" strokeWidth="3.5" strokeOpacity="0.18" strokeLinecap="square" />
        <line x1="280" y1="-20" x2="340" y2="-20" stroke="white" strokeWidth="3.5" strokeOpacity="0.18" strokeLinecap="square" />
        <line x1="390" y1="-20" x2="460" y2="-20" stroke="white" strokeWidth="3.5" strokeOpacity="0.18" strokeLinecap="square" />
        <line x1="-20" y1="60"  x2="-20" y2="140" stroke="white" strokeWidth="3.5" strokeOpacity="0.18" strokeLinecap="square" />
        <line x1="520" y1="120" x2="520" y2="260" stroke="white" strokeWidth="3.5" strokeOpacity="0.18" strokeLinecap="square" />
      </svg>

      {/* Content layer */}
      <div className="relative z-10 flex items-center justify-center h-full">
        <div className="flex flex-col leading-none items-start">
          <span className="font-sans text-2xl sm:text-3xl font-black text-white tracking-tight">Groundwork</span>
          <span className="text-[11px] sm:text-sm text-white/50 font-normal mt-0.5">by Jalla</span>
        </div>
      </div>
    </div>
  );
}

export default function Community() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: emailError } = await supabase.from("waitlist_emails").insert({ email });
    if (emailError) {
      setSubmitting(false);
      setError(emailError.code === "23505" ? "You're already on the list." : emailError.message);
      return;
    }

    await supabase.from("waitlist_members").insert({ name: name || null, location: location || null });

    setSubmitting(false);
    setSubmitted(true);
  }

  return (
    /* Full viewport, no scroll on the outer shell — left panel is pinned, right scrolls */
    <div className="flex h-dvh overflow-hidden">

      {/* LEFT — dark blueprint panel, pinned full height */}
      <div className="hidden lg:flex lg:w-[44%] xl:w-[46%] h-full shrink-0">
        <BlueprintPanel />
      </div>

      {/* RIGHT — locked on desktop; scrollable within panel on small screens */}
      <div className="flex-1 bg-white overflow-y-auto flex flex-col">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center justify-between bg-brand-near-black px-6 py-3.5 border-b border-white/10">
          <div className="flex flex-col leading-none">
            <span className="font-sans text-lg font-black text-white tracking-tight">Groundwork</span>
            <span className="text-[10px] text-white/50 font-normal mt-0.5">by Jalla</span>
          </div>
          <Link to="/" className="text-sm text-white/60 hover:text-white transition-colors">
            ← Home
          </Link>
        </div>

        {/* Form centred vertically */}
        <div className="flex-1 flex items-center justify-center px-5 sm:px-8 py-6">
          <div className="w-full max-w-sm">
            <AnimatePresence mode="wait">
              {submitted ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45 }}
                  className="text-center"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.1, duration: 0.4, ease: "backOut" }}
                    className="inline-flex items-center justify-center size-14 rounded-full bg-brand-near-black text-white mx-auto mb-5"
                  >
                    <CheckCircle2 className="size-6" />
                  </motion.div>
                  <h1 className="font-sans text-2xl font-bold text-brand-near-black">You're in.</h1>
                  <p className="text-sm text-brand-mid-grey mt-2 leading-relaxed max-w-xs mx-auto">
                    You'll be among the first to know when Groundwork launches. In the meantime, join the community.
                  </p>
                  <a
                    href={SKOOL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 inline-flex items-center gap-2 bg-brand-near-black text-white text-sm font-semibold px-6 py-3 rounded-lg hover:bg-brand-black transition-colors group"
                  >
                    Join the Community
                    <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </a>
                  <div className="mt-4">
                    <Link to="/" className="text-xs text-brand-mid-grey underline underline-offset-4 hover:text-brand-near-black transition-colors">
                      Back to Home
                    </Link>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <Link
                    to="/"
                    className="hidden lg:inline-flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black transition-colors mb-8"
                  >
                    ← Back to Home
                  </Link>

                  <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight mb-4">
                    Join the Community
                  </h1>

                  <div className="mb-4">
                    <CountdownClock variant="dark" />
                  </div>

                  <p className="text-sm text-brand-mid-grey mt-1 mb-5 leading-relaxed">
                    We're putting on the finishing touches. Join the community and be one of the first to access Groundwork when we launch.
                  </p>

                  <form onSubmit={handleSubmit} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="name">Full name</Label>
                      <Input
                        id="name"
                        type="text"
                        autoComplete="name"
                        placeholder="Your name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email address</Label>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="location">
                        Where are you building?{" "}
                        <span className="text-brand-soft-grey font-normal">(optional)</span>
                      </Label>
                      <Input
                        id="location"
                        type="text"
                        placeholder="e.g. Lagos, Nigeria"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                      />
                    </div>

                    {error && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-sm text-brand-near-black bg-brand-light-grey rounded-md px-3 py-2"
                      >
                        {error}
                      </motion.p>
                    )}

                    <Button
                      type="submit"
                      disabled={submitting}
                      className="w-full bg-brand-near-black text-white hover:bg-brand-black font-semibold py-3 h-auto group"
                    >
                      {submitting ? "Joining…" : (
                        <span className="flex items-center justify-center gap-2">
                          Join for Free
                          <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                        </span>
                      )}
                    </Button>
                  </form>

                  <p className="text-xs text-brand-mid-grey text-center mt-3 leading-relaxed">
                    No spam. Just early access and launch updates.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
