# CalCheck - Implementation Guide

## ⚡ Phase 1: Core Setup COMPLETE ✅

Your CalCheck project skeleton is ready! Here's what's been set up:

### Files Created:
```
✅ package.json          - All dependencies
✅ vite.config.js        - Vite + PWA configuration  
✅ tailwind.config.js    - Tailwind CSS theme
✅ postcss.config.js     - PostCSS with Tailwind
✅ index.html            - HTML entry point
✅ .gitignore            - Git ignore rules
✅ .env.example          - Environment template
✅ README.md             - Project documentation
✅ SETUP.md              - Detailed setup instructions
```

## 🚀 Next Steps to Get Running

### 1. Organize Project Structure
Create the `src/` folder structure:

```bash
mkdir -p src/services src/hooks src/screens src/components
```

### 2. Copy Files to Proper Locations
Move/copy these underscore-separated files to the correct structure:

```
src_App.jsx                    → src/App.jsx
src_main.jsx                   → src/main.jsx
src_index.css                  → src/index.css
src_services_supabase.js       → src/services/supabase.js
src_services_gemini.js         → src/services/gemini.js
src_services_database.js       → src/services/database.js
src_hooks_useCamera.js         → src/hooks/useCamera.js
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Setup Supabase
- Create project at supabase.com
- Run SQL commands from SETUP.md
- Enable Google OAuth
- Copy URL & anon key to .env.local

### 5. Get API Keys
- **Gemini API:** https://ai.google.dev/
- **Razorpay:** https://razorpay.com/ (for later)

### 6. Create .env.local
```
VITE_SUPABASE_URL=your_url
VITE_SUPABASE_ANON_KEY=your_key
VITE_GEMINI_API_KEY=your_key
```

### 7. Start Development
```bash
npm run dev
```

## 📋 Remaining Tasks

### Phase 2: Camera & Onboarding (Next)
- [ ] Build onboarding overlay component
- [ ] Implement camera permissions flow
- [ ] Create camera modal with live preview
- [ ] Implement photo capture button

### Phase 3: AI Integration
- [ ] Complete Gemini API integration
- [ ] Test image compression
- [ ] Handle response parsing
- [ ] Add error handling

### Phase 4: UI Screens
- [ ] ScanScreen (headline + buttons + progress card)
- [ ] CameraModal (full-screen camera)
- [ ] AnalysisScreen (loading animation)
- [ ] ResultsScreen (food display)
- [ ] ProgressScreen (daily tracking + charts)
- [ ] ProfileScreen (settings)

### Phase 5: Auth & Database
- [ ] Google OAuth flow
- [ ] User profile creation
- [ ] Meal logging (create, read, delete)
- [ ] Daily/weekly calculations

### Phase 6: Premium Features
- [ ] Free tier scan limit (3/day)
- [ ] Razorpay payment integration
- [ ] Subscription management

### Phase 7: Progress Tracking
- [ ] Daily calculations
- [ ] 7-day charts
- [ ] Weekly breakdowns

### Phase 8: PWA & Deploy
- [ ] Service worker optimization
- [ ] Mobile testing
- [ ] Vercel/Netlify deployment

## 📱 File Structure After Organization

```
calcheck/
├── public/
│   ├── manifest.json
│   ├── icon-192.png
│   └── icon-512.png
│
├── src/
│   ├── components/
│   │   ├── BottomNav.jsx
│   │   ├── ProgressBar.jsx
│   │   ├── MealCard.jsx
│   │   └── TodaysSummary.jsx
│   │
│   ├── hooks/
│   │   └── useCamera.js
│   │
│   ├── screens/
│   │   ├── ScanScreen.jsx
│   │   ├── CameraModal.jsx
│   │   ├── AnalysisScreen.jsx
│   │   ├── ResultsScreen.jsx
│   │   ├── ProgressScreen.jsx
│   │   ├── ProfileScreen.jsx
│   │   └── OnboardingScreen.jsx
│   │
│   ├── services/
│   │   ├── supabase.js
│   │   ├── gemini.js
│   │   └── database.js
│   │
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
│
├── index.html
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
└── README.md
```

## ⚙️ Services Already Implemented

### ✅ Supabase Client (`src/services/supabase.js`)
- OAuth initialization
- Sign in with Google
- Sign out
- Get current user

### ✅ Gemini Integration (`src/services/gemini.js`)
- Image compression (>500KB target)
- API call with structured prompt
- JSON parsing & validation
- Error handling

### ✅ Database Operations (`src/services/database.js`)
- Meal CRUD (create, read, delete)
- Daily/weekly calculations
- User profile management
- Scan counter tracking

### ✅ Camera Hook (`src/hooks/useCamera.js`)
- Permission handling
- Live video stream
- Photo capture
- Canvas drawing

## 🎯 Priority for Phase 2

The **OnboardingScreen** should be built next because:
1. It's the first user interaction
2. It requests camera permissions
3. Sets up the app state
4. Minimal dependencies

Then build **ScanScreen** with:
- Headline: "Scan Food"
- Button: "Open Camera"
- Button: "Upload Image"
- Today's Progress card

These create the foundation for all other screens.

## 🔑 Key Design Principles

- **Camera-first:** Minimize friction to scanning
- **Fast:** <2s to interactive, <3s analysis
- **Beautiful:** Large typography, premium feel
- **Simple:** Simplicity > features
- **Mobile:** Touch-optimized, full-screen

## 💡 Tips

1. **Start with mock data** - Build UI first, integrate API later
2. **Test camera early** - Browser permissions can be tricky
3. **Optimize images** - Gemini works best with compressed images <500KB
4. **Real-time feedback** - Use loading states to show progress
5. **Use local storage** - Cache user preferences and onboarding state

## 🚨 Common Issues

**"Cannot find module"** → Check file paths, use forward slashes in imports
**Camera not working** → Test in HTTPS or localhost, check permissions
**Gemini API errors** → Verify API key, check image format, handle JSON parsing
**Supabase errors** → Verify RLS policies, check user authentication

## 🎉 You're Ready!

The foundation is solid. Start with Phase 2 and build incrementally. Test frequently on mobile!

Questions? Check SETUP.md for detailed instructions.

---

**CalCheck:** Snap food. Track progress. 💚
