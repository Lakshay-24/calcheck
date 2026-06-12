# CalCheck - Setup Guide

## Project Structure

```
calcheck/
├── index.html                  # Entry point
├── vite.config.js             # Vite + PWA configuration
├── tailwind.config.js         # Tailwind theme config
├── postcss.config.js          # PostCSS config
├── package.json               # Dependencies
├── .env.example              # Environment variables template
│
├── src/
│   ├── main.jsx              # App entry point
│   ├── App.jsx               # Main router & layout
│   ├── index.css             # Global styles
│   │
│   ├── services/
│   │   ├── supabase.js       # Supabase client & auth
│   │   ├── ai.js             # Food analysis client wrapper
│   │   └── database.js       # Supabase database operations
│   │
│   ├── hooks/
│   │   └── useCamera.js      # Camera capture hook
│   │
│   ├── screens/
│   │   ├── ScanScreen.jsx    # Main scan screen (Scan tab)
│   │   ├── ProgressScreen.jsx # Daily progress tracking
│   │   ├── ProfileScreen.jsx # User profile & settings
│   │   ├── CameraModal.jsx   # Full-screen camera
│   │   ├── AnalysisScreen.jsx # Loading state
│   │   ├── ResultsScreen.jsx # Food analysis results
│   │   └── OnboardingScreen.jsx # First launch
│   │
│   └── components/
│       ├── BottomNav.jsx     # Tab navigation
│       ├── ProgressBar.jsx   # Goal progress display
│       ├── MealCard.jsx      # Meal history item
│       ├── TodaysSummary.jsx # Today's progress card
│       └── Badge.jsx         # Protein level badge
│
└── public/
    ├── manifest.json        # PWA metadata
    ├── icon-192.png        # PWA icon
    └── icon-512.png        # PWA icon
```

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Create Supabase Project
- Go to https://supabase.com
- Create a new project
- Copy URL and anon key

### 3. Database Setup

Run these SQL commands in Supabase:

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT UNIQUE NOT NULL,
  goal TEXT DEFAULT 'muscle_gain',
  calorie_target INTEGER DEFAULT 2500,
  protein_target INTEGER DEFAULT 150,
  subscription_status TEXT DEFAULT 'free',
  subscription_end_date TIMESTAMP,
  scans_used_today INTEGER DEFAULT 0,
  timezone TEXT,
  timezone_updated_at TIMESTAMPTZ,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Meal logs table
CREATE TABLE meal_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timestamp TIMESTAMP DEFAULT NOW(),
  food_name TEXT NOT NULL,
  calories INTEGER NOT NULL,
  protein INTEGER NOT NULL,
  carbs INTEGER NOT NULL,
  fat INTEGER NOT NULL,
  meal_score INTEGER NOT NULL,
  protein_level TEXT,
  recommended_for TEXT,
  portion_size TEXT,
  portion_multiplier NUMERIC,
  estimated_grams NUMERIC,
  portion_confidence NUMERIC,
  confidence NUMERIC,
  candidates JSONB,
  timezone TEXT,
  local_date DATE,
  meal_type TEXT
);

-- Scan counters table (for free tier limit)
CREATE TABLE scan_counters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  scan_count INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

CREATE INDEX meal_logs_user_local_date_idx
  ON meal_logs (user_id, local_date DESC);

-- Enable row level security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_counters ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own meal logs"
  ON meal_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own meal logs"
  ON meal_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own meal logs"
  ON meal_logs FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert scan counters"
  ON scan_counters FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own scan counters"
  ON scan_counters FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own scan counters"
  ON scan_counters FOR UPDATE
  USING (auth.uid() = user_id);
```

### 4. Setup Google OAuth in Supabase
- Go to Supabase > Authentication > Providers
- Enable Google
- Add your Google OAuth credentials

### 5. Configure OpenAI Edge Function Secret
- Create an OpenAI API key
- Store it as a Supabase Edge Function secret, not a Vite variable

```bash
supabase secrets set OPENAI_API_KEY=your_openai_api_key
supabase secrets set OPENAI_VISION_MODEL=gpt-5.5
```

### 6. Create .env.local
```
VITE_SUPABASE_URL=your_url
VITE_SUPABASE_ANON_KEY=your_key
VITE_USE_MOCK_AI=false
VITE_RAZORPAY_KEY_ID=your_key (add later)
```

### 7. Deploy the Analyze Food Function
```bash
supabase functions deploy analyze-food
```

### 8. Start Development
```bash
npm run dev
```

## Key Features to Build

### Phase 1: Core Setup ✅
- ✅ Vite + React + PWA
- ✅ Tailwind CSS setup
- ✅ Supabase configuration
- ✅ Environment variables

### Phase 2: Camera & Onboarding
- [ ] Onboarding overlay
- [ ] Camera permissions
- [ ] Photo capture

### Phase 3: AI Integration
- [ ] OpenAI Vision Edge Function
- [ ] Image compression
- [ ] Structured output validation

### Phase 4: UI Screens
- [ ] ScanScreen (main hub)
- [ ] CameraModal (full-screen)
- [ ] ResultsScreen (display)
- [ ] AnalysisScreen (loading)
- [ ] ProgressScreen (tracking)
- [ ] ProfileScreen (settings)

### Phase 5: Authentication & Database
- [ ] Google OAuth flow
- [ ] User profile creation
- [ ] Meal CRUD operations

### Phase 6: Premium Features
- [ ] Free tier limits (3 scans)
- [ ] Razorpay integration
- [ ] Subscription management

### Phase 7: Progress Tracking
- [ ] Daily calculations
- [ ] 7-day history
- [ ] Charts & visualization

### Phase 8: PWA & Deployment
- [ ] PWA manifest & service worker
- [ ] Mobile optimization
- [ ] Deploy to Vercel/Netlify

## File Organization Notes

This initial commit includes:
- Base configuration (Vite, Tailwind, PWA)
- Service layer (Supabase, AI, Database)
- App shell and routing
- Global styles

Next phases will add screen components and features incrementally.
