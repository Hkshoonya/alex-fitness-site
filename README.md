# Alex Davis Fitness

A full-featured fitness training website for [Alex Davis Fitness](https://www.alexsfitness.com/) in Temple Terrace, FL. Built with React, TypeScript, Tailwind CSS, and GSAP animations. Fully integrated with Square, Google, and Trainerize APIs.

**[Live Site](https://hkshoonya.github.io/alex-fitness-site/)**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript |
| Styling | Tailwind CSS 3.4 + custom CSS |
| Animations | GSAP + ScrollTrigger |
| Build | Vite 7 |
| Payments | Square Web Payments SDK |
| Booking | Square Bookings API |
| Reviews | Google Places API |
| Video Calls | Google Calendar + Meet API |
| Training App | Trainerize API |
| Hosting | GitHub Pages |

---

## Features

### Landing Page (10 Sections)
- Hero with full-bleed background + GSAP entrance animations
- "Stronger Body, Stronger Mind" value proposition
- Training Plans with category cards (Personal / Virtual)
- Private Studio showcase
- Client Transformations gallery (12 real photos, crossfade slideshow)
- Meet Your Coach (dynamic, syncs from Square team members)
- Client Reviews (daily Google sync, 5-star filter)
- Book Your Session (Book a Free Call + Meet Me)
- Location & Hours with map
- Footer with logo, nav, Instagram, DocZeus credit

### About Page
- Studio history timeline (4-step journey)
- Studio photo gallery (12 images, slideshow + thumbnails)
- Philosophy & values cards
- Stats bar (20+ Years, 500+ Clients, 5.0 Rating)
- Personal note from Alex with portrait
- Full CTA section

### Booking System
- **Book Now** (nav button): Choose between Book Session or Free Consultation
- **Book Session**: Pick 30 or 60 min, choose coach, in-studio or virtual, calendar + time slots
- **Free Consultation**: 30 min max, in-studio or virtual, straight to calendar
- All other site buttons go directly to Free Consultation flow
- Square calendar availability sync (15-min cache)
- Google Meet auto-creation for virtual sessions
- Confirmation screen persists until user clicks Done

### Training Plans Shop
- 9 plans synced from [alexsfitness.com/s/shop](https://www.alexsfitness.com/s/shop)
- 4-Week plans: 30/60/90 min sessions ($45-$100/session)
- 12-Week plans: 30/60/90 min sessions ($35-$90/session, save $10/session)
- Online: Fitness App ($10), Monthly coaching ($100), 3-Month coaching ($250)
- Frequency selector (1-5x/week) with live price calculation
- Trainer selection with discount display
- Square catalog daily sync keeps prices in sync
- Client info capture (name/email/phone) on payment step
- Sale badges, "Most Popular" badges, category filters

### Coach Section
- Alex Davis permanently displayed as Head Coach
- Additional coaches auto-populate from Square Team Members API
- Toggle between coaches (arrows + dot indicators + avatar pills)
- Stats, credentials, bio update per coach
- "Book a Free Call" (message modal) + "Meet Me" (booking modal)
- Glassmorphism design with blurred background

### Reviews
- Daily auto-sync from Google Places API
- Only 5-star reviews displayed on site
- "See all reviews on Google Maps" link for others
- Auto-rotating featured review carousel
- Mini review cards grid
- Manual refresh button
- Google branding with rating summary bar

### Integrations

#### Square (Payments + Catalog + Bookings + Calendar + Team + Messages)
- Payment processing via Web Payments SDK
- Catalog price sync (24h cache) keeps plans in sync with Square shop
- Booking creation syncs to Square calendar
- Team members fetched for coach section
- Quick message creates customer + note in Square Dashboard

#### Google (Reviews + Meet + Calendar)
- Google Places API for review fetching (24h cache, 5-star filter)
- Google Calendar event creation for virtual sessions
- Google Meet link auto-generated with attendees
- Client receives calendar invite + Meet link via email
- Reminders: 1h email + 15min popup

#### Trainerize (Client + Booking + Payment + Credits)
- New client auto-provisioned on plan purchase
- Trainerize generates unique ID + temporary password
- Activation email sent to client automatically
- Purchased plan assigned as training program
- Payment logged in Trainerize
- Session credits set (total, remaining, expiry)
- Every Square booking auto-syncs client + appointment to Trainerize
- Supports Direct API (Studio/Enterprise) or Webhook via Zapier (any plan)

---

## Setup

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Environment Variables

Copy `.env.example` to `.env` and fill in your keys. Everything runs in demo mode without keys.

| Variable | Service | Purpose |
|----------|---------|---------|
| `VITE_SQUARE_APPLICATION_ID` | Square | Client-side payment form |
| `VITE_SQUARE_LOCATION_ID` | Square | Location-specific data |
| `VITE_SQUARE_ACCESS_TOKEN` | Square | Catalog, bookings, team, customers |
| `VITE_SQUARE_SERVICE_ID` | Square | Booking service type |
| `VITE_GOOGLE_PLACE_ID` | Google | Which business for reviews |
| `VITE_GOOGLE_MAPS_API_KEY` | Google | Places API access |
| `VITE_GOOGLE_CLIENT_ID` | Google | OAuth2 for Calendar |
| `VITE_GOOGLE_CLIENT_SECRET` | Google | OAuth2 token refresh |
| `VITE_GOOGLE_REFRESH_TOKEN` | Google | Server-side token renewal |
| `VITE_GOOGLE_API_KEY` | Google | Calendar API calls |
| `VITE_GOOGLE_CALENDAR_ID` | Google | Calendar for Meet events |
| `VITE_TRAINERIZE_API_KEY` | Trainerize | Direct API access |
| `VITE_TRAINERIZE_API_URL` | Trainerize | API base URL |
| `VITE_TRAINERIZE_TRAINER_ID` | Trainerize | Client assignment |
| `VITE_TRAINERIZE_WEBHOOK_URL` | Trainerize | Zapier webhook fallback |

---

## Project Structure

```
src/
  api/
    googleMeet.ts        # Google Meet link creation for virtual sessions
    reviews.ts           # Google Reviews daily sync + 5-star filter
    square.ts            # Square booking/availability core
    squareAvailability.ts # Team members + calendar availability + booking
    squareCatalog.ts     # Training plan price sync from Square catalog
    squareMessages.ts    # Quick message to Alex via Square
    squarePayments.ts    # Payment processing via Square SDK
    trainerize.ts        # Client provisioning + booking + payment sync
  components/
    AboutPage.tsx        # Full about page with timeline + gallery
    BookingModal.tsx     # Book Session / Free Consultation flow
    Calendar.tsx         # Calendar component with Square sync
    CoachSection.tsx     # Dynamic coach cards from Square team
    GoogleReviews.tsx    # Review carousel with daily sync
    PostPurchaseBooking.tsx  # Session booking after plan purchase
    QuickMessageModal.tsx    # Send message to Alex
    TrainingPlansShop.tsx    # Plan browser + purchase flow
    TransformationGallery.tsx # 12-photo crossfade slideshow
    ui/                  # 40+ shadcn/ui components
  data/
    trainingPlans.ts     # Plan definitions matching Square shop
  types/
    booking.ts           # Booking type definitions
```

---

## Changelog

### v1.0.0 — Initial Release
- 10-section landing page with GSAP scroll animations
- Square integration: payments, catalog sync, bookings, calendar
- Google Meet auto-creation for virtual consultations
- Google Reviews daily sync (5-star filter)
- Training plans matching alexsfitness.com/s/shop pricing
- Transformation gallery with 12 real client photos from alexsfitness.com
- Booking modal: in-studio vs virtual with calendar availability
- About page with studio gallery, timeline, philosophy, personal note
- Instagram (@alexdavisfit) integration across site
- Floating Instagram button (subtle glassmorphism)
- All APIs configurable via .env — runs in demo mode without keys

### v1.1.0 — DocZeus Branding
- Added DocZeus "Built by" logo in footer (SVG, red accent)
- Links to github.com/Hkshoonya
- Applied to both main site and About page footers

### v1.2.0 — Trainerize + Coach Toggle + Mobile + UX
- **Trainerize integration**: full client provisioning on purchase
  - Auto-generates client ID + temporary password
  - Sends activation email with app download link
  - Assigns purchased plan as training program
  - Logs payment and sets session credits
  - Every Square booking auto-syncs to Trainerize
  - Supports Direct API (Studio/Enterprise) or Zapier webhook (any plan)
- **Book Now flow**: nav button shows Session vs Consultation choice
  - Book Session: 30 or 60 min, pick coach, pick type, calendar
  - Free Consultation: 30 min, pick type, calendar (all other buttons)
- **Coach section**: dynamic toggle synced from Square team members
  - Alex Davis always first and persistent
  - Additional coaches auto-populate when added in Square
  - Toggle with arrows, avatar pills, dot indicators
  - Each coach gets own photo, bio, stats, credentials
- **Mobile responsive fixes**:
  - All headlines reduced for small screens with break-words
  - Coach section: smaller stats, truncated credentials, stacked CTAs
  - Global overflow-x hidden prevents horizontal scroll
- **Logo**: switched to circular badge matching alexsfitness.com
- **Booking modals**: stay open until user clicks Done (no auto-close)
- **Payment step**: captures client name/email/phone for Trainerize provisioning
- **Square Messages**: "Book a Free Call" sends message to Alex via Square
- **Quick Message modal**: name, phone, message form

---

## License

Private project. All rights reserved.

---

<p align="center">
  Built by <a href="https://github.com/Hkshoonya">DocZeus</a>
</p>
