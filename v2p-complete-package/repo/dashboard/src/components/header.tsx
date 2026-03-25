"use client";

interface HeaderProps {
  scan: { project: string; scanned_at: string; files_scanned: number; total_defects: number; by_priority: { P0: number } };
}

export function Header({ scan }: HeaderProps) {
  const isBlocked = scan.by_priority.P0 > 0;
  const timeAgo = getTimeAgo(scan.scanned_at);

  return (
    <header className="h-16 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] flex items-center justify-between px-6 pl-16 lg:pl-6">
      <div className="flex items-center gap-4 min-w-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">{scan.project}</h2>
          <p className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
            {scan.files_scanned} files scanned {timeAgo}
          </p>
        </div>
        {isBlocked ? (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[var(--color-accent-red)]/15 text-[var(--color-accent-red)] border border-[var(--color-accent-red)]/30">
            BLOCKED
          </span>
        ) : (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[var(--color-accent-green)]/15 text-[var(--color-accent-green)] border border-[var(--color-accent-green)]/30 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green)] pulse-live" />
            READY
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button className="hidden sm:block px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-bright)] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-green)]">
          Export Report
        </button>
        <button className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-[var(--color-accent-green)] to-[var(--color-accent-cyan)] text-black hover:opacity-90 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-green)]">
          Re-scan
        </button>
      </div>
    </header>
  );
}

function getTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
