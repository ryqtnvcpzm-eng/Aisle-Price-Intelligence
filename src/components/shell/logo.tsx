/** Aisle mark: two shelves converging to a vanishing point — an aisle in perspective. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="aisle-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f8bf0" />
          <stop offset="1" stopColor="#0757b8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8.5" fill="url(#aisle-g)" />
      <rect width="32" height="32" rx="8.5" fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="0.5" />
      <path d="M8 25 L14.6 9.5 M24 25 L17.4 9.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M10.6 19.2h10.8" stroke="#fff" strokeOpacity="0.72" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="7.6" r="1.5" fill="#fff" />
    </svg>
  );
}
