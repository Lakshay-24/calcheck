# Phase 2 Quick Test Guide

## 📦 Organize Files First (5 minutes)

### Windows Command Prompt:
```bash
mkdir src\screens src\components

move src_screens_OnboardingScreen.jsx src\screens\OnboardingScreen.jsx
move src_screens_ScanScreen.jsx src\screens\ScanScreen.jsx
move src_components_CameraModal.jsx src\components\CameraModal.jsx
move src_components_AnalysisScreen.jsx src\components\AnalysisScreen.jsx
move src_components_ResultsScreen.jsx src\components\ResultsScreen.jsx
move src_components_BottomNav.jsx src\components\BottomNav.jsx
move src_App_updated.jsx src\App.jsx
```

## 🚀 Run Locally (1 minute)

```bash
npm install
npm run dev
```

App will start at: **http://localhost:5173**

---

## ✅ Test Checklist

### Onboarding (First Visit)
- [ ] App loads and shows OnboardingScreen
- [ ] See "Snap Food" headline
- [ ] See 3 feature bullets
- [ ] "Get Started" button is green and prominent
- [ ] Click button → Camera permission dialog appears
- [ ] Accept permission → Redirects to ScanScreen

### ScanScreen (Main Hub)
- [ ] Sticky header with "Scan Food" title
- [ ] Two buttons visible: "Open Camera" (green) + "Upload Image" (gray)
- [ ] Today's Progress card shows:
  - [ ] "Today's Progress" heading with date
  - [ ] Calorie progress bar (green)
  - [ ] Protein progress bar (blue)
  - [ ] Remaining calorie count
  - [ ] Remaining protein count
  - [ ] Quick stats: Carbs + Fat
- [ ] Empty state shows: "No meals today yet"
- [ ] Tap any button → CameraModal opens

### CameraModal
- [ ] Full-screen overlay appears
- [ ] Live camera preview visible
- [ ] Grid overlay on camera (for framing)
- [ ] Large green circle button at bottom (shutter)
- [ ] Close button (X) at top right
- [ ] Can tap shutter → Captures photo

### After Capture
- [ ] AnalysisScreen appears
- [ ] Animated loading circle (spinning)
- [ ] "Analyzing your meal..." text
- [ ] 3 progress indicators
- [ ] After 2-3 seconds → ResultsScreen appears

### ResultsScreen
- [ ] Food image shown at top
- [ ] **LARGE** calorie number (orange card)
- [ ] **LARGE** protein number (blue card)
- [ ] Meal score (0-100) with heart icon
- [ ] Macros: Carbs (🌾) + Fat (🫒) with values
- [ ] Protein level badge (High/Medium/Low)
- [ ] Recommendation badge (Fat Loss/Muscle Gain/Maintenance)
- [ ] Green "Save Meal" button
- [ ] Gray "Scan Another" button
- [ ] Privacy note at bottom

### Navigation (Bottom Tabs)
- [ ] 3 tabs visible at bottom
- [ ] Scan tab (camera icon) - active by default (green)
- [ ] Progress tab (chart icon)
- [ ] Profile tab (user icon)
- [ ] Tab labels show
- [ ] Click Progress → Shows "Coming Soon"
- [ ] Click Profile → Shows "Coming Soon"
- [ ] Click Scan → Back to ScanScreen

### Responsive Design
- [ ] Works on mobile (375px)
- [ ] Works on tablet (768px)
- [ ] Works on desktop (1024px+)
- [ ] No horizontal scrolling
- [ ] Buttons are big enough to tap

---

## 🎨 Design Check

### Colors
- [ ] Green accents (#22C55E) visible
- [ ] White backgrounds throughout
- [ ] Gray text is readable
- [ ] Gradient backgrounds subtle

### Typography
- [ ] Headlines are large and bold
- [ ] Body text is readable (16px+)
- [ ] Labels are small and clear
- [ ] Numbers are prominent

### Spacing
- [ ] No crowded layouts
- [ ] Lots of white space
- [ ] Cards are well-separated
- [ ] Buttons have good padding

### Animations
- [ ] Loading circle spins smoothly
- [ ] Progress bars animate
- [ ] Button hovers show change
- [ ] No janky transitions

---

## 🐛 Common Issues & Fixes

### Issue: App doesn't start
**Fix:** 
```bash
npm install  # Install missing dependencies
npm run dev  # Try again
```

### Issue: Camera permission dialog doesn't appear
**Fix:**
- App might need HTTPS or localhost
- Try in a fresh browser tab
- Check browser camera settings

### Issue: Modal doesn't close
**Fix:**
- Click X button in top-right corner
- Try Escape key
- Refresh browser

### Issue: Bottom nav tabs don't work
**Fix:**
- Make sure BottomNav.jsx is in src/components/
- Check React Router is imported in App.jsx
- Clear browser cache (Ctrl+Shift+Delete)

### Issue: Styling looks wrong
**Fix:**
- Make sure Tailwind is configured
- Run: `npm run dev` again
- Clear browser cache
- Check all CSS classes use Tailwind syntax

---

## 📱 Browser DevTools

### Open DevTools (F12 or Ctrl+Shift+I)

### Check Console
- [ ] No red errors
- [ ] No yellow warnings
- [ ] Console should be mostly clean

### Check Mobile View
- [ ] Click responsive design mode (Ctrl+Shift+M)
- [ ] Test iPhone 12/13 size (390x844)
- [ ] Test iPad size (768x1024)
- [ ] Test desktop (1920x1080)

---

## ✨ Expected Behavior

### Perfect Flow:
```
Load App
    ↓
See OnboardingScreen (first time only)
    ↓
Click "Get Started"
    ↓
Allow camera permission
    ↓
See ScanScreen
    ├─ Calorie progress: 0/2500
    ├─ Protein progress: 0/150g
    └─ "No meals today yet" message
    ↓
Click "Open Camera"
    ↓
CameraModal appears (full-screen)
    ├─ See live camera preview
    ├─ See grid overlay
    └─ See green shutter button
    ↓
Click shutter button
    ↓
AnalysisScreen (loading animation)
    └─ "Analyzing your meal..."
    ↓
ResultsScreen (after 2-3 seconds)
    ├─ Food image
    ├─ Large calorie number
    ├─ Large protein number
    ├─ Meal score (0-100)
    ├─ Macros breakdown
    ├─ Badges (protein level + recommendation)
    └─ Buttons (Save & Scan Again)
    ↓
Click "Scan Another"
    ↓
Back to CameraModal
    ↓
Repeat flow or click X to close
    ↓
Back to ScanScreen
```

---

## 🎯 Success Criteria

You know Phase 2 is working when:

✅ App starts without errors  
✅ OnboardingScreen shows on first visit  
✅ Can click through to ScanScreen  
✅ ScanScreen displays properly with all elements  
✅ Can open camera modal  
✅ Can take a photo with shutter button  
✅ Analysis screen shows loading animation  
✅ Results screen displays (with dummy data)  
✅ All buttons are clickable  
✅ Bottom navigation works  
✅ Mobile responsive and looks good  
✅ No console errors  

---

## 📋 Troubleshooting Checklist

Before asking for help, verify:

- [ ] All files are organized in correct folders
- [ ] `npm install` was run
- [ ] `npm run dev` is running
- [ ] No console errors (F12 → Console tab)
- [ ] Using http://localhost:5173 (not 3000 or other port)
- [ ] Browser is up to date
- [ ] Tried hard refresh (Ctrl+Shift+R)
- [ ] Tried in incognito/private mode
- [ ] .env.local has correct API keys (if testing integration)

---

## 🎉 You're Good to Go!

Phase 2 UI is complete and ready to test. Enjoy! 💚

Next: Phase 3 will connect the Gemini API for real food analysis.
