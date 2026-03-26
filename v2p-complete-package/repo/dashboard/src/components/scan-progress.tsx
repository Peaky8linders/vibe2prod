"use client";

const STAGES = [
  "Connecting to GitHub...",
  "Downloading repository...",
  "Extracting files...",
  "Running security scanners...",
  "Running performance scanners...",
  "Computing readiness scores...",
];

interface ScanProgressProps {
  stage: number;
  repoName: string;
}

export function ScanProgress({ stage, repoName }: ScanProgressProps) {
  const progress = Math.min(((stage + 1) / STAGES.length) * 100, 100);

  return (
    <div className="flex flex-col items-center justify-center py-20 px-6">
      {/* Spinner */}
      <div className="relative w-20 h-20 mb-8">
        <div className="absolute inset-0 rounded-full border-2 border-[var(--color-border)]" />
        <div
          className="absolute inset-0 rounded-full border-2 border-[var(--color-accent-green)] border-t-transparent animate-spin"
          style={{ animationDuration: "1s" }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
      </div>

      {/* Status */}
      <h3 className="text-lg font-semibold mb-2">Scanning {repoName}</h3>
      <p className="text-sm text-[var(--color-text-secondary)] mb-6">
        {STAGES[Math.min(stage, STAGES.length - 1)]}
      </p>

      {/* Progress bar */}
      <div className="w-full max-w-sm">
        <div className="h-1.5 rounded-full bg-[var(--color-bg-secondary)] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent-green)] to-[var(--color-accent-cyan)] transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-[var(--color-text-muted)]">
          <span>Step {Math.min(stage + 1, STAGES.length)} of {STAGES.length}</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  );
}
