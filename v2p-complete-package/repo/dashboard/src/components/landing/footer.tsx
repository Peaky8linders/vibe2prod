import { Logo } from "@/components/logo";

export function Footer() {
  return (
    <footer className="border-t border-[var(--color-border)] py-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <Logo />
              <span className="font-bold text-lg">VibeCheck</span>
            </div>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
              Antifragile production hardening. Your code gets stronger from every attack.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3">Product</h4>
            <ul className="space-y-2 text-sm text-[var(--color-text-secondary)]">
              <li><a href="#features" className="hover:text-[var(--color-text-primary)] transition-colors">Features</a></li>
              <li><a href="#pricing" className="hover:text-[var(--color-text-primary)] transition-colors">Pricing</a></li>
              <li><a href="/dashboard" className="hover:text-[var(--color-text-primary)] transition-colors">Dashboard</a></li>
              <li><a href="#how-it-works" className="hover:text-[var(--color-text-primary)] transition-colors">How It Works</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3">Resources</h4>
            <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
              <li><span>Documentation</span></li>
              <li><span>API Reference</span></li>
              <li><span>Changelog</span></li>
              <li><span>Status</span></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3">Company</h4>
            <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
              <li><span>About</span></li>
              <li><span>Blog</span></li>
              <li><span>Privacy</span></li>
              <li><span>Terms</span></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-[var(--color-border)] flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-[var(--color-text-muted)]">
          <p>&copy; {new Date().getFullYear()} VibeCheck. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <a href="#" className="hover:text-[var(--color-text-secondary)] transition-colors">GitHub</a>
            <a href="#" className="hover:text-[var(--color-text-secondary)] transition-colors">Discord</a>
            <a href="#" className="hover:text-[var(--color-text-secondary)] transition-colors">Twitter</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
