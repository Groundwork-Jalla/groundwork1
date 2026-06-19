const DARK = "#0A0A0A";
const nodeX = [30, 95, 160, 225, 290];

function GridBackdrop({ stroke }: { stroke: string }) {
  return (
    <g opacity="0.5">
      {Array.from({ length: 6 }, (_, i) => (
        <line key={`v${i}`} x1={10 + i * 60} y1="10" x2={10 + i * 60} y2="180" stroke={stroke} strokeWidth="1" />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <line key={`h${i}`} x1="10" y1={10 + i * 40} x2="310" y2={10 + i * 40} stroke={stroke} strokeWidth="1" />
      ))}
    </g>
  );
}

export function WithoutStructureScene() {
  return (
    <svg viewBox="0 0 320 190" className="w-full h-full" aria-hidden="true">
      <GridBackdrop stroke="rgba(10,10,10,0.05)" />

      {/* dispute stamp */}
      <g transform="translate(160,26) rotate(-12)">
        <circle r="17" fill="none" stroke={DARK} strokeOpacity="0.3" strokeWidth="1.5" strokeDasharray="3 3">
          <animate attributeName="opacity" values="0.6;1;0.6" dur="2.2s" repeatCount="indefinite" />
        </circle>
        <text textAnchor="middle" y="3" fontSize="7" fontWeight="700" fill={DARK} opacity="0.4" letterSpacing="0.5">
          DISPUTED
        </text>
      </g>

      <line x1={nodeX[0]} y1="70" x2={nodeX[1]} y2="70" stroke={DARK} strokeWidth="2.5" />
      <line x1={nodeX[2]} y1="70" x2={nodeX[3]} y2="70" stroke={DARK} strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 4" />
      <line x1={nodeX[3]} y1="70" x2={nodeX[4]} y2="70" stroke={DARK} strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 4" />

      <line x1={nodeX[1]} y1="70" x2={nodeX[1] + 18} y2="70" stroke={DARK} strokeWidth="2.5" />
      <line x1={nodeX[2] - 18} y1="70" x2={nodeX[2]} y2="70" stroke={DARK} strokeWidth="2.5" />
      <polyline
        points={`${nodeX[1] + 18},70 ${nodeX[1] + 24},60 ${nodeX[1] + 31},80 ${nodeX[2] - 18},70`}
        fill="none"
        stroke={DARK}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />
      </polyline>

      {[0, 1].map((i) => (
        <circle key={i} cx={nodeX[i]} cy="70" r="11" fill={DARK} />
      ))}
      {[2, 3, 4].map((i) => (
        <circle key={i} cx={nodeX[i]} cy="70" r="11" fill="none" stroke={DARK} strokeOpacity="0.35" strokeWidth="1.5" />
      ))}
      <text x={nodeX[2]} y="75" textAnchor="middle" fontSize="13" fontWeight="700" fill={DARK} opacity="0.5">?</text>

      {[
        { x: nodeX[1] + 20, dur: "2s" },
        { x: nodeX[1] + 27, dur: "2.4s" },
      ].map((drop, i) => (
        <circle key={i} cx={drop.x} cy="80" r="3" fill={DARK}>
          <animate attributeName="cy" values="80;115" dur={drop.dur} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.8;0" dur={drop.dur} repeatCount="indefinite" />
        </circle>
      ))}
      <text x={nodeX[1] + 23} y="132" textAnchor="middle" fontSize="9.5" fill={DARK} opacity="0.45">
        money leaks here
      </text>

      {/* decline arrow */}
      <polyline
        points="35,150 60,158 50,163 78,178"
        fill="none"
        stroke={DARK}
        strokeOpacity="0.6"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polygon points="71,174 84,177 76,184" fill={DARK} fillOpacity="0.6" />
      <text x="95" y="180" fontSize="10" fontWeight="700" fill={DARK} opacity="0.55">
        30%+ over budget
      </text>
    </svg>
  );
}

export function WithGroundworkScene() {
  return (
    <svg viewBox="0 0 320 190" className="w-full h-full" aria-hidden="true">
      <GridBackdrop stroke="rgba(255,255,255,0.06)" />

      {/* certified ribbon */}
      <g transform="translate(160,24)">
        <animateTransform attributeName="transform" type="translate" values="160 24;160 19;160 24" dur="3.5s" repeatCount="indefinite" />
        <polygon points="-8,12 -8,24 0,19 8,24 8,12" fill="white" fillOpacity="0.9" />
        <circle r="12" fill="white" />
        <path d="M-4,0 L-1,3 L5,-4" fill="none" stroke="#0A0A0A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      <line x1={nodeX[0]} y1="70" x2={nodeX[4]} y2="70" stroke="white" strokeOpacity="0.3" strokeWidth="2.5" />
      <circle cy="70" r="4.5" fill="white">
        <animate attributeName="cx" values={`${nodeX[0]};${nodeX[4]}`} dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1" dur="3s" repeatCount="indefinite" />
      </circle>

      {nodeX.map((x, i) => (
        <g key={i}>
          <circle cx={x} cy="70" r="11" fill="white" />
          <path d={`M${x - 5} 70 L${x - 1} 74 L${x + 5} 65`} fill="none" stroke="#0A0A0A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}

      <circle cx="160" cy="130" r="26" fill="none" stroke="white" strokeOpacity="0.15" strokeWidth="1.5">
        <animate attributeName="r" values="26;32;26" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0;0.3" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="160" cy="130" r="13" fill="none" stroke="white" strokeWidth="2" />
      <rect x="147" y="126" width="26" height="20" rx="3" fill="white" />
      <path d="M151,126 v-7 a9,9 0 1,1 18,0 v7" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" />
      <text x="160" y="165" textAnchor="middle" fontSize="9.5" fill="white" opacity="0.5">
        money stays secured
      </text>

      {/* growth arrow */}
      <polyline
        points="35,178 55,166 50,162 78,148"
        fill="none"
        stroke="white"
        strokeOpacity="0.7"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polygon points="72,153 85,146 78,158" fill="white" fillOpacity="0.7" />
      <text x="95" y="155" fontSize="10" fontWeight="700" fill="white" opacity="0.6">
        budget holds
      </text>
    </svg>
  );
}
