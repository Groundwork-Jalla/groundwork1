const STROKE = "#0A0A0A";

export function MoneyLeakScene() {
  return (
    <svg viewBox="0 0 240 120" className="w-full h-full" aria-hidden="true">
      <text x="60" y="20" textAnchor="middle" fontSize="14" fill={STROKE} opacity="0.6" fontWeight="700">?</text>
      {[30, 46, 62, 78].map((y, i) => (
        <rect key={i} x="25" y={y} width="70" height="14" rx="2" fill="none" stroke={STROKE} strokeWidth="1.5" />
      ))}
      {[
        { x: 40, dur: "2s" },
        { x: 60, dur: "2.3s" },
        { x: 80, dur: "1.8s" },
      ].map((drop, i) => (
        <circle key={i} cx={drop.x} cy="92" r="3" fill={STROKE}>
          <animate attributeName="cy" values="92;114" dur={drop.dur} repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0" dur={drop.dur} repeatCount="indefinite" />
        </circle>
      ))}
      <polyline points="165,30 185,50 175,55 200,75 190,80 215,95" stroke={STROKE} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <polygon points="210,88 224,92 214,104" fill={STROKE} />
    </svg>
  );
}

export function NoMilestonesScene() {
  return (
    <svg viewBox="0 0 240 120" className="w-full h-full" aria-hidden="true">
      <text x="120" y="25" textAnchor="middle" fontSize="16" fontWeight="700" fill={STROKE}>
        ?
        <animate attributeName="y" values="25;19;25" dur="2.4s" repeatCount="indefinite" />
      </text>
      <line x1="20" y1="40" x2="220" y2="40" stroke={STROKE} strokeWidth="2" />
      {Array.from({ length: 10 }, (_, i) => (
        <circle key={i} cx={20 + i * (200 / 9)} cy="75" r="2.5" fill={STROKE} opacity="0.25" />
      ))}
    </svg>
  );
}

export function NoVerificationScene() {
  return (
    <svg viewBox="0 0 240 120" className="w-full h-full" aria-hidden="true">
      <rect x="20" y="50" width="50" height="40" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <polygon points="15,50 45,25 75,50" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <ellipse cx="140" cy="55" rx="22" ry="13" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <circle cx="140" cy="55" r="6" fill={STROKE} />
      <line x1="118" y1="38" x2="162" y2="72" stroke={STROKE} strokeWidth="2.5" strokeLinecap="round">
        <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
      </line>
      {[18, 42, 66].map((x, i) => (
        <rect key={i} x={x} y="98" width="20" height="10" fill="none" stroke={STROKE} strokeWidth="1">
          <animate attributeName="opacity" values="1;0.4;1" dur="2.2s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
        </rect>
      ))}
    </svg>
  );
}

export function NoProofScene() {
  return (
    <svg viewBox="0 0 240 120" className="w-full h-full" aria-hidden="true">
      <g>
        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="3s" repeatCount="indefinite" />
        <rect x="20" y="20" width="50" height="70" rx="3" fill="white" stroke={STROKE} strokeWidth="1.5" />
        <line x1="28" y1="35" x2="62" y2="35" stroke={STROKE} strokeWidth="1.2" />
        <line x1="28" y1="45" x2="62" y2="45" stroke={STROKE} strokeWidth="1.2" />
        <line x1="28" y1="55" x2="50" y2="55" stroke={STROKE} strokeWidth="1.2" />
      </g>
      <rect x="110" y="40" width="30" height="22" rx="3" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <circle cx="125" cy="51" r="6" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <line x1="106" y1="36" x2="144" y2="66" stroke={STROKE} strokeWidth="2" strokeLinecap="round" />
      <line x1="144" y1="36" x2="106" y2="66" stroke={STROKE} strokeWidth="2" strokeLinecap="round" />
      <rect x="165" y="25" width="60" height="28" rx="8" fill="none" stroke={STROKE} strokeWidth="1.2" />
      <polygon points="178,53 172,53 178,62" fill="none" stroke={STROKE} strokeWidth="1.2" />
      <text x="195" y="42" textAnchor="middle" fontSize="9" fontStyle="italic" fill={STROKE}>He said...</text>
    </svg>
  );
}

export function DelaysScene() {
  return (
    <svg viewBox="0 0 240 120" className="w-full h-full" aria-hidden="true">
      <circle cx="50" cy="45" r="24" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <line x1="50" y1="45" x2="50" y2="30" stroke={STROKE} strokeWidth="2" strokeLinecap="round" />
      <line x1="50" y1="45" x2="64" y2="45" stroke={STROKE} strokeWidth="2" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 50 45" to="360 50 45" dur="4s" repeatCount="indefinite" />
      </line>
      <rect x="20" y="85" width="160" height="10" rx="5" fill="none" stroke={STROKE} strokeWidth="1" />
      <rect x="20" y="85" width="16" height="10" rx="5" fill={STROKE} />
      <text x="190" y="93" fontSize="11" fontWeight="700" fill={STROKE}>$1.5K</text>
      {[
        { x: 140, dur: "2.4s" },
        { x: 160, dur: "2.8s" },
        { x: 180, dur: "2s" },
      ].map((coin, i) => (
        <circle key={i} cx={coin.x} cy="110" r="3" fill="none" stroke={STROKE} strokeWidth="1.5">
          <animate attributeName="cy" values="110;70" dur={coin.dur} repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0" dur={coin.dur} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  );
}

export function MisalignedScene() {
  return (
    <svg viewBox="0 0 240 120" className="w-full h-full" aria-hidden="true">
      <polyline points="70,60 90,52 110,68 130,50 150,66 170,60" stroke={STROKE} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />

      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;-6 0;0 0" dur="3s" repeatCount="indefinite" />
        <rect x="30" y="2" width="40" height="24" rx="6" fill="none" stroke={STROKE} strokeWidth="1" />
        <polygon points="42,18 50,10 58,18" fill="none" stroke={STROKE} strokeWidth="1.2" />
        <rect x="44" y="18" width="12" height="8" fill="none" stroke={STROKE} strokeWidth="1.2" />
        <circle cx="50" cy="40" r="8" fill="none" stroke={STROKE} strokeWidth="1.5" />
        <line x1="50" y1="48" x2="50" y2="75" stroke={STROKE} strokeWidth="1.5" />
        <line x1="50" y1="75" x2="42" y2="95" stroke={STROKE} strokeWidth="1.5" />
        <line x1="50" y1="75" x2="58" y2="95" stroke={STROKE} strokeWidth="1.5" />
        <line x1="50" y1="55" x2="40" y2="68" stroke={STROKE} strokeWidth="1.5" />
        <line x1="50" y1="55" x2="60" y2="68" stroke={STROKE} strokeWidth="1.5" />
      </g>

      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;6 0;0 0" dur="3s" repeatCount="indefinite" />
        <rect x="170" y="2" width="40" height="24" rx="6" fill="none" stroke={STROKE} strokeWidth="1" />
        <circle cx="190" cy="14" r="7" fill="none" stroke={STROKE} strokeWidth="1.2" />
        <line x1="190" y1="9" x2="190" y2="19" stroke={STROKE} strokeWidth="1" />
        <circle cx="190" cy="40" r="8" fill="none" stroke={STROKE} strokeWidth="1.5" />
        <line x1="190" y1="48" x2="190" y2="75" stroke={STROKE} strokeWidth="1.5" />
        <line x1="190" y1="75" x2="182" y2="95" stroke={STROKE} strokeWidth="1.5" />
        <line x1="190" y1="75" x2="198" y2="95" stroke={STROKE} strokeWidth="1.5" />
        <line x1="190" y1="55" x2="180" y2="68" stroke={STROKE} strokeWidth="1.5" />
        <line x1="190" y1="55" x2="200" y2="68" stroke={STROKE} strokeWidth="1.5" />
      </g>
    </svg>
  );
}
