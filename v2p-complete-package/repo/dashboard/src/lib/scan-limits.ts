/**
 * lib/scan-limits.ts — Free trial scan limits
 *
 * 3 free scans per day, 7-day trial period.
 * Uses localStorage for tracking (client-side only).
 */

const STORAGE_KEY = "vibecheck-trial";
const MAX_SCANS_PER_DAY = 3;
const TRIAL_DAYS = 7;

interface TrialData {
  firstScanAt: string; // ISO date of first ever scan
  scans: Array<{ date: string; count: number }>; // per-day scan counts
}

function getTrialData(): TrialData {
  if (typeof window === "undefined") return { firstScanAt: "", scans: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupted data */ }
  return { firstScanAt: "", scans: [] };
}

function saveTrialData(data: TrialData): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export function getTrialStatus(): {
  canScan: boolean;
  scansToday: number;
  maxPerDay: number;
  trialDaysLeft: number;
  trialExpired: boolean;
} {
  const data = getTrialData();
  const today = todayKey();

  // No scans yet — full trial available
  if (!data.firstScanAt) {
    return { canScan: true, scansToday: 0, maxPerDay: MAX_SCANS_PER_DAY, trialDaysLeft: TRIAL_DAYS, trialExpired: false };
  }

  // Check trial expiry
  const firstScan = new Date(data.firstScanAt);
  const now = new Date();
  const daysSinceFirst = Math.floor((now.getTime() - firstScan.getTime()) / (1000 * 60 * 60 * 24));
  const trialExpired = daysSinceFirst >= TRIAL_DAYS;
  const trialDaysLeft = Math.max(0, TRIAL_DAYS - daysSinceFirst);

  if (trialExpired) {
    return { canScan: false, scansToday: 0, maxPerDay: MAX_SCANS_PER_DAY, trialDaysLeft: 0, trialExpired: true };
  }

  // Count today's scans
  const todayEntry = data.scans.find((s) => s.date === today);
  const scansToday = todayEntry?.count ?? 0;

  return {
    canScan: scansToday < MAX_SCANS_PER_DAY,
    scansToday,
    maxPerDay: MAX_SCANS_PER_DAY,
    trialDaysLeft,
    trialExpired: false,
  };
}

export function recordScan(): void {
  const data = getTrialData();
  const today = todayKey();

  if (!data.firstScanAt) {
    data.firstScanAt = new Date().toISOString();
  }

  const todayEntry = data.scans.find((s) => s.date === today);
  if (todayEntry) {
    todayEntry.count++;
  } else {
    data.scans.push({ date: today, count: 1 });
  }

  // Clean up old entries (keep last 7 days)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  data.scans = data.scans.filter((s) => s.date >= cutoffKey);

  saveTrialData(data);
}
