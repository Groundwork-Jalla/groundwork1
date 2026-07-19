import { Outlet } from "react-router";
import { motion } from "framer-motion";
import { GroundworkLogo } from "@/components/ui/GroundworkLogo";

function ArchDrawing() {
  return (
    <svg
      viewBox="0 0 420 520"
      className="absolute inset-0 w-full h-full"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id="smallGrid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="0.25" opacity="0.15" />
        </pattern>
        <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
          <rect width="100" height="100" fill="url(#smallGrid)" />
          <path d="M 100 0 L 0 0 0 100" fill="none" stroke="white" strokeWidth="0.6" opacity="0.22" />
        </pattern>
      </defs>
      <rect width="420" height="520" fill="url(#grid)" />

      {/* ── Floor plan ── */}
      <rect x="40" y="60" width="240" height="180" fill="none" stroke="white" strokeWidth="2.5" opacity="0.6" />
      <line x1="120" y1="60" x2="120" y2="240" stroke="white" strokeWidth="1.8" opacity="0.5" />
      <line x1="200" y1="60" x2="200" y2="170" stroke="white" strokeWidth="1.8" opacity="0.5" />
      <line x1="120" y1="150" x2="280" y2="150" stroke="white" strokeWidth="1.8" opacity="0.5" />
      <line x1="200" y1="150" x2="200" y2="240" stroke="white" strokeWidth="1.8" opacity="0.5" />

      {/* Door arcs */}
      <path d="M 120 90 Q 140 90 140 110" fill="none" stroke="white" strokeWidth="1.2" opacity="0.5" />
      <line x1="120" y1="90" x2="140" y2="90" stroke="white" strokeWidth="1.2" opacity="0.5" />
      <path d="M 200 90 Q 200 110 220 110" fill="none" stroke="white" strokeWidth="1.2" opacity="0.5" />
      <line x1="200" y1="90" x2="200" y2="110" stroke="white" strokeWidth="1.2" opacity="0.5" />

      {/* Window breaks */}
      <line x1="155" y1="60" x2="185" y2="60" stroke="rgb(10,10,10)" strokeWidth="4" />
      <line x1="155" y1="60" x2="185" y2="60" stroke="white" strokeWidth="1.2" opacity="0.6" strokeDasharray="5 4" />
      <line x1="220" y1="240" x2="260" y2="240" stroke="rgb(10,10,10)" strokeWidth="4" />
      <line x1="220" y1="240" x2="260" y2="240" stroke="white" strokeWidth="1.2" opacity="0.6" strokeDasharray="5 4" />

      {/* Room labels */}
      <text x="55" y="112" fontSize="8" fill="white" opacity="0.6" fontFamily="monospace" letterSpacing="1">BEDROOM</text>
      <text x="127" y="112" fontSize="8" fill="white" opacity="0.6" fontFamily="monospace" letterSpacing="1">LIVING</text>
      <text x="204" y="112" fontSize="8" fill="white" opacity="0.6" fontFamily="monospace" letterSpacing="1">DINING</text>
      <text x="130" y="200" fontSize="8" fill="white" opacity="0.6" fontFamily="monospace" letterSpacing="1">KITCHEN</text>
      <text x="204" y="200" fontSize="8" fill="white" opacity="0.6" fontFamily="monospace" letterSpacing="1">BATH</text>

      {/* Section cut + north */}
      <line x1="300" y1="60" x2="300" y2="250" stroke="white" strokeWidth="1" strokeDasharray="6 3" opacity="0.35" />
      <text x="304" y="160" fontSize="8" fill="white" opacity="0.45" fontFamily="monospace">A-A</text>
      <line x1="365" y1="90" x2="365" y2="65" stroke="white" strokeWidth="1.2" opacity="0.5" />
      <polygon points="365,62 360,74 365,70 370,74" fill="white" opacity="0.5" />
      <text x="365" y="102" fontSize="8" fill="white" opacity="0.5" fontFamily="monospace" textAnchor="middle">N</text>

      {/* ── Elevation ── */}
      <line x1="40" y1="440" x2="360" y2="440" stroke="white" strokeWidth="1.5" opacity="0.5" />
      <rect x="80" y="320" width="220" height="120" fill="none" stroke="white" strokeWidth="2" opacity="0.55" />
      <polygon points="75,320 190,262 305,320" fill="none" stroke="white" strokeWidth="2" opacity="0.55" />
      <line x1="190" y1="262" x2="190" y2="320" stroke="white" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />

      {/* Elevation windows */}
      <rect x="98" y="344" width="38" height="42" fill="none" stroke="white" strokeWidth="1.4" opacity="0.55" />
      <line x1="117" y1="344" x2="117" y2="386" stroke="white" strokeWidth="0.8" opacity="0.4" />
      <line x1="98" y1="365" x2="136" y2="365" stroke="white" strokeWidth="0.8" opacity="0.4" />

      <rect x="171" y="344" width="38" height="42" fill="none" stroke="white" strokeWidth="1.4" opacity="0.55" />
      <line x1="190" y1="344" x2="190" y2="386" stroke="white" strokeWidth="0.8" opacity="0.4" />
      <line x1="171" y1="365" x2="209" y2="365" stroke="white" strokeWidth="0.8" opacity="0.4" />

      <rect x="244" y="344" width="38" height="42" fill="none" stroke="white" strokeWidth="1.4" opacity="0.55" />
      <line x1="263" y1="344" x2="263" y2="386" stroke="white" strokeWidth="0.8" opacity="0.4" />
      <line x1="244" y1="365" x2="282" y2="365" stroke="white" strokeWidth="0.8" opacity="0.4" />

      {/* Door */}
      <rect x="168" y="393" width="44" height="47" fill="none" stroke="white" strokeWidth="1.4" opacity="0.55" />
      <path d="M 168 393 Q 190 393 190 415" fill="none" stroke="white" strokeWidth="0.9" opacity="0.35" />

      {/* Dimension lines */}
      <line x1="80" y1="455" x2="300" y2="455" stroke="white" strokeWidth="0.9" opacity="0.45" />
      <line x1="80" y1="450" x2="80" y2="460" stroke="white" strokeWidth="0.9" opacity="0.45" />
      <line x1="300" y1="450" x2="300" y2="460" stroke="white" strokeWidth="0.9" opacity="0.45" />
      <text x="190" y="468" fontSize="8" fill="white" opacity="0.55" fontFamily="monospace" textAnchor="middle">12 000</text>

      <line x1="52" y1="262" x2="52" y2="440" stroke="white" strokeWidth="0.9" opacity="0.45" />
      <line x1="47" y1="262" x2="57" y2="262" stroke="white" strokeWidth="0.9" opacity="0.45" />
      <line x1="47" y1="440" x2="57" y2="440" stroke="white" strokeWidth="0.9" opacity="0.45" />
      <text x="44" y="353" fontSize="8" fill="white" opacity="0.55" fontFamily="monospace" textAnchor="middle" transform="rotate(-90 44 353)">8 500</text>

      {/* Drawing border + title block */}
      <rect x="8" y="8" width="404" height="504" fill="none" stroke="white" strokeWidth="0.8" opacity="0.25" />
      <line x1="8" y1="480" x2="412" y2="480" stroke="white" strokeWidth="0.8" opacity="0.25" />
      <text x="20" y="494" fontSize="7" fill="white" opacity="0.4" fontFamily="monospace" letterSpacing="1">SITE PLAN + ELEVATION — SCALE 1:100</text>
      <text x="380" y="494" fontSize="7" fill="white" opacity="0.4" fontFamily="monospace" textAnchor="end">GW-01</text>
    </svg>
  );
}

export default function AuthLayout() {
  return (
    <div className="h-dvh overflow-hidden flex flex-col md:flex-row">
      {/* Left — dark branding panel */}
      {/* Mobile: compact header bar | Desktop: full 50% panel with drawing */}
      <div className="relative bg-brand-near-black text-white shrink-0 overflow-hidden
                      flex items-center px-6 py-4
                      md:w-1/2 md:h-full md:block md:p-0">

        {/* Architectural drawing — desktop only */}
        <div className="hidden md:block absolute inset-0">
          <ArchDrawing />
        </div>

        {/* Vignette — desktop only */}
        <div
          className="hidden md:block absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 85% 65% at 50% 48%, transparent 0%, rgba(10,10,10,0.58) 100%)',
          }}
        />

        {/* Logo — inline on mobile, absolute top-left on desktop */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative z-10 md:absolute md:top-0 md:left-0 md:px-6 md:py-4"
        >
          <GroundworkLogo variant="light" size="md" className="md:hidden" />
          <GroundworkLogo variant="light" size="lg" className="hidden md:inline-flex" />
        </motion.div>

        {/* Tagline — bottom-right, desktop only */}
        <p className="hidden md:block absolute bottom-8 right-8 z-10 text-sm text-white/50 italic text-right max-w-52 leading-relaxed">
          Protect your build.<br />From anywhere.
        </p>
      </div>

      {/* Right — form panel */}
      <div className="flex-1 md:w-1/2 bg-white overflow-y-auto">
        <div className="min-h-full flex items-center justify-center px-6 py-8">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.1 }}
            className="w-full max-w-sm"
          >
            <Outlet />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
