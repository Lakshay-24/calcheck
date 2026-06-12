# calcheck - Premium Mobile-First Calorie Tracker PWA

Snap food. Track calories & protein.

## Overview

calcheck is a premium mobile-first Progressive Web App designed for Indian gym-goers (18-35) to track daily calorie and protein intake by photographing food items.

**Core UX:** Camera-first, minimal UI, beautiful results, instant feel.

## Features

- 📸 **Food Scanning:** Take photos of meals and get instant calorie analysis
- 🤖 **AI-Powered:** OpenAI Vision analyzes food and nutrition through a secure Supabase Edge Function
- 📊 **Daily Tracking:** Monitor calories, protein, carbs, and fat intake
- 📈 **Progress Charts:** 7-day history with daily breakdowns
- ⚡ **Instant Performance:** <2 seconds to interactive, <3 seconds for analysis
- 🎨 **Premium Design:** Apple Health / Oura / Strava inspired aesthetic
- 📱 **PWA:** Installable on mobile and desktop, works offline
- 💰 **India First:** Razorpay payments, ₹99/month premium

## Tech Stack

- **Frontend:** React 18 + Vite
- **Backend:** Supabase (PostgreSQL + Auth)
- **AI:** OpenAI Vision via Supabase Edge Function
- **Payments:** Razorpay
- **Styling:** Tailwind CSS
- **Storage:** Supabase + IndexedDB

## Quick Start

### Prerequisites
- Node.js 16+
- npm or yarn
- Supabase account
- OpenAI API key configured as a Supabase Edge Function secret
- Razorpay account (for premium)

### Installation

1. Clone the repository
```bash
git clone <repo-url>
cd calcheck
```

2. Install dependencies
```bash
npm install
```

3. Create `.env.local` with your keys
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_USE_MOCK_AI=false
VITE_RAZORPAY_KEY_ID=your_razorpay_key_id
```

4. Setup Supabase database and Edge Function (see SETUP.md)

5. Start development server
```bash
npm run dev
```

## Project Structure

```
src/
├── screens/          # Page components (Scan, Progress, Profile, etc)
├── components/       # Reusable UI components
├── services/         # API & external service integrations
├── hooks/           # Custom React hooks
└── App.jsx          # Main router and layout
```

## User Flow

```
Open App
    ↓
Scan Tab (default)
    ↓
Tap "Open Camera"
    ↓
Take Photo
    ↓
Analyze (OpenAI Vision)
    ↓
Results Screen (show nutrition)
    ↓
Tap "Save Meal" (requires login)
    ↓
Progress Updates
```

## Design System

- **Colors:** White background, aqua mint (#80F9CB), mint core (#46E8C2), cyan/turquoise (#11F5F6), deep text (#102A2A)
- **Typography:** Large numbers (48-56px), clean hierarchy
- **Components:** Rounded cards, iOS-style navigation, smooth transitions
- **Philosophy:** Premium consumer app, simplicity over features

## Key Screens

1. **Scan Screen** (default tab)
   - Large "Scan Food" headline
   - "Open Camera" and "Upload Image" buttons
   - Today's Progress card (calories + protein)

2. **Camera Modal**
   - Full-screen preview
   - Large shutter button
   - Minimal UI chrome

3. **Results Screen**
   - Large food image
   - Large calorie/protein numbers
   - Meal score and macros
   - Save button

4. **Progress Screen**
   - Daily totals + goal progress bars
   - 7-day chart
   - Weekly breakdown

5. **Profile Screen**
   - User settings
   - Goal configuration
   - Subscription status

## Performance Targets

- ⚡ First paint: <1s
- ⚡ Time to interactive: <2s
- ⚡ AI analysis: <5-10s
- ⚡ Image compression: Automatic before API

## Monetization

**Free Tier**
- 3 scans per day
- No meal history

**Premium (₹99/month)**
- Unlimited scans
- Full meal history
- Daily tracking
- 7-day & 30-day insights
- Goal settings

## Deployment

```bash
# Build for production
npm run build

# Deploy to Vercel / Netlify
# PWA will be automatically installable
```

## API Integration

### Food Analysis Response Format

```json
{
  "food_name": "Chicken Biryani",
  "calories": 824,
  "protein": 37,
  "carbs": 91,
  "fat": 28,
  "meal_score": 68,
  "protein_level": "Medium",
  "recommended_for": "Muscle Gain",
  "portion_size": "Medium",
  "estimated_grams": 350,
  "portion_confidence": 0.7,
  "confidence": 0.82,
  "candidates": [
    { "name": "Chicken Biryani", "confidence": 0.82 }
  ]
}
```

## Development Roadmap

- [x] Phase 1: Core setup (Vite, Tailwind, Supabase)
- [ ] Phase 2: Camera & Onboarding
- [ ] Phase 3: OpenAI Vision Integration
- [ ] Phase 4: UI Screens
- [ ] Phase 5: Authentication & Database
- [ ] Phase 6: Premium & Payments
- [ ] Phase 7: Progress Tracking
- [ ] Phase 8: PWA & Deployment

## Contributing

This is a private project. For questions or contributions, reach out to the team.

## License

Private - All rights reserved

---

**calcheck:** Snap food. Track progress.
