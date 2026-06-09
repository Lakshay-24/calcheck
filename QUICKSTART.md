# CalCheck - QUICKSTART (5 Minutes)

## What You Have

✅ Complete project foundation  
✅ All services integrated (Supabase, Gemini, Camera)  
✅ Tailwind CSS configured  
✅ PWA ready  
✅ 19 files + documentation  

## Organize Files (1 minute)

### On Windows Command Prompt:

```bash
mkdir src\services src\hooks src\screens src\components public

move src_App.jsx src\App.jsx
move src_main.jsx src\main.jsx
move src_index.css src\index.css
move src_services_supabase.js src\services\supabase.js
move src_services_gemini.js src\services\gemini.js
move src_services_database.js src\services\database.js
move src_hooks_useCamera.js src\hooks\useCamera.js
```

Or manually via File Explorer:
1. Create `src` folder
2. Create subfolders: `services`, `hooks`, `screens`, `components`
3. Move/rename files accordingly

## Get API Keys (2 minutes)

### Supabase
1. Go to https://supabase.com → Sign up
2. Create project
3. Go to Settings → API
4. Copy **Project URL** and **anon key**

### Google Gemini
1. Go to https://ai.google.dev/
2. Click "Get API Key"
3. Create new API key
4. Copy it

## Create .env.local (1 minute)

```bash
# Create file: .env.local
VITE_SUPABASE_URL=your_project_url_here
VITE_SUPABASE_ANON_KEY=your_anon_key_here
VITE_GEMINI_API_KEY=your_gemini_key_here
```

## Setup Supabase Database (1 minute)

1. In Supabase dashboard, go to **SQL Editor**
2. Click **New Query**
3. Paste this entire SQL (from SETUP.md):

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT UNIQUE NOT NULL,
  goal TEXT DEFAULT 'muscle_gain',
  calorie_target INTEGER DEFAULT 2500,
  protein_target INTEGER DEFAULT 150,
  subscription_status TEXT DEFAULT 'free',
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
  meal_score INTEGER NOT NULL
);

-- Scan counters table
CREATE TABLE scan_counters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  scan_count INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

-- Enable row level security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_counters ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own meal logs"
  ON meal_logs FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own meal logs"
  ON meal_logs FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own meal logs"
  ON meal_logs FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert scan counters"
  ON scan_counters FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own scan counters"
  ON scan_counters FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own scan counters"
  ON scan_counters FOR UPDATE USING (auth.uid() = user_id);
```

4. Click **Run**
5. Enable Google Auth: Authentication → Providers → Google → Enable

## Run Development Server (1 minute)

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Open browser to: http://localhost:5173
```

## ✅ Done! You're Live

You now have a working development environment with:
- ✅ React app running locally
- ✅ Hot reload enabled
- ✅ Supabase connected
- ✅ Gemini API ready
- ✅ Camera access ready
- ✅ Tailwind CSS working

## 🎯 Next: Build Phase 2

Start building UI screens. Best order:

1. **OnboardingScreen.jsx** (~50 lines)
   - "Snap food. Track calories & protein."
   - "Start Scanning" button

2. **ScanScreen.jsx** (~100 lines)
   - Headline: "Scan Food"
   - Button: "Open Camera"
   - Button: "Upload Image"  
   - Today's Progress card

3. **CameraModal.jsx** (~150 lines)
   - Full-screen camera
   - Shutter button
   - Capture photo

Templates available in COMMANDS.md

## 📖 Documentation

- **README.md** - Project overview
- **SETUP.md** - Detailed setup
- **IMPLEMENTATION.md** - Full roadmap
- **COMMANDS.md** - Command reference
- **COMPLETION_SUMMARY.md** - What's done

## 🆘 Troubleshooting

**Port 5173 in use?**
```bash
npm run dev -- --port 3000
```

**Tailwind not working?**
- Check files are in `src/`
- Run `npm run build` to test
- Clear browser cache (Ctrl+Shift+Delete)

**Supabase connection error?**
- Check .env.local values
- Verify URL format (should include .supabase.co)
- Check API key is correct

**Camera not showing?**
- Test in HTTPS or localhost
- Check browser console for errors
- Allow camera permissions

## 🚀 You're Ready!

Everything is set up and working. Start building screens and enjoy!

---

**Time invested:** 5 minutes  
**Time to MVP:** 2-3 weeks  
**Team size:** 1-2 developers

Let's go! 💚
