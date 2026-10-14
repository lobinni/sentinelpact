export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" stroke="currentColor" strokeWidth="2" />
      <path d="M16 7l8 4v6c0 4.5-3.2 7.4-8 8-4.8-.6-8-3.5-8-8v-6l8-4z" fill="currentColor" opacity="0.14" />
      <path d="M16 7l8 4v6c0 4.5-3.2 7.4-8 8-4.8-.6-8-3.5-8-8v-6l8-4z" stroke="currentColor" strokeWidth="2" />
      <path d="M16 12v8M12 16h8" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
