"use client";

import { useState } from "react";
import { Logo } from "@/components/logo";

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2">
          <Logo />
          <span className="font-bold text-lg">VibeCheck</span>
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8 text-sm text-[var(--color-text-secondary)]">
          <a href="#features" className="hover:text-[var(--color-text-primary)] transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-[var(--color-text-primary)] transition-colors">How It Works</a>
          <a href="#pricing" className="hover:text-[var(--color-text-primary)] transition-colors">Pricing</a>
          <a href="/dashboard" className="hover:text-[var(--color-text-primary)] transition-colors">Dashboard</a>
        </div>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-3">
          <a href="/dashboard" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
            Sign In
          </a>
          <a
            href="#pricing"
            className="px-4 py-2 rounded-lg bg-[var(--color-accent-green)] text-black text-sm font-semibold hover:brightness-110 transition-all"
          >
            Get Started
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden p-2 rounded-lg hover:bg-[var(--color-bg-secondary)] transition-colors"
          aria-label="Toggle menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {mobileOpen ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--color-border)] bg-[var(--color-bg-primary)] px-6 py-4 space-y-3">
          <a href="#features" onClick={() => setMobileOpen(false)} className="block text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">Features</a>
          <a href="#how-it-works" onClick={() => setMobileOpen(false)} className="block text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">How It Works</a>
          <a href="#pricing" onClick={() => setMobileOpen(false)} className="block text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">Pricing</a>
          <a href="/dashboard" onClick={() => setMobileOpen(false)} className="block text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">Dashboard</a>
          <a
            href="#pricing"
            onClick={() => setMobileOpen(false)}
            className="block w-full text-center py-2.5 rounded-lg bg-[var(--color-accent-green)] text-black text-sm font-semibold"
          >
            Get Started
          </a>
        </div>
      )}
    </nav>
  );
}
