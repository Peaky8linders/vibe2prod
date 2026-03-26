import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Pricing } from "@/components/landing/pricing";
import { Footer } from "@/components/landing/footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <Navbar />
      <Hero />

      {/* Social proof */}
      <section className="py-12 border-y border-[var(--color-border)]">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <p className="text-xs uppercase tracking-widest text-[var(--color-text-muted)] mb-6">
            Trusted by teams shipping to production
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 text-[var(--color-text-muted)]">
            {["Acme Corp", "Lattice", "Meridian", "Skyline", "Novanet"].map((name) => (
              <span key={name} className="text-lg font-semibold opacity-40 hover:opacity-60 transition-opacity">
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      <Features />
      <HowItWorks />
      <Pricing />

      {/* Final CTA */}
      <section className="py-24 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.06),transparent_70%)]" />
        <div className="relative max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Ready to harden your code?
          </h2>
          <p className="text-[var(--color-text-secondary)] text-lg mb-8">
            Start with a free scan. See what VibeCheck finds in under a minute.
          </p>
          <a
            href="/dashboard?plan=starter"
            className="inline-flex px-8 py-3.5 rounded-lg bg-[var(--color-accent-green)] text-black font-semibold text-sm hover:brightness-110 transition-all"
          >
            Start Free Scan
          </a>
        </div>
      </section>

      <Footer />
    </div>
  );
}
