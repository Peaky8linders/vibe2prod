"use client";

import { useEffect, useState } from "react";

export function Hero() {
  const [score, setScore] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setScore(88), 300);
    return () => clearTimeout(timer);
  }, []);

  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;

  return (
    <section className="relative overflow-hidden pt-32 pb-24 sm:pt-40 sm:pb-32">
      {/* Grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(34,197,94,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,197,94,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-[radial-gradient(ellipse,rgba(34,197,94,0.08),transparent_70%)]" />

      <div className="relative max-w-6xl mx-auto px-6 flex flex-col lg:flex-row items-center gap-16">
        {/* Left: copy */}
        <div className="flex-1 text-center lg:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-xs text-[var(--color-text-secondary)] mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green)] pulse-live" />
            Now in public beta
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1] mb-6">
            Your code doesn&apos;t just{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--color-accent-green)] to-[var(--color-accent-cyan)]">
              survive
            </span>{" "}
            attacks.
            <br />
            It gets{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--color-accent-cyan)] to-[var(--color-accent-purple)]">
              stronger
            </span>{" "}
            from them.
          </h1>

          <p className="text-lg text-[var(--color-text-secondary)] max-w-xl mb-8 mx-auto lg:mx-0">
            VibeCheck scans your codebase, finds production defects, and autonomously fixes them — while you sleep. Antifragile security for teams that ship fast.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
            <a
              href="#pricing"
              className="px-6 py-3 rounded-lg bg-[var(--color-accent-green)] text-black font-semibold text-sm hover:brightness-110 transition-all"
            >
              Get Started Free
            </a>
            <a
              href="#how-it-works"
              className="px-6 py-3 rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)] font-medium text-sm hover:border-[var(--color-border-bright)] hover:bg-[var(--color-bg-secondary)] transition-all"
            >
              See How It Works
            </a>
          </div>
        </div>

        {/* Right: animated score ring */}
        <div className="relative flex-shrink-0">
          <div className="w-56 h-56 sm:w-64 sm:h-64 relative">
            {/* Glow */}
            <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(34,197,94,0.15),transparent_70%)]" />
            <svg viewBox="0 0 120 120" className="w-full h-full">
              <circle
                cx="60" cy="60" r="54"
                fill="none"
                stroke="var(--color-border)"
                strokeWidth="4"
              />
              <circle
                cx="60" cy="60" r="54"
                fill="none"
                stroke="var(--color-accent-green)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                transform="rotate(-90 60 60)"
                className="transition-all duration-[1.5s] ease-out"
              />
              <text x="60" y="55" textAnchor="middle" className="fill-[var(--color-text-primary)] text-[28px] font-bold" style={{ fontFamily: "'Inter', sans-serif" }}>
                {score}%
              </text>
              <text x="60" y="72" textAnchor="middle" className="fill-[var(--color-text-secondary)] text-[8px]" style={{ fontFamily: "'Inter', sans-serif" }}>
                Production Ready
              </text>
            </svg>
          </div>

          {/* Floating badges */}
          <div className="absolute -top-2 -right-2 px-2.5 py-1 rounded-md bg-[var(--color-bg-card)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-accent-green)] hero-float-badge" style={{ animationDelay: "0s" }}>
            0 P0 defects
          </div>
          <div className="absolute -bottom-2 -left-4 px-2.5 py-1 rounded-md bg-[var(--color-bg-card)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-accent-cyan)] hero-float-badge" style={{ animationDelay: "0.5s" }}>
            47 files scanned
          </div>
          <div className="absolute top-1/2 -right-8 px-2.5 py-1 rounded-md bg-[var(--color-bg-card)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-accent-purple)] hero-float-badge" style={{ animationDelay: "1s" }}>
            Antifragile: 75
          </div>
        </div>
      </div>
    </section>
  );
}
