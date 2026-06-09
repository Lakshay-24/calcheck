# CalCheck - Quick Command Reference

## 🚀 Initial Setup (One-time)

```bash
# 1. Organize files into proper structure
mkdir -p src/services src/hooks src/screens src/components public

# Move underscore files to correct locations
move src_App.jsx src\App.jsx
move src_main.jsx src\main.jsx
move src_index.css src\index.css
move src_services_supabase.js src\services\supabase.js
move src_services_gemini.js src\services\gemini.js
move src_services_database.js src\services\database.js
move src_hooks_useCamera.js src\hooks\useCamera.js

# 2. Install dependencies
npm install

# 3. Create environment file
copy .env.example .env.local
# Edit .env.local with your API keys

# 4. Setup database (run SQL from SETUP.md in Supabase dashboard)

# 5. Start development
npm run dev
```

## 📱 Development Commands

```bash
# Start dev server (http://localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview

# Lint code
npm run lint
```

## 🔧 Common Tasks

### Create New Screen Component
```bash
# Create file: src/screens/YourScreen.jsx
# Template:
# import React, { useEffect, useState } from 'react'
# export default function YourScreen({ user }) {
#   return <div className="p-4">Your Screen</div>
# }
```

### Create New Component
```bash
# Create file: src/components/YourComponent.jsx
# Export as default function
```

### Use Camera
```javascript
import { useCamera } from '../hooks/useCamera'

const { videoRef, capturePhoto, hasPermission, requestPermission } = useCamera()

// Request permission
await requestPermission()

// Activate camera
setIsActive(true)

// Capture photo
const base64 = capturePhoto()
```

### Analyze Food
```javascript
import { analyzeFood } from '../services/gemini'

try {
  const result = await analyzeFood(base64Image)
  // result: { food_name, calories, protein, carbs, fat, meal_score, protein_level, recommended_for }
} catch (error) {
  console.error('Analysis failed:', error)
}
```

### Save Meal
```javascript
import { saveMealLog } from '../services/database'

const mealLog = await saveMealLog(userId, {
  food_name: 'Chicken Biryani',
  calories: 824,
  protein: 37,
  carbs: 91,
  fat: 28,
  meal_score: 68,
  protein_level: 'Medium',
  recommended_for: 'Muscle Gain'
})
```

### Get Today's Meals
```javascript
import { getMealLogsToday, calculateDailyTotals } from '../services/database'

const meals = await getMealLogsToday(userId)
const totals = calculateDailyTotals(meals)
// totals: { calories, protein, carbs, fat }
```

### Check Authentication
```javascript
import { getCurrentUser } from '../services/supabase'

const user = await getCurrentUser()
if (!user) {
  // Show login
}
```

### Sign In with Google
```javascript
import { signInWithGoogle } from '../services/supabase'

const { data } = await signInWithGoogle()
```

## 📂 File Organization

Current structure after setup:
```
src/
├── App.jsx                 # Main router
├── main.jsx                # Entry point
├── index.css               # Global styles
├── components/             # Reusable UI
├── hooks/                  # React hooks
├── screens/                # Page components
└── services/               # API/DB layer
    ├── supabase.js        # Auth
    ├── gemini.js          # AI API
    └── database.js        # DB ops
```

## 🎯 Build Order for MVP

1. **OnboardingScreen** - First time UX
2. **CameraModal** - Camera capture
3. **ScanScreen** - Main hub (headline + buttons + today's card)
4. **AnalysisScreen** - Loading state
5. **ResultsScreen** - Food display + save
6. **BottomNav** - Navigation
7. **ProgressScreen** - Daily tracking
8. **ProfileScreen** - Settings
9. **Payment flow** - Razorpay
10. **Charts** - 7-day history

## 🔍 Testing

### Test Camera
```bash
# Run locally in Chrome
npm run dev
# Go to http://localhost:5173
# Check browser console for permissions
# Test with "Open Camera" button
```

### Test API Integration
```javascript
// In browser console
import { analyzeFood } from './services/gemini'
const result = await analyzeFood(base64Image)
console.log(result)
```

### Test Supabase
```javascript
// In browser console
import { supabase } from './services/supabase'
const { data } = await supabase.from('users').select('*').limit(1)
console.log(data)
```

## 🐛 Debugging

### Camera not working
- Check HTTPS or localhost
- Browser permissions granted?
- Check console for errors
- Test with different browser

### Gemini API fails
- Verify API key in .env.local
- Check API quota/limits
- Verify image format (JPEG)
- Check response format

### Supabase errors
- Verify credentials in .env.local
- Check RLS policies in Supabase
- Verify user authentication
- Check database tables exist

### Tailwind not applying
- Ensure build ran: `npm run build`
- Check file paths in tailwind.config.js
- Verify CSS is imported in main.jsx
- Clear browser cache

## 📦 Dependencies

Key packages already installed:
```
react: 18.2.0          - UI framework
vite: 5.0.8            - Build tool
tailwindcss: 3.3.6     - Styling
@supabase/supabase-js: 2.38.4
@react-router-dom: 6.20.0
lucide-react: 0.308.0  - Icons
recharts: 2.10.3       - Charts
```

## 🌐 Environment Variables

Required in `.env.local`:
```
VITE_SUPABASE_URL=         # Supabase project URL
VITE_SUPABASE_ANON_KEY=    # Supabase anon key
VITE_GEMINI_API_KEY=       # Google Gemini API key
VITE_RAZORPAY_KEY_ID=      # Razorpay public key (add later)
```

Get values from:
- Supabase: Project Settings > API
- Google: https://ai.google.dev/
- Razorpay: Dashboard > Settings > API Keys

## 📚 Resources

- [Vite Docs](https://vitejs.dev)
- [React Docs](https://react.dev)
- [Tailwind Docs](https://tailwindcss.com)
- [Supabase Docs](https://supabase.com/docs)
- [Gemini API Docs](https://ai.google.dev/)
- [React Router](https://reactrouter.com)

---

**CalCheck:** Build fast. Ship faster. 🚀💚
