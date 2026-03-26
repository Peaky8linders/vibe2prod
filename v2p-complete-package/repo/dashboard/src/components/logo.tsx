export function Logo({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <div className={`${className} rounded-lg bg-[var(--color-accent-green)] flex items-center justify-center`}>
      <svg width="56%" height="56%" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  );
}
