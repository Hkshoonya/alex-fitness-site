# Alex Davis Fitness — Setup TODO

Everything below needs to be done once. The website runs in demo mode until these are configured.

---

## 1. Square (Payments + Bookings + Calendar)

### Get Your Keys
- [ ] Go to https://developer.squareup.com/apps
- [ ] Create an app (or use existing)
- [ ] Copy **Application ID** → `VITE_SQUARE_APPLICATION_ID`
- [ ] Go to app > Locations → Copy **Location ID** → `VITE_SQUARE_LOCATION_ID`
- [ ] Go to app > Credentials → Copy **Access Token** → `VITE_SQUARE_ACCESS_TOKEN`

### Set Up Services (for booking)
- [ ] In Square Dashboard > Items & Services, create 3 services:
  - Free Consultation (30 min, $0)
  - Training Session 30 Min ($45)
  - Training Session 60 Min ($70)
- [ ] Or use API to create them (already done for sandbox)
- [ ] Copy each service's **Variation ID** into `.env`:
  - `VITE_SQUARE_SERVICE_CONSULTATION`
  - `VITE_SQUARE_SERVICE_30MIN`
  - `VITE_SQUARE_SERVICE_60MIN`

### Switch from Sandbox to Production
- [ ] Replace sandbox Application ID with production one (remove `sandbox-` prefix)
- [ ] Replace sandbox Access Token with production token
- [ ] Replace sandbox Location ID with production Location ID
- [ ] Create production services and update Variation IDs
- [ ] Code auto-detects sandbox vs production — no other changes needed

---

## 2. Google Reviews (Daily Auto-Sync)

### Get Place ID
- [ ] Go to https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder
- [ ] Search "Alex Davis Fitness Temple Terrace"
- [ ] Copy the Place ID → `VITE_GOOGLE_PLACE_ID`

### Get API Key
- [ ] Go to https://console.cloud.google.com/apis/credentials
- [ ] Create an API key
- [ ] Enable **Places API** at https://console.cloud.google.com/apis/library/places-backend.googleapis.com
- [ ] Copy key → `VITE_GOOGLE_MAPS_API_KEY`
- [ ] Restrict key to Places API only (recommended)

---

## 3. Google Meet / Calendar (Virtual Sessions)

### Create OAuth2 Credentials
- [ ] Go to https://console.cloud.google.com/apis/credentials
- [ ] Create OAuth 2.0 Client ID (Web application type)
- [ ] Copy **Client ID** → `VITE_GOOGLE_CLIENT_ID`
- [ ] Copy **Client Secret** → `VITE_GOOGLE_CLIENT_SECRET`

### Enable Calendar API
- [ ] Go to https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
- [ ] Click Enable

### Get Refresh Token
- [ ] Go to https://developers.google.com/oauthplayground/
- [ ] Settings (gear icon) → Check "Use your own OAuth credentials"
- [ ] Enter your Client ID and Client Secret
- [ ] In Step 1, select scope: `https://www.googleapis.com/auth/calendar.events`
- [ ] Authorize → Exchange code for tokens
- [ ] Copy **Refresh Token** → `VITE_GOOGLE_REFRESH_TOKEN`

### Get API Key
- [ ] Use same API key from Google Reviews, or create a new one
- [ ] Enable Calendar API on it
- [ ] Copy → `VITE_GOOGLE_API_KEY`

### Calendar ID
- [ ] Default is `primary` (Alex's main Google Calendar)
- [ ] To use a specific calendar: Google Calendar > Settings > Calendar ID
- [ ] Set → `VITE_GOOGLE_CALENDAR_ID`

---

## 4. Trainerize (Client + Booking + Credits Sync)

### Option A: Direct API (Studio/Enterprise plan)
- [ ] Contact help@trainerize.com to get API access enabled
- [ ] In Trainerize > Settings > API, copy your **API Key** → `VITE_TRAINERIZE_API_KEY`
- [ ] Get the **API Base URL** they provide → `VITE_TRAINERIZE_API_URL`
- [ ] In Trainerize > Settings > Account, find your **Trainer ID** → `VITE_TRAINERIZE_TRAINER_ID`

### Option B: Zapier Webhook (any plan)
- [ ] Go to https://zapier.com
- [ ] Create a new Zap with trigger: "Webhooks by Zapier" → "Catch Hook"
- [ ] Copy the webhook URL → `VITE_TRAINERIZE_WEBHOOK_URL`
- [ ] Add Zap actions:
  - ABC Trainerize → Create/Update Client
  - ABC Trainerize → Send Message (optional)
- [ ] Turn on the Zap

---

## 5. Square Webhook → Trainerize Sync (Recurring Payments)

This is for auto-syncing session credits when Square charges a recurring subscription.

### Deploy the Cloudflare Worker
- [ ] Install Wrangler: `npm install -g wrangler`
- [ ] Login: `wrangler login`
- [ ] Deploy: `cd worker && wrangler deploy`
- [ ] Note the deployed URL (e.g. `https://alex-fitness-webhook.your-subdomain.workers.dev`)

### Set Worker Environment Variables
- [ ] Go to Cloudflare Dashboard > Workers > alex-fitness-webhook > Settings > Variables
- [ ] Add:
  - `SQUARE_APPLICATION_ID` — your Square app ID
  - `SQUARE_ACCESS_TOKEN` — your Square access token
  - `SQUARE_WEBHOOK_SIGNATURE_KEY` — from Square (next step)
  - `TRAINERIZE_API_KEY` — your Trainerize API key
  - `TRAINERIZE_API_URL` — `https://api.trainerize.com/v2`
  - `TRAINERIZE_TRAINER_ID` — your Trainerize trainer ID

### Register Webhook in Square
- [ ] Go to https://developer.squareup.com/apps > Your App > Webhooks
- [ ] Add endpoint:
  - URL: your Worker URL from above
  - Events: `subscription.updated`, `payment.completed`
- [ ] Copy the **Signature Key** → set as `SQUARE_WEBHOOK_SIGNATURE_KEY` in Cloudflare

### Test
- [ ] In Square sandbox, create a test subscription
- [ ] Check Cloudflare Worker logs for webhook receipt
- [ ] Verify Trainerize credits updated

---

## 6. Deploy Website

### GitHub Pages (current)
- [ ] `npm run build` then `npx gh-pages -d dist`
- [ ] Live at: https://hkshoonya.github.io/alex-fitness-site/

### Custom Domain (later)
- [ ] Buy domain (e.g. alexdavisfitness.com)
- [ ] Option A: Cloudflare Pages (recommended)
  - Connect GitHub repo
  - Set build command: `npm run build`
  - Set output dir: `dist`
  - Add custom domain
- [ ] Option B: Netlify
  - Connect GitHub repo
  - Same build settings
  - Add custom domain
- [ ] Update `vite.config.ts` base to `/` for custom domain

---

## 7. Instagram
- [x] Connected: https://www.instagram.com/alexdavisfit/reels/
- [x] Icon in nav, mobile menu, footer, floating button
- [ ] Consider connecting Instagram Graph API for auto-feed (future)

---

## Quick Reference: All Environment Variables

```env
# Square
VITE_SQUARE_APPLICATION_ID=
VITE_SQUARE_LOCATION_ID=
VITE_SQUARE_ACCESS_TOKEN=
VITE_SQUARE_SERVICE_CONSULTATION=
VITE_SQUARE_SERVICE_30MIN=
VITE_SQUARE_SERVICE_60MIN=

# Google Reviews
VITE_GOOGLE_PLACE_ID=
VITE_GOOGLE_MAPS_API_KEY=

# Google Meet / Calendar
VITE_GOOGLE_CLIENT_ID=
VITE_GOOGLE_CLIENT_SECRET=
VITE_GOOGLE_REFRESH_TOKEN=
VITE_GOOGLE_API_KEY=
VITE_GOOGLE_CALENDAR_ID=primary

# Trainerize
VITE_TRAINERIZE_API_KEY=
VITE_TRAINERIZE_API_URL=https://api.trainerize.com/v2
VITE_TRAINERIZE_TRAINER_ID=
VITE_TRAINERIZE_WEBHOOK_URL=
```

---

## Current Status

| Integration | Status | Notes |
|-------------|--------|-------|
| Square Payments | Sandbox ready | Switch to production keys |
| Square Bookings | Sandbox ready | 3 services created |
| Square Team Sync | Working | 2 team members in sandbox |
| Square Catalog Sync | Working | Plans sync from catalog |
| Square Messages | Working | Creates customer + note |
| Square Subscriptions | Code ready | Needs production subscription plans |
| Google Reviews | Demo mode | Needs Place ID + API key |
| Google Meet | Demo mode | Needs OAuth2 credentials |
| Trainerize | Demo mode | Needs API key or Zapier webhook |
| Webhook Worker | Code ready | Needs Cloudflare deploy |
| Instagram | Connected | @alexdavisfit |
| GitHub Pages | Deployed | https://hkshoonya.github.io/alex-fitness-site/ |
