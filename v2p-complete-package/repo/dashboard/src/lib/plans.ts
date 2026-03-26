export type PlanId = "starter" | "pro" | "enterprise";

export interface Plan {
  id: PlanId;
  name: string;
  price: number; // monthly, 0 = free
  yearlyPrice: number; // monthly when billed yearly
  description: string;
  cta: string;
  trial?: string;
  highlighted?: boolean;
  features: string[];
  limits: {
    scansPerMonth: number | "unlimited";
    llmScanning: boolean;
    securityGates: "basic" | "full" | "full+custom";
    chaosTesting: boolean;
    compliance: boolean;
    dashboard: "basic" | "full" | "full+antifragile";
    reports: "none" | "html" | "html+pdf";
    support: "community" | "email" | "dedicated";
  };
}

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 0,
    yearlyPrice: 0,
    description: "Get started with basic static analysis and see what VibeCheck finds.",
    cta: "Start Free",
    features: [
      "3 static scans per month",
      "L1 deterministic gates",
      "Basic security checks",
      "Overview dashboard",
      "Community support",
    ],
    limits: {
      scansPerMonth: 3,
      llmScanning: false,
      securityGates: "basic",
      chaosTesting: false,
      compliance: false,
      dashboard: "basic",
      reports: "none",
      support: "community",
    },
  },
  {
    id: "pro",
    name: "Pro",
    price: 49,
    yearlyPrice: 39,
    description: "LLM-powered scanning and autonomous fixing for production teams.",
    cta: "Start Free Trial",
    trial: "14-day free trial",
    highlighted: true,
    features: [
      "Unlimited scans",
      "LLM-powered defect detection",
      "Autonomous fix loop",
      "Performance + observability scanners",
      "Full security gates",
      "CI/CD pipeline integration",
      "HTML reports + email support",
    ],
    limits: {
      scansPerMonth: "unlimited",
      llmScanning: true,
      securityGates: "full",
      chaosTesting: false,
      compliance: false,
      dashboard: "full",
      reports: "html",
      support: "email",
    },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 199,
    yearlyPrice: 159,
    description: "Chaos testing, compliance, and antifragile scoring for regulated industries.",
    cta: "Start Free Trial",
    trial: "14-day free trial",
    features: [
      "Everything in Pro",
      "Chaos testing & adversarial probes",
      "API contract scanner",
      "Compliance & evidence chain",
      "Antifragile scoring",
      "HTML + PDF reports + dedicated support",
    ],
    limits: {
      scansPerMonth: "unlimited",
      llmScanning: true,
      securityGates: "full+custom",
      chaosTesting: true,
      compliance: true,
      dashboard: "full+antifragile",
      reports: "html+pdf",
      support: "dedicated",
    },
  },
];
