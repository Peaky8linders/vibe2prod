"use client";

import { useState } from "react";
import { PLANS } from "@/lib/plans";

export function Pricing() {
  const [annual, setAnnual] = useState(false);

  return (
    <section id="pricing" className="py-24 relative">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-[var(--color-text-secondary)] text-lg max-w-xl mx-auto mb-8">
            Start free. Upgrade when you need LLM-powered scanning and autonomous fixes.
          </p>

          {/* Billing toggle */}
          <div className="inline-flex items-center gap-3 p-1 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
            <button
              onClick={() => setAnnual(false)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                !annual
                  ? "bg-[var(--color-bg-card)] text-[var(--color-text-primary)] shadow-sm"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                annual
                  ? "bg-[var(--color-bg-card)] text-[var(--color-text-primary)] shadow-sm"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              Annual
              <span className="ml-1.5 text-[var(--color-accent-green)] text-xs font-semibold">-20%</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {PLANS.map((plan) => {
            const price = annual ? plan.yearlyPrice : plan.price;
            const isHighlighted = plan.highlighted;

            return (
              <div
                key={plan.id}
                className={`relative rounded-xl p-8 border transition-all ${
                  isHighlighted
                    ? "bg-[var(--color-bg-card)] border-[var(--color-accent-green)]/40 glow-green scale-[1.02] lg:scale-105"
                    : "bg-[var(--color-bg-card)] border-[var(--color-border)] hover:border-[var(--color-border-bright)]"
                }`}
              >
                {isHighlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-[var(--color-accent-green)] text-black text-xs font-semibold">
                    Most Popular
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-1">{plan.name}</h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-4">{plan.description}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">
                      {price === 0 ? "Free" : `$${price}`}
                    </span>
                    {price > 0 && (
                      <span className="text-[var(--color-text-muted)] text-sm">/mo</span>
                    )}
                  </div>
                  {plan.trial && (
                    <p className="text-xs text-[var(--color-accent-green)] mt-1">{plan.trial}</p>
                  )}
                </div>

                <a
                  href={`/dashboard?plan=${plan.id}`}
                  className={`block w-full text-center py-2.5 rounded-lg text-sm font-semibold transition-all mb-6 ${
                    isHighlighted
                      ? "bg-[var(--color-accent-green)] text-black hover:brightness-110"
                      : "border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card-hover)] hover:border-[var(--color-border-bright)]"
                  }`}
                >
                  {plan.cta}
                </a>

                <ul className="space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-[var(--color-text-secondary)]">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5">
                        <path d="M13.3 4.3L6 11.6 2.7 8.3" stroke="var(--color-accent-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
