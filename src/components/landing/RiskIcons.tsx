const STROKE = "#0A0A0A";

export function MoneyLeakIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r="24" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <rect x="18" y="30" width="20" height="6" rx="1" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <rect x="18" y="24" width="20" height="6" rx="1" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <rect x="18" y="18" width="20" height="6" rx="1" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <circle cx="22" cy="20" r="2" fill={STROKE}>
        <animate attributeName="cy" values="20;38;20" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;0.4;0.5;0.9;1" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="34" cy="20" r="2" fill={STROKE}>
        <animate attributeName="cy" values="20;38;20" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;0.4;0.5;0.9;1" dur="2.4s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

export function NoMilestonesIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r="24" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <line x1="10" y1="28" x2="20" y2="28" stroke={STROKE} strokeWidth="1.5" />
      <line x1="36" y1="28" x2="46" y2="28" stroke={STROKE} strokeWidth="1.5" strokeDasharray="3 3" />
      <rect x="20" y="22" width="16" height="12" rx="2" fill="none" stroke={STROKE} strokeWidth="1.5" strokeDasharray="3 3">
        <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" />
      </rect>
      <text x="28" y="32" textAnchor="middle" fontSize="11" fill={STROKE} fontWeight="bold">?</text>
    </svg>
  );
}

export function NoVerificationIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r="24" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <ellipse cx="28" cy="28" rx="14" ry="8" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <circle cx="28" cy="28" r="4" fill={STROKE} />
      <line x1="14" y1="14" x2="42" y2="42" stroke={STROKE} strokeWidth="2">
        <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
      </line>
    </svg>
  );
}

export function NoProofIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r="24" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <rect x="18" y="14" width="20" height="28" rx="2" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <line x1="22" y1="21" x2="34" y2="21" stroke={STROKE} strokeWidth="1.2" />
      <line x1="22" y1="27" x2="34" y2="27" stroke={STROKE} strokeWidth="1.2" />
      <line x1="22" y1="33" x2="30" y2="33" stroke={STROKE} strokeWidth="1.2" />
      <rect x="18" y="14" width="20" height="28" rx="2" fill="white" opacity="0">
        <animate attributeName="opacity" values="0;0.7;0" dur="3s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

export function DelaysIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="24" cy="28" r="14" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <line x1="24" y1="28" x2="24" y2="18" stroke={STROKE} strokeWidth="1.5" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 24 28" to="360 24 28" dur="4s" repeatCount="indefinite" />
      </line>
      <line x1="24" y1="28" x2="30" y2="28" stroke={STROKE} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="44" y1="36" x2="44" y2="20" stroke={STROKE} strokeWidth="1.5">
        <animate attributeName="y2" values="36;20;36" dur="2s" repeatCount="indefinite" />
      </line>
      <polygon points="40,22 48,22 44,16" fill={STROKE}>
        <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
      </polygon>
    </svg>
  );
}

export function MisalignedIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r="24" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <line x1="14" y1="22" x2="34" y2="22" stroke={STROKE} strokeWidth="1.5" />
      <polygon points="34,18 42,22 34,26" fill={STROKE}>
        <animate attributeName="opacity" values="1;0.3;1" dur="1.8s" repeatCount="indefinite" />
      </polygon>
      <line x1="42" y1="34" x2="22" y2="34" stroke={STROKE} strokeWidth="1.5" />
      <polygon points="22,30 14,34 22,38" fill={STROKE}>
        <animate attributeName="opacity" values="0.3;1;0.3" dur="1.8s" repeatCount="indefinite" />
      </polygon>
    </svg>
  );
}
