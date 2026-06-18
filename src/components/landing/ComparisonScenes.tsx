const DARK = "#0A0A0A";

const nodeX = [25, 80, 135, 190, 245];

export function WithoutStructureScene() {
  return (
    <svg viewBox="0 0 280 150" className="w-full h-full" aria-hidden="true">
      <line x1={nodeX[0]} y1="40" x2={nodeX[1]} y2="40" stroke={DARK} strokeWidth="2" />
      <line x1={nodeX[2]} y1="40" x2={nodeX[3]} y2="40" stroke={DARK} strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 4" />
      <line x1={nodeX[3]} y1="40" x2={nodeX[4]} y2="40" stroke={DARK} strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 4" />

      {/* broken connection between node 1 and 2 */}
      <line x1={nodeX[1]} y1="40" x2={nodeX[1] + 16} y2="40" stroke={DARK} strokeWidth="2" />
      <line x1={nodeX[2] - 16} y1="40" x2={nodeX[2]} y2="40" stroke={DARK} strokeWidth="2" />
      <polyline
        points={`${nodeX[1] + 16},40 ${nodeX[1] + 21},32 ${nodeX[1] + 27},48 ${nodeX[2] - 16},40`}
        fill="none"
        stroke={DARK}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />
      </polyline>

      {[0, 1].map((i) => (
        <circle key={i} cx={nodeX[i]} cy="40" r="9" fill={DARK} />
      ))}
      {[2, 3, 4].map((i) => (
        <circle key={i} cx={nodeX[i]} cy="40" r="9" fill="none" stroke={DARK} strokeOpacity="0.35" strokeWidth="1.5" />
      ))}
      <text x={nodeX[2]} y="44" textAnchor="middle" fontSize="10" fontWeight="700" fill={DARK} opacity="0.5">?</text>

      {[
        { x: nodeX[1] + 18, dur: "2s" },
        { x: nodeX[1] + 24, dur: "2.4s" },
      ].map((drop, i) => (
        <circle key={i} cx={drop.x} cy="48" r="2.5" fill={DARK}>
          <animate attributeName="cy" values="48;78" dur={drop.dur} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.8;0" dur={drop.dur} repeatCount="indefinite" />
        </circle>
      ))}

      <text x={nodeX[1] + 21} y="100" textAnchor="middle" fontSize="9" fill={DARK} opacity="0.4">money leaks here</text>
    </svg>
  );
}

export function WithGroundworkScene() {
  return (
    <svg viewBox="0 0 280 150" className="w-full h-full" aria-hidden="true">
      <line x1={nodeX[0]} y1="40" x2={nodeX[4]} y2="40" stroke="white" strokeOpacity="0.25" strokeWidth="2" />
      <circle cy="40" r="4" fill="white">
        <animate attributeName="cx" values={`${nodeX[0]};${nodeX[4]}`} dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1" dur="3s" repeatCount="indefinite" />
      </circle>

      {nodeX.map((x, i) => (
        <g key={i}>
          <circle cx={x} cy="40" r="9" fill="white" />
          <path d={`M${x - 4} 40 L${x - 1} 43 L${x + 4} 36`} fill="none" stroke="#0A0A0A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}

      <circle cx="135" cy="100" r="22" fill="none" stroke="white" strokeOpacity="0.15" strokeWidth="1.5">
        <animate attributeName="r" values="22;27;22" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0;0.3" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="135" cy="100" r="11" fill="none" stroke="white" strokeWidth="2" />
      <rect x="124" y="97" width="22" height="17" rx="3" fill="white" />
      <path d="M127,97 v-6 a8,8 0 1,1 16,0 v6" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" />

      <text x="135" y="135" textAnchor="middle" fontSize="9" fill="white" opacity="0.4">money stays secured</text>
    </svg>
  );
}
