import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";

function useScrollTrigger() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return [ref, inView] as const;
}

// SMIL <animate> elements that are conditionally mounted (once inView) don't
// reliably honor a non-zero `begin` offset in Chrome. Instead we stage the
// reveal in React with setTimeout, and every <animate> always uses begin="0s"
// (fires immediately on mount, which is reliable).
function useStaggered(active: boolean, delaysMs: number[]) {
  const [flags, setFlags] = useState<boolean[]>(() => delaysMs.map(() => false));
  useEffect(() => {
    if (!active) return;
    const timers = delaysMs.map((d, i) =>
      setTimeout(() => {
        setFlags((prev) => {
          if (prev[i]) return prev;
          const next = [...prev];
          next[i] = true;
          return next;
        });
      }, d)
    );
    return () => timers.forEach(clearTimeout);
  }, [active]);
  return flags;
}

const budgetBars = [
  { label: "Materials  ₦4.2M", width: 220 },
  { label: "Labour  ₦2.8M", width: 180 },
  { label: "Engineering  ₦1.6M", width: 140 },
  { label: "Contingency  ₦1.0M", width: 100 },
  { label: "Permits  ₦0.6M", width: 65 },
];

export function BudgetScene() {
  const [ref, inView] = useScrollTrigger();
  const barFlags = useStaggered(inView, [300, 450, 600, 750, 900]);
  const labelFlags = useStaggered(inView, [850, 1000, 1150, 1300, 1450]);

  return (
    <svg ref={ref} viewBox="0 0 420 340" className="w-full h-auto" aria-hidden="true">
      <path
        d="M30,30 H390 V300 H30 Z M200,30 V160 H390 M30,160 H120 V300"
        fill="none"
        stroke="white"
        strokeOpacity="0.18"
        strokeWidth="1.5"
        strokeDasharray="1830"
        strokeDashoffset="1830"
      >
        {inView && <animate attributeName="stroke-dashoffset" from="1830" to="0" begin="0s" dur="1.6s" fill="freeze" />}
      </path>

      <line x1="260" y1="50" x2="260" y2="290" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" strokeDasharray="4 4" />
      <text x="260" y="42" textAnchor="middle" fontSize="9" fill="white" opacity="0.4" letterSpacing="0.5">
        TOTAL BUDGET
      </text>

      {budgetBars.map((bar, i) => {
        const y = 70 + i * 50;
        return (
          <g key={bar.label}>
            <rect x="40" y={y} width="0" height="14" rx="2" fill="white" fillOpacity="0.85">
              {barFlags[i] && <animate attributeName="width" from="0" to={bar.width} begin="0s" dur="0.7s" fill="freeze" />}
            </rect>
            <text x={40 + bar.width + 10} y={y + 11} fontSize="11" fill="white" opacity="0">
              {labelFlags[i] && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.4s" fill="freeze" />}
              {bar.label}
            </text>
          </g>
        );
      })}

      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 -7;0 0" dur="4s" repeatCount="indefinite" />
        <circle cx="375" cy="50" r="18" fill="white" fillOpacity="0.08" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" />
        <text x="375" y="56" textAnchor="middle" fontSize="16" fill="white" fillOpacity="0.6">₦</text>
      </g>
    </svg>
  );
}

type HouseStage = "land" | "foundation" | "framed" | "complete";

function MiniHouse({ stage, x, y }: { stage: HouseStage; x: number; y: number }) {
  if (stage === "land") {
    return <line x1={x} y1={y + 6} x2={x + 22} y2={y + 6} stroke="white" strokeOpacity="0.5" strokeWidth="1.5" />;
  }
  if (stage === "foundation") {
    return <rect x={x} y={y - 2} width="22" height="10" fill="none" stroke="white" strokeOpacity="0.5" strokeWidth="1.3" />;
  }
  if (stage === "framed") {
    return (
      <>
        <rect x={x} y={y - 2} width="22" height="10" fill="none" stroke="white" strokeOpacity="0.5" strokeWidth="1.3" />
        <polygon points={`${x - 2},${y - 2} ${x + 11},${y - 12} ${x + 24},${y - 2}`} fill="none" stroke="white" strokeOpacity="0.5" strokeWidth="1.3" />
      </>
    );
  }
  return (
    <>
      <rect x={x} y={y - 2} width="22" height="10" fill="none" stroke="white" strokeWidth="1.5" />
      <polygon points={`${x - 2},${y - 2} ${x + 11},${y - 12} ${x + 24},${y - 2}`} fill="none" stroke="white" strokeWidth="1.5" />
      <rect x={x + 9} y={y + 1} width="4" height="7" fill="white" />
      <circle cx={x + 33} cy={y + 2} r="6" fill="white" />
      <path d={`M${x + 30} ${y + 2} L${x + 32} ${y + 4} L${x + 37} ${y - 1}`} fill="none" stroke="#0A0A0A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function stageFor(i: number): HouseStage {
  if (i <= 2) return "land";
  if (i <= 5) return "foundation";
  if (i <= 8) return "framed";
  return "complete";
}

const stageRows = [
  { y: 124, checked: true },
  { y: 138, checked: true },
  { y: 152, checked: false },
  { y: 166, checked: true },
  { y: 180, checked: false },
];

export function StagesScene() {
  const [ref, inView] = useScrollTrigger();
  const nodeCount = 10;
  const step = (320 - 20) / (nodeCount - 1);
  const nodeFlags = useStaggered(
    inView,
    Array.from({ length: nodeCount }, (_, i) => i * 150)
  );
  const panelFlags = useStaggered(inView, [900]);
  const checkFlags = useStaggered(inView, [1100, 1200, 1400]);
  let checkedSeen = -1;

  return (
    <svg ref={ref} viewBox="0 0 420 340" className="w-full h-auto" aria-hidden="true">
      <line x1="70" y1="20" x2="70" y2="320" stroke="white" strokeOpacity="0.15" strokeWidth="2" />

      {Array.from({ length: nodeCount }, (_, i) => {
        const cy = 20 + step * i;
        return (
          <g key={i}>
            <circle cx="70" cy={cy} r="7" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" />
            <circle cx="70" cy={cy} r="7" fill="white" opacity="0">
              {nodeFlags[i] && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.4s" fill="freeze" />}
            </circle>
            <g opacity="0">
              {nodeFlags[i] && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.4s" fill="freeze" />}
              <MiniHouse stage={stageFor(i)} x={95} y={cy} />
            </g>
          </g>
        );
      })}

      <g opacity="0">
        {panelFlags[0] && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.5s" fill="freeze" />}
        <rect x="150" y="110" width="240" height="80" rx="8" fill="white" fillOpacity="0.05" stroke="white" strokeOpacity="0.2" strokeWidth="1" />
        <text x="160" y="124" fontSize="8" fill="white" fillOpacity="0.4" letterSpacing="0.5">SUBSTAGES</text>
        {stageRows.map((row, i) => {
          if (row.checked) checkedSeen += 1;
          const flagIdx = row.checked ? checkedSeen : -1;
          return (
            <g key={i}>
              <rect x="160" y={row.y - 4} width="8" height="8" rx="1.5" fill="none" stroke="white" strokeOpacity="0.4" strokeWidth="1" />
              <rect x="174" y={row.y - 3} width="150" height="6" rx="3" fill="white" fillOpacity="0.08" />
              {row.checked && (
                <path
                  d={`M161 ${row.y} L164 ${row.y + 3} L168 ${row.y - 3}`}
                  fill="none"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="10"
                  strokeDashoffset="10"
                >
                  {flagIdx >= 0 && checkFlags[flagIdx] && (
                    <animate attributeName="stroke-dashoffset" from="10" to="0" begin="0s" dur="0.35s" fill="freeze" />
                  )}
                </path>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export function ProofScene() {
  const [ref, inView] = useScrollTrigger();
  const [evidenceFlag, checkPathFlag, lockFlag, moneyFlag] = useStaggered(inView, [0, 200, 800, 1400]);

  return (
    <svg ref={ref} viewBox="0 0 420 340" className="w-full h-auto" aria-hidden="true">
      <rect x="60" y="90" width="50" height="84" rx="6" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="2" />
      <circle cx="85" cy="112" r="10" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="1.5" />
      {[0, 0.2, 0.4].map((delay, i) => (
        <line
          key={i}
          x1={105 - i * 2}
          y1={85 - i * 4}
          x2={120 - i * 2}
          y2={70 - i * 4}
          stroke="white"
          strokeOpacity="0.4"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <animate attributeName="opacity" values="0;1;0" dur="1.2s" begin={`${delay}s`} repeatCount="indefinite" />
        </line>
      ))}

      <rect x="60" y="200" width="50" height="66" rx="3" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="1.5" />
      <line x1="68" y1="215" x2="100" y2="215" stroke="white" strokeOpacity="0.5" strokeWidth="1.2" />
      <line x1="68" y1="225" x2="100" y2="225" stroke="white" strokeOpacity="0.5" strokeWidth="1.2" />
      <circle cx="110" cy="245" r="11" fill="white" opacity="0">
        {evidenceFlag && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.4s" fill="freeze" />}
      </circle>
      <path d="M105,245 L109,249 L116,240" fill="none" stroke="#0A0A0A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0">
        {checkPathFlag && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.3s" fill="freeze" />}
      </path>

      <circle cx="210" cy="176" r="28" fill="none" stroke="white" strokeOpacity="0.15" strokeWidth="1.5">
        <animate attributeName="r" values="28;34;28" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0;0.3" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="210" cy="176" r="13" fill="none" stroke="white" strokeWidth="2" />
      <rect x="195" y="171" width="30" height="24" rx="4" fill="white" />
      <g>
        {lockFlag && (
          <animateTransform attributeName="transform" type="rotate" from="0 203 171" to="-35 203 171" begin="0s" dur="0.5s" fill="freeze" />
        )}
        <path d="M203,171 v-12 a7,7 0 1,1 14,0 v12" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>

      <g opacity="0">
        {moneyFlag && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.4s" fill="freeze" />}
        <rect x="300" y="145" width="70" height="42" rx="4" fill="none" stroke="white" strokeWidth="2" />
        <circle cx="335" cy="166" r="10" fill="none" stroke="white" strokeWidth="1.5" />
        <line x1="378" y1="166" x2="402" y2="166" stroke="white" strokeOpacity="0.6" strokeWidth="2" />
        <polygon points="402,160 412,166 402,172" fill="white" fillOpacity="0.6" />
      </g>
    </svg>
  );
}

export function VerifyScene() {
  const [ref, inView] = useScrollTrigger();
  const [check1Opacity, check1Path, check2Opacity, check2Path, certFlag] = useStaggered(
    inView,
    [300, 400, 600, 700, 1000]
  );

  return (
    <svg ref={ref} viewBox="0 0 420 340" className="w-full h-auto" aria-hidden="true">
      <defs>
        <clipPath id="verify-lens-clip">
          <circle cx="240" cy="120" r="50" />
        </clipPath>
      </defs>

      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="6s" repeatCount="indefinite" />
        <rect x="90" y="80" width="120" height="8" fill="white" fillOpacity="0.15" />
        <rect x="100" y="20" width="100" height="60" fill="none" stroke="white" strokeOpacity="0.6" strokeWidth="2" />
        <polygon points="95,20 150,-20 205,20" fill="none" stroke="white" strokeOpacity="0.6" strokeWidth="2" />
        <rect x="135" y="55" width="20" height="25" fill="none" stroke="white" strokeOpacity="0.6" strokeWidth="1.5" />
        <rect x="110" y="35" width="20" height="20" fill="none" stroke="white" strokeOpacity="0.5" strokeWidth="1.3" />
        <rect x="170" y="35" width="20" height="20" fill="none" stroke="white" strokeOpacity="0.5" strokeWidth="1.3" />
      </g>

      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;45 0;0 0" dur="8s" repeatCount="indefinite" />
        <g clipPath="url(#verify-lens-clip)">
          <circle cx="240" cy="120" r="50" fill="#0A0A0A" />
          {[100, 112, 124, 136].map((y, i) => (
            <line key={i} x1="200" y1={y} x2="280" y2={y} stroke="white" strokeOpacity="0.3" strokeWidth="1" />
          ))}
          <rect x="255" y="95" width="20" height="20" fill="none" stroke="white" strokeWidth="2" />
          <line x1="265" y1="95" x2="265" y2="115" stroke="white" strokeWidth="1" />
          <line x1="255" y1="105" x2="275" y2="105" stroke="white" strokeWidth="1" />
          <circle cx="212" cy="140" r="9" fill="white" opacity="0">
            {check1Opacity && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.3s" fill="freeze" />}
          </circle>
          <path d="M208,140 L211,143 L217,136" fill="none" stroke="#0A0A0A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0">
            {check1Path && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.3s" fill="freeze" />}
          </path>
          <circle cx="228" cy="103" r="9" fill="white" opacity="0">
            {check2Opacity && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.3s" fill="freeze" />}
          </circle>
          <path d="M224,103 L227,106 L233,99" fill="none" stroke="#0A0A0A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0">
            {check2Path && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.3s" fill="freeze" />}
          </path>
        </g>
        <circle cx="240" cy="120" r="50" fill="none" stroke="white" strokeOpacity="0.85" strokeWidth="3" />
        <line x1="275" y1="155" x2="300" y2="180" stroke="white" strokeOpacity="0.85" strokeWidth="4" strokeLinecap="round" />
      </g>

      <g opacity="0" transform="translate(0,20)">
        {certFlag && (
          <>
            <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.7s" fill="freeze" />
            <animateTransform attributeName="transform" type="translate" from="0 20" to="0 0" begin="0s" dur="0.7s" fill="freeze" />
          </>
        )}
        <rect x="80" y="220" width="140" height="70" rx="4" fill="white" />
        <rect x="80" y="220" width="140" height="14" rx="4" fill="#0A0A0A" />
        <text x="150" y="230" textAnchor="middle" fontSize="6" fill="white" letterSpacing="0.5">GROUNDWORK VERIFIED</text>
        {Array.from({ length: 25 }, (_, i) => {
          const row = Math.floor(i / 5);
          const col = i % 5;
          return (row + col * 2) % 5 < 2 ? (
            <rect key={i} x={95 + col * 7} y={245 + row * 7} width="6" height="6" fill="#0A0A0A" />
          ) : null;
        })}
      </g>
    </svg>
  );
}

const fixRows = [
  { y: 20, state: "done" as const },
  { y: 55, state: "done" as const },
  { y: 90, state: "done" as const },
  { y: 125, state: "done" as const },
  { y: 160, state: "flagged" as const },
  { y: 195, state: "empty" as const },
];

export function FixScene() {
  const [ref, inView] = useScrollTrigger();
  const doneFlags = useStaggered(inView, [0, 150, 300, 450]);
  const donePathFlags = useStaggered(inView, [100, 250, 400, 550]);
  const [flaggedFlag, bubbleFlag, barFlag] = useStaggered(inView, [900, 1100, 1200]);
  let doneSeen = -1;

  return (
    <svg ref={ref} viewBox="0 0 420 340" className="w-full h-auto" aria-hidden="true">
      {fixRows.map((row, i) => {
        if (row.state === "done") {
          doneSeen += 1;
          const idx = doneSeen;
          return (
            <g key={i}>
              <circle cx="21" cy={row.y} r="9" fill="white" opacity="0">
                {doneFlags[idx] && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.3s" fill="freeze" />}
              </circle>
              <path
                d={`M17 ${row.y} L20 ${row.y + 3} L26 ${row.y - 4}`}
                fill="none"
                stroke="#0A0A0A"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="14"
                strokeDashoffset="14"
              >
                {donePathFlags[idx] && <animate attributeName="stroke-dashoffset" from="14" to="0" begin="0s" dur="0.3s" fill="freeze" />}
              </path>
              <rect x="38" y={row.y - 5} width="180" height="10" rx="5" fill="white" fillOpacity="0.1" />
            </g>
          );
        }
        if (row.state === "empty") {
          return (
            <g key={i}>
              <circle cx="21" cy={row.y} r="9" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" />
              <rect x="38" y={row.y - 5} width="180" height="10" rx="5" fill="white" fillOpacity="0.06" />
            </g>
          );
        }
        return (
          <g key={i}>
            <rect x="10" y={row.y - 14} width="260" height="28" rx="4" fill="white" fillOpacity="0.06" />
            <polygon points={`21,${row.y - 8} 13,${row.y + 8} 29,${row.y + 8}`} fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round">
              <animate attributeName="opacity" values="0.6;1;0.6" dur="1.5s" repeatCount="indefinite" />
            </polygon>
            <text x="38" y={row.y + 4} fontSize="10" fontWeight="700" fill="white" opacity="0">
              {flaggedFlag && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.4s" fill="freeze" />}
              FLAGGED
            </text>
          </g>
        );
      })}

      <g opacity="0">
        {bubbleFlag && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.5s" fill="freeze" />}
        <path d="M280 160 C 320 160, 320 230, 300 245" stroke="white" strokeOpacity="0.5" strokeWidth="1.5" fill="none" strokeDasharray="4 3" />
        <rect x="270" y="245" width="120" height="38" rx="8" fill="white" fillOpacity="0.1" stroke="white" strokeOpacity="0.3" strokeWidth="1" />
        <polygon points="300,245 292,235 308,245" fill="white" fillOpacity="0.1" stroke="white" strokeOpacity="0.3" strokeWidth="1" />
        <text x="330" y="268" textAnchor="middle" fontSize="11" fill="white">Rework needed</text>
      </g>

      <rect x="20" y="305" width="380" height="10" rx="5" fill="none" stroke="white" strokeOpacity="0.25" strokeWidth="1" />
      <rect x="20" y="305" width="0" height="10" rx="5" fill="white">
        {barFlag && <animate attributeName="width" values="0;268;253" keyTimes="0;0.7;1" begin="0s" dur="0.8s" fill="freeze" />}
      </rect>
      <line x1="273" y1="299" x2="273" y2="321" stroke="white" strokeOpacity="0.6" strokeWidth="1.5" />
    </svg>
  );
}
