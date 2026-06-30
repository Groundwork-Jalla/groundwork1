import { useState } from "react";
import { Link } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SKOOL_URL = "https://www.skool.com/jalla-community-1888/about";

function BlueprintPanel() {
  return (
    <div className="relative w-full h-full flex flex-col justify-between p-10" style={{ backgroundColor: "#0B1526" }}>
      {/* Blueprint SVG fills entire background */}
      <svg
        viewBox="0 0 600 800"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        {/* Grid background */}
        <defs>
          <pattern id="bp-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.4" strokeOpacity="0.06" />
          </pattern>
        </defs>
        <rect width="600" height="800" fill="url(#bp-grid)" />

        {/* ── OUTER WALLS ── */}
        <rect x="80" y="100" width="440" height="580" fill="none" stroke="white" strokeWidth="2.5" strokeOpacity="0.5" />

        {/* ── INTERIOR HORIZONTAL WALLS ── */}
        <line x1="80"  y1="280" x2="380" y2="280" stroke="white" strokeWidth="1.8" strokeOpacity="0.4" />
        <line x1="80"  y1="460" x2="520" y2="460" stroke="white" strokeWidth="1.8" strokeOpacity="0.4" />
        <line x1="240" y1="460" x2="240" y2="680" stroke="white" strokeWidth="1.8" strokeOpacity="0.4" />

        {/* ── INTERIOR VERTICAL WALLS ── */}
        <line x1="280" y1="100" x2="280" y2="460" stroke="white" strokeWidth="1.8" strokeOpacity="0.4" />
        <line x1="380" y1="100" x2="380" y2="460" stroke="white" strokeWidth="1.8" strokeOpacity="0.4" />

        {/* ── ROOM FILLS (very subtle) ── */}
        <rect x="81"  y="101" width="198" height="178" fill="white" fillOpacity="0.018" />
        <rect x="281" y="101" width="98"  height="178" fill="white" fillOpacity="0.022" />
        <rect x="381" y="101" width="138" height="358" fill="white" fillOpacity="0.014" />
        <rect x="81"  y="281" width="458" height="178" fill="white" fillOpacity="0.016" />
        <rect x="81"  y="461" width="158" height="218" fill="white" fillOpacity="0.018" />
        <rect x="241" y="461" width="278" height="218" fill="white" fillOpacity="0.014" />

        {/* ── DOOR ARCS ── */}
        <path d="M280 280 A40 40 0 0 0 240 240" fill="none" stroke="white" strokeWidth="1" strokeOpacity="0.25" strokeDasharray="4 3" />
        <path d="M380 460 A36 36 0 0 1 416 424" fill="none" stroke="white" strokeWidth="1" strokeOpacity="0.25" strokeDasharray="4 3" />
        <path d="M240 461 A36 36 0 0 0 204 497" fill="none" stroke="white" strokeWidth="1" strokeOpacity="0.25" strokeDasharray="4 3" />

        {/* ── TOP DIMENSION LINE ── */}
        <line x1="80"  y1="68" x2="280" y2="68" stroke="white" strokeWidth="1"   strokeOpacity="0.35" />
        <line x1="280" y1="68" x2="380" y2="68" stroke="white" strokeWidth="1"   strokeOpacity="0.35" />
        <line x1="380" y1="68" x2="520" y2="68" stroke="white" strokeWidth="1"   strokeOpacity="0.35" />
        {[80, 280, 380, 520].map((x) => (
          <line key={x} x1={x} y1="62" x2={x} y2="74" stroke="white" strokeWidth="1" strokeOpacity="0.35" />
        ))}
        <text x="180" y="58" textAnchor="middle" fontSize="10" fill="white" fillOpacity="0.45" fontFamily="Satoshi, sans-serif">7,200</text>
        <text x="330" y="58" textAnchor="middle" fontSize="10" fill="white" fillOpacity="0.45" fontFamily="Satoshi, sans-serif">2,500</text>
        <text x="450" y="58" textAnchor="middle" fontSize="10" fill="white" fillOpacity="0.45" fontFamily="Satoshi, sans-serif">4,400</text>

        {/* ── LEFT DIMENSION LINE ── */}
        <line x1="44" y1="100" x2="44" y2="280" stroke="white" strokeWidth="1" strokeOpacity="0.35" />
        <line x1="44" y1="280" x2="44" y2="460" stroke="white" strokeWidth="1" strokeOpacity="0.35" />
        <line x1="44" y1="460" x2="44" y2="680" stroke="white" strokeWidth="1" strokeOpacity="0.35" />
        {[100, 280, 460, 680].map((y) => (
          <line key={y} x1="38" y1={y} x2="50" y2={y} stroke="white" strokeWidth="1" strokeOpacity="0.35" />
        ))}
        <text x="28" y="195" textAnchor="middle" fontSize="10" fill="white" fillOpacity="0.45" fontFamily="Satoshi, sans-serif" transform="rotate(-90 28 195)">3,600</text>
        <text x="28" y="375" textAnchor="middle" fontSize="10" fill="white" fillOpacity="0.45" fontFamily="Satoshi, sans-serif" transform="rotate(-90 28 375)">5,400</text>
        <text x="28" y="575" textAnchor="middle" fontSize="10" fill="white" fillOpacity="0.45" fontFamily="Satoshi, sans-serif" transform="rotate(-90 28 575)">1,800</text>

        {/* ── ROOM NUMBER CIRCLES ── */}
        {[
          { cx: 180, cy: 190, n: "1" },
          { cx: 330, cy: 190, n: "2" },
          { cx: 450, cy: 280, n: "3" },
          { cx: 300, cy: 370, n: "4" },
          { cx: 160, cy: 570, n: "5" },
          { cx: 380, cy: 570, n: "6" },
        ].map(({ cx, cy, n }) => (
          <g key={n}>
            <circle cx={cx} cy={cy} r="16" fill="none" stroke="white" strokeWidth="1.2" strokeOpacity="0.3" />
            <text x={cx} y={cy + 5} textAnchor="middle" fontSize="12" fill="white" fillOpacity="0.45" fontFamily="Satoshi, sans-serif">{n}</text>
          </g>
        ))}

        {/* ── WINDOW MARKS ── */}
        {[
          { x1: 120, y1: 100, x2: 200, y2: 100 },
          { x1: 320, y1: 100, x2: 370, y2: 100 },
          { x1: 420, y1: 100, x2: 480, y2: 100 },
          { x1: 80,  y1: 160, x2: 80,  y2: 220 },
          { x1: 520, y1: 200, x2: 520, y2: 340 },
        ].map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="white" strokeWidth="4" strokeOpacity="0.3" strokeLinecap="square" />
        ))}
      </svg>

      {/* Branding — top left, above SVG */}
      <div className="relative z-10">
        <div className="flex items-baseline gap-1.5">
          <span className="font-sans text-lg font-semibold text-white">Groundwork</span>
          <span className="text-[11px] text-white/40">by Jalla</span>
        </div>
      </div>

      {/* Testimonial — bottom, above SVG */}
      <div className="relative z-10">
        <div className="text-white/30 text-5xl font-serif leading-none mb-3 select-none">"</div>
        <p className="text-white/80 text-sm sm:text-base leading-relaxed max-w-75">
          Groundwork has become the single source of truth across our projects.
          It keeps our teams aligned, our docs organized, and our builds on track.
        </p>
        <div className="mt-5 h-px w-8 bg-white/25 mb-4" />
        <p className="text-sm font-semibold text-white">Michael Rivera</p>
        <p className="text-xs text-white/45 mt-0.5">Project Executive, BuildCore</p>
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
    <div className="flex h-screen overflow-hidden">

      {/* LEFT — dark blueprint panel, pinned full height */}
      <div className="hidden lg:flex lg:w-[44%] xl:w-[46%] h-full shrink-0">
        <BlueprintPanel />
      </div>

      {/* RIGHT — scrollable form panel */}
      <div className="flex-1 bg-white overflow-y-auto">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center justify-between px-6 py-5 border-b border-brand-border-grey">
          <div className="flex items-baseline gap-1.5">
            <span className="font-sans text-lg font-semibold text-brand-near-black">Groundwork</span>
            <span className="text-[11px] text-brand-mid-grey">by Jalla</span>
          </div>
          <Link to="/" className="text-sm text-brand-mid-grey hover:text-brand-near-black transition-colors">
            ← Home
          </Link>
        </div>

        {/* Form centred vertically */}
        <div className="flex items-center justify-center min-h-full px-8 py-16">
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

                  <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
                    Join the Community
                  </h1>
                  <p className="text-sm text-brand-mid-grey mt-2 mb-8 leading-relaxed">
                    Be among the first Africans to build with Groundwork — and get notified the moment we launch.
                  </p>

                  <form onSubmit={handleSubmit} className="space-y-4">
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

                  <p className="text-xs text-brand-mid-grey text-center mt-6 leading-relaxed">
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
