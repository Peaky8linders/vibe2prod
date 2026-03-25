"use client";

import { useState } from "react";

const PROMPTS = [
  {
    dimension: "security",
    title: "Fix Security Issues",
    description: "6 defects across auth, CORS, and input validation",
    color: "var(--color-accent-red)",
    prompt: `You are a security specialist. Fix ALL security defects in this project:\n\n1. Add authentication middleware to unprotected endpoints\n2. Restrict CORS to specific origins\n3. Add rate limiting to mutation endpoints\n4. Remove hardcoded secrets, use environment variables\n\nCommit each fix: fix(security): <id> — <description>`,
  },
  {
    dimension: "error-handling",
    title: "Fix Error Handling",
    description: "5 unprotected external calls",
    color: "var(--color-accent-yellow)",
    prompt: `You are an error handling specialist. Add proper error handling:\n\n1. Wrap every fetch/axios call in try/catch\n2. Add timeouts via AbortController (5s default)\n3. Replace empty catch blocks with error logging\n4. Ensure errors propagate meaningfully\n\nCommit each fix: fix(error-handling): <id> — <description>`,
  },
  {
    dimension: "input-validation",
    title: "Fix Input Validation",
    description: "4 endpoints without schema validation",
    color: "var(--color-accent-blue)",
    prompt: `You are an input validation specialist. Add Zod schemas:\n\n1. Define schema for every request body\n2. Use safeParse() and return 400 on failure\n3. Validate query params and URL params\n4. Replace 'any' types with proper types\n\nCommit each fix: fix(input-validation): <id> — <description>`,
  },
];

export function ActionPrompts() {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (dimension: string, prompt: string) => {
    navigator.clipboard.writeText(prompt);
    setCopied(dimension);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)] overflow-hidden">
      <div className="p-5 border-b border-[var(--color-border)]">
        <h3 className="text-sm font-semibold">Actionable Fix Prompts</h3>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">Copy into Claude Code or Codex to auto-fix each dimension</p>
      </div>
      <div className="divide-y divide-[var(--color-border)]">
        {PROMPTS.map((p) => (
          <div key={p.dimension} className="p-4 flex items-center justify-between hover:bg-[var(--color-bg-card-hover)] transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-2 h-8 rounded-full" style={{ backgroundColor: p.color }} />
              <div>
                <p className="text-sm font-medium">{p.title}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{p.description}</p>
              </div>
            </div>
            <button
              onClick={() => handleCopy(p.dimension, p.prompt)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-green)]"
              style={{
                borderColor: copied === p.dimension ? "var(--color-accent-green)" : "var(--color-border)",
                color: copied === p.dimension ? "var(--color-accent-green)" : "var(--color-text-secondary)",
                backgroundColor: copied === p.dimension ? "rgba(34, 197, 94, 0.1)" : "transparent",
              }}
            >
              {copied === p.dimension ? "Copied!" : "Copy Prompt"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
