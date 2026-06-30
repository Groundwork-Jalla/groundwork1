import { useState } from "react";
import { Link } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Replace this with your actual Skool community URL
const SKOOL_URL = "https://www.skool.com/groundwork-by-jalla";

function BlueprintPanel() {
  return (
    <div className="relative w-full h-full flex flex-col justify-between p-10 overflow-hidden bg-[#0B1526]">
      {/* Blueprint SVG — top-down floor plan */}
      <div className="absolute inset-0 opacity-80">
        <svg
          viewBox="0 0 520 580"
          className="w-full h-full object-cover"
          aria-hidden="true"
          preserveAspectRatio="xMidYMid slice"
        >
          {/* Grid */}
          <defs>
            <pattern id="bp-grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="white" strokeWidth="0.3" strokeOpacity="0.07" />
            </pattern>
          </defs>
          <rect width="520" height="580" fill="url(#bp-grid)" />

          {/* Outer walls */}
          <rect x="60" y="60" width="400" height="420" fill="none" stroke="white" strokeWidth="2.5" strokeOpacity="0.55" />

          {/* Horizontal dividers */}
          <line x1="60" y1="210" x2="340" y2="210" stroke="white" strokeWidth="1.8" strokeOpacity="0.45" />
          <line x1="60" y1="360" x2="460" y2="360" stroke="white" strokeWidth="1.8" strokeOpacity="0.45" />

          {/* Vertical dividers */}
          <line x1="250" y1="60" x2="250" y2="360" stroke="white" strokeWidth="1.8" strokeOpacity="0.45" />
          <line x1="340" y1="60" x2="340" y2="480" stroke="white" strokeWidth="1.8" strokeOpacity="0.45" />

          {/* Door arcs */}
          <path d="M250 210 A30 30 0 0 0 220 180" fill="none" stroke="white" strokeWidth="1" strokeOpacity="0.3" strokeDasharray="3 3" />
          <path d="M340 360 A30 30 0 0 1 370 330" fill="none" stroke="white" strokeWidth="1" strokeOpacity="0.3" strokeDasharray="3 3" />

          {/* Dimension lines — top */}
          <line x1="60" y1="34" x2="250" y2="34" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="250" y1="34" x2="340" y2="34" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="340" y1="34" x2="460" y2="34" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="60" y1="28" x2="60" y2="40" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="250" y1="28" x2="250" y2="40" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="340" y1="28" x2="340" y2="40" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="460" y1="28" x2="460" y2="40" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <text x="152" y="26" textAnchor="middle" fontSize="9" fill="white" fillOpacity="0.5" fontFamily="Satoshi, sans-serif">7,200</text>
          <text x="293" y="26" textAnchor="middle" fontSize="9" fill="white" fillOpacity="0.5" fontFamily="Satoshi, sans-serif">2,500</text>
          <text x="398" y="26" textAnchor="middle" fontSize="9" fill="white" fillOpacity="0.5" fontFamily="Satoshi, sans-serif">4,400</text>

          {/* Dimension lines — left */}
          <line x1="34" y1="60" x2="34" y2="210" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="34" y1="210" x2="34" y2="360" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="34" y1="360" x2="34" y2="480" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="28" y1="60" x2="40" y2="60" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="28" y1="210" x2="40" y2="210" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="28" y1="360" x2="40" y2="360" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <line x1="28" y1="480" x2="40" y2="480" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
          <text x="22" y="138" textAnchor="middle" fontSize="9" fill="white" fillOpacity="0.5" fontFamily="Satoshi, sans-serif" transform="rotate(-90 22 138)">3,600</text>
          <text x="22" y="288" textAnchor="middle" fontSize="9" fill="white" fillOpacity="0.5" fontFamily="Satoshi, sans-serif" transform="rotate(-90 22 288)">5,400</text>
          <text x="22" y="422" textAnchor="middle" fontSize="9" fill="white" fillOpacity="0.5" fontFamily="Satoshi, sans-serif" transform="rotate(-90 22 422)">3,600</text>

          {/* Room number circles */}
          {[
            { cx: 152, cy: 135, n: "1" },
            { cx: 294, cy: 135, n: "2" },
            { cx: 152, cy: 285, n: "3" },
            { cx: 398, cy: 420, n: "4" },
          ].map(({ cx, cy, n }) => (
            <g key={n}>
              <circle cx={cx} cy={cy} r="14" fill="none" stroke="white" strokeWidth="1.2" strokeOpacity="0.35" />
              <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fill="white" fillOpacity="0.5" fontFamily="Satoshi, sans-serif">{n}</text>
            </g>
          ))}

          {/* Subtle fill for rooms */}
          <rect x="61" y="61" width="188" height="148" fill="white" fillOpacity="0.02" />
          <rect x="251" y="61" width="88" height="148" fill="white" fillOpacity="0.025" />
          <rect x="341" y="61" width="118" height="148" fill="white" fillOpacity="0.015" />
          <rect x="61" y="211" width="278" height="148" fill="white" fillOpacity="0.02" />
          <rect x="61" y="361" width="278" height="118" fill="white" fillOpacity="0.018" />
          <rect x="341" y="211" width="118" height="268" fill="white" fillOpacity="0.015" />
        </svg>
      </div>

      {/* Branding top-left */}
      <div className="relative z-10">
        <div className="flex items-baseline gap-1.5">
          <span className="font-sans text-lg font-semibold text-white">Groundwork</span>
          <span className="text-[11px] text-white/40">by Jalla</span>
        </div>
      </div>

      {/* Testimonial bottom */}
      <div className="relative z-10">
        <div className="text-white/30 text-4xl font-serif leading-none mb-3">"</div>
        <p className="text-white/80 text-sm leading-relaxed max-w-75">
          Groundwork has become the single source of truth across our projects.
          It keeps our teams aligned, our docs organized, and our builds on track.
        </p>
        <div className="mt-4 h-px w-8 bg-white/25 mb-3" />
        <p className="text-sm font-semibold text-white">Michael Rivera</p>
        <p className="text-xs text-white/45">Project Executive, BuildCore</p>
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
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* LEFT — dark blueprint panel */}
      <div className="hidden lg:block lg:w-[44%] xl:w-[46%] min-h-screen sticky top-0 self-start">
        <BlueprintPanel />
      </div>

      {/* RIGHT — form panel */}
      <div className="flex-1 bg-white flex flex-col min-h-screen">
        {/* Mobile branding strip */}
        <div className="lg:hidden flex items-center justify-between px-6 py-5 border-b border-brand-border-grey">
          <div className="flex items-baseline gap-1.5">
            <span className="font-sans text-lg font-semibold text-brand-near-black">Groundwork</span>
            <span className="text-[11px] text-brand-mid-grey">by Jalla</span>
          </div>
          <Link to="/" className="text-sm text-brand-mid-grey hover:text-brand-near-black transition-colors">
            ← Home
          </Link>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-14">
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
                  <p className="text-sm text-brand-mid-grey mt-2 leading-relaxed">
                    You'll be among the first to know when Groundwork launches. In the meantime, join our community.
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
                  {/* Back link — desktop only */}
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
