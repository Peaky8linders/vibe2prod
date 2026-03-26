# VibeCheck Dashboard — Free Deployment Guide

Deploy the VibeCheck landing page + dashboard to free hosting in under 5 minutes.

## Option 1: Vercel (Recommended — Fastest)

Vercel is the company behind Next.js. Zero-config deployment.

### Steps

1. **Push to GitHub** (already done — your repo is at `github.com/Peaky8linders/vibe2prod`)

2. **Go to [vercel.com](https://vercel.com)** and sign in with GitHub

3. **Import your repository**
   - Click "Add New" → "Project"
   - Select `Peaky8linders/vibe2prod`
   - Set the **Root Directory** to `v2p-complete-package/repo/dashboard`
   - Framework Preset will auto-detect **Next.js**

4. **Deploy** — Click "Deploy" and wait ~60 seconds

5. **Done** — You get a URL like `vibecheck-dashboard.vercel.app`

### Custom Domain (Optional)
- Go to Project Settings → Domains
- Add your domain (e.g., `vibecheck.dev`)
- Update DNS records as instructed

### Environment Variables (Optional)
If you want real scan data instead of demo mode:
- No env vars needed for the landing page + demo dashboard
- The `/api/scan` endpoint reads from `reports/scan-e2e-result.json` if present

---

## Option 2: Netlify

1. Go to [app.netlify.com](https://app.netlify.com) and sign in with GitHub

2. Click "Add new site" → "Import an existing project"

3. Connect to `Peaky8linders/vibe2prod`

4. Set build settings:
   - **Base directory**: `v2p-complete-package/repo/dashboard`
   - **Build command**: `npm run build`
   - **Publish directory**: `.next` (the Netlify Next.js plugin handles this)

5. Install the Next.js plugin (required for App Router):
   - Go to Site settings → Build & deploy → Plugins
   - Add `@netlify/plugin-nextjs`

6. Deploy

---

## Option 3: Cloudflare Pages

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages

2. Click "Create" → "Pages" → "Connect to Git"

3. Select your repository

4. Set build settings:
   - **Root directory**: `v2p-complete-package/repo/dashboard`
   - **Build command**: `npx @cloudflare/next-on-pages`
   - **Build output directory**: `.vercel/output/static`

5. Add environment variable:
   - `NODE_VERSION` = `20`

6. Deploy

---

## Option 4: Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub

2. Click "New Project" → "Deploy from GitHub repo"

3. Select your repository

4. Set:
   - **Root Directory**: `v2p-complete-package/repo/dashboard`
   - **Start Command**: `npm run start`

5. Railway auto-detects Next.js and deploys

Free tier: 500 hours/month, $5 credit.

---

## Quick Checklist Before Sharing

- [ ] Landing page loads at root URL (`/`)
- [ ] Pricing section shows 3 tiers (Free, $49, $199)
- [ ] Annual toggle switches prices to $39/$159
- [ ] "Get Started Free" buttons link to `/dashboard`
- [ ] Dashboard loads with demo data (88% readiness)
- [ ] All 4 dashboard tabs work (Overview, Files, Store, Antifragile)
- [ ] Mobile responsive (test on phone)

## Social Sharing Tips

### Reddit
Best subreddits: r/webdev, r/selfhosted, r/programming, r/devops
Title format: "I built an antifragile code hardening tool — it doesn't just find bugs, it fixes them while you sleep"

### X/Twitter
Thread format works best:
1. Hook: "Security scanners tell you what's broken. We built something that fixes it."
2. Demo: Link to deployed dashboard
3. Differentiator: "Antifragile — your code gets stronger from every attack"
4. CTA: Link to GitHub repo

### Product Hunt
- Schedule launch for Tuesday-Thursday, 12:01 AM PT
- Use the dashboard URL as the product link
- Tagline: "Your code gets stronger from every attack"

---

## Troubleshooting

**Build fails on Vercel?**
- Ensure Root Directory is set to `v2p-complete-package/repo/dashboard`
- Check that `package-lock.json` is committed (run `npm install` and commit it)

**Dashboard shows "demo data" banner?**
- This is expected! The demo data shows the product's capabilities
- To show real data, run `vibecheck scan:e2e --path <your-project> --report` and commit the report

**Page loads but looks broken?**
- Clear build cache on your hosting platform
- Check that Tailwind CSS 4 is supported (Vercel supports it natively)
