import { useRef } from "react";
import { useInView } from "framer-motion";

function useScrollTrigger() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  return [ref, inView] as const;
}

const bars = [
  { x: 10, h: 88 },
  { x: 46, h: 68 },
  { x: 82, h: 52 },
  { x: 118, h: 36 },
  { x: 154, h: 20 },
];
const BASELINE = 124;

export function BudgetScene() {
  const [ref, inView] = useScrollTrigger();
  return (
    <svg ref={ref} viewBox="0 0 220 160" className="w-full h-40" aria-hidden="true">
      <line x1="4" y1="30" x2="200" y2="30" stroke="white" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="4 4" />
      <text x="200" y="22" textAnchor="end" fontSize="7" fill="white" opacity="0.4" letterSpacing="0.5">BUDGET LIMIT</text>
      <text x="200" y="14" fontSize="13" fill="white" opacity="0.25">₦</text>
      {bars.map((bar, i) => {
        const topFinal = BASELINE - bar.h;
        return (
          <rect key={i} x={bar.x} y={BASELINE} width="24" height="0" rx="2" fill="white" fillOpacity="0.85">
            {inView && (
              <>
                <animate attributeName="y" from={BASELINE} to={topFinal} dur="0.8s" begin={`${i * 0.15}s`} fill="freeze" />
                <animate attributeName="height" from="0" to={bar.h} dur="0.8s" begin={`${i * 0.15}s`} fill="freeze" />
              </>
            )}
          </rect>
        );
      })}
    </svg>
  );
}

const pipelineCount = 10;
const pipelineStep = (206 - 14) / (pipelineCount - 1);

export function StagesScene() {
  const [ref, inView] = useScrollTrigger();
  const rows = [
    { y: 58, state: "checked" as const },
    { y: 86, state: "checked" as const },
    { y: 114, state: "empty" as const },
  ];

  return (
    <svg ref={ref} viewBox="0 0 220 160" className="w-full h-40" aria-hidden="true">
      {Array.from({ length: pipelineCount - 1 }, (_, i) => (
        <line
          key={i}
          x1={14 + pipelineStep * i}
          y1="26"
          x2={14 + pipelineStep * (i + 1)}
          y2="26"
          stroke="white"
          strokeOpacity="0.15"
          strokeWidth="2"
        />
      ))}
      {Array.from({ length: pipelineCount }, (_, i) => {
        const cx = 14 + pipelineStep * i;
        if (i < 4) return <circle key={i} cx={cx} cy="26" r="6" fill="white" />;
        if (i === 4)
          return (
            <circle key={i} cx={cx} cy="26" r="6" fill="white" fillOpacity="0.35">
              <animate attributeName="fill-opacity" values="0.35;0.7;0.35" dur="1.6s" repeatCount="indefinite" />
            </circle>
          );
        return <circle key={i} cx={cx} cy="26" r="6" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" />;
      })}

      {rows.map((row, i) => (
        <g key={i}>
          <rect x="16" y={row.y - 7} width="14" height="14" rx="3" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" />
          <rect x="40" y={row.y - 4} width="150" height="8" rx="4" fill="white" fillOpacity="0.1" />
          {row.state === "checked" && (
            <path
              d={`M19 ${row.y} L23 ${row.y + 4} L29 ${row.y - 5}`}
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="14"
              strokeDashoffset="14"
            >
              {inView && (
                <animate attributeName="stroke-dashoffset" from="14" to="0" dur="0.5s" begin={`${i * 0.15}s`} fill="freeze" />
              )}
            </path>
          )}
        </g>
      ))}
    </svg>
  );
}

export function ProofScene() {
  return (
    <svg viewBox="0 0 220 160" className="w-full h-40" aria-hidden="true">
      <rect x="18" y="68" width="34" height="24" rx="4" fill="none" stroke="white" strokeOpacity="0.75" strokeWidth="2" />
      <rect x="30" y="64" width="10" height="6" rx="2" fill="none" stroke="white" strokeOpacity="0.75" strokeWidth="2" />
      <circle cx="35" cy="80" r="7" fill="none" stroke="white" strokeOpacity="0.75" strokeWidth="2" />
      {[0, 0.2, 0.4].map((delay, i) => (
        <line
          key={i}
          x1={50 - i * 2}
          y1={72 - i * 4}
          x2={56 - i * 2}
          y2={66 - i * 4}
          stroke="white"
          strokeOpacity="0.4"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <animate attributeName="opacity" values="0;1;0" dur="1.2s" begin={`${delay}s`} repeatCount="indefinite" />
        </line>
      ))}

      <line x1="54" y1="80" x2="96" y2="80" stroke="white" strokeOpacity="0.2" strokeWidth="1.5" strokeDasharray="4 4" />
      <circle r="3" fill="white" cy="80">
        <animate attributeName="cx" values="54;96" dur="1.6s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="1.6s" repeatCount="indefinite" />
      </circle>

      <circle cx="110" cy="80" r="14" fill="none" stroke="white" strokeOpacity="0.5" strokeWidth="1.5">
        <animate attributeName="r" values="14;19;14" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="110" cy="80" r="13" fill="none" stroke="white" strokeWidth="2" />
      <rect x="104" y="78" width="12" height="9" rx="2" fill="white" />
      <path d="M107 78 v-3.5 a3 3 0 0 1 6 0 v3.5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />

      <line x1="124" y1="80" x2="166" y2="80" stroke="white" strokeOpacity="0.2" strokeWidth="1.5" strokeDasharray="4 4" />
      <circle r="3" fill="white" cy="80">
        <animate attributeName="cx" values="124;166" dur="1.6s" begin="0.3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="1.6s" begin="0.3s" repeatCount="indefinite" />
      </circle>

      <rect x="168" y="70" width="36" height="22" rx="3" fill="none" stroke="white" strokeOpacity="0.75" strokeWidth="2" />
      <circle cx="186" cy="81" r="6" fill="none" stroke="white" strokeOpacity="0.75" strokeWidth="1.5" />
    </svg>
  );
}

export function VerifyScene() {
  const [ref, inView] = useScrollTrigger();
  return (
    <svg ref={ref} viewBox="0 0 220 160" className="w-full h-40" aria-hidden="true">
      <rect x="40" y="8" width="140" height="78" rx="4" fill="white" />
      <rect x="40" y="8" width="140" height="16" rx="4" fill="#1A1A1A" />
      <circle cx="110" cy="58" r="18" fill="#1A1A1A" />
      <path
        d="M101 58 L107 65 L120 50"
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="30"
        strokeDashoffset="30"
      >
        {inView && <animate attributeName="stroke-dashoffset" from="30" to="0" dur="0.6s" begin="0.2s" fill="freeze" />}
      </path>
      <circle cx="152" cy="78" r="11" fill="none" stroke="#1A1A1A" strokeWidth="2.5" />
      <line x1="160" y1="86" x2="172" y2="98" stroke="#1A1A1A" strokeWidth="3" strokeLinecap="round" />
      {Array.from({ length: 25 }, (_, i) => {
        const row = Math.floor(i / 5);
        const col = i % 5;
        return (row + col * 2) % 5 < 2 ? (
          <rect key={i} x={85 + col * 8} y={96 + row * 8} width="7" height="7" fill="white" />
        ) : null;
      })}
    </svg>
  );
}

const fixRows = [
  { y: 14, state: "done" as const },
  { y: 36, state: "done" as const },
  { y: 58, state: "flagged" as const },
  { y: 80, state: "done" as const },
  { y: 102, state: "empty" as const },
];

export function FixScene() {
  return (
    <svg viewBox="0 0 220 160" className="w-full h-40" aria-hidden="true">
      {fixRows.map((row, i) => {
        if (row.state === "done") {
          return (
            <g key={i}>
              <circle cx="21" cy={row.y} r="9" fill="white" />
              <path d={`M17 ${row.y} L20 ${row.y + 3} L26 ${row.y - 4}`} fill="none" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="38" y={row.y - 5} width="130" height="10" rx="5" fill="white" fillOpacity="0.1" />
            </g>
          );
        }
        if (row.state === "empty") {
          return (
            <g key={i}>
              <circle cx="21" cy={row.y} r="9" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" />
              <rect x="38" y={row.y - 5} width="130" height="10" rx="5" fill="white" fillOpacity="0.06" />
            </g>
          );
        }
        return (
          <g key={i}>
            <polygon points={`21,${row.y - 8} 13,${row.y + 8} 29,${row.y + 8}`} fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round">
              <animate attributeName="opacity" values="1;0.4;1" dur="1.6s" repeatCount="indefinite" />
            </polygon>
            <text x="38" y={row.y + 4} fontSize="10" fontWeight="700" fill="white">FLAGGED</text>
          </g>
        );
      })}

      <path d="M178 58 C 200 70, 200 110, 185 124" stroke="white" strokeOpacity="0.5" strokeWidth="1.5" fill="none" strokeDasharray="4 3" />
      <rect x="160" y="118" width="50" height="22" rx="6" fill="white" fillOpacity="0.1" stroke="white" strokeOpacity="0.3" strokeWidth="1" />
      <polygon points="168,118 162,110 174,118" fill="white" fillOpacity="0.1" stroke="white" strokeOpacity="0.3" strokeWidth="1" />
      <text x="185" y="132" textAnchor="middle" fontSize="9" fill="white">Fix this</text>
    </svg>
  );
}
