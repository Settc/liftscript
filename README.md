# LiftScript

A text-based workout tracker for power users.

## Setup

```bash
npm install
npm run dev        # Start dev server
npm run build      # Build for production
```

## iOS Deployment

```bash
npm run build
npx cap add ios    # First time only
npx cap sync
npx cap open ios   # Opens Xcode
```

## Configuration

1. Copy your Supabase credentials into `src/supabase.js`
2. Update `capacitor.config.ts` with your app ID
3. See `DEPLOYMENT-GUIDE.md` for full App Store instructions

## Project Structure

```
src/
  App.jsx       — Main UI (all components)
  parser.js     — Workout syntax parser (pure logic)
  storage.js    — Local storage via Capacitor Preferences
  supabase.js   — Share/import via Supabase
  native.js     — Native plugins (keep-awake, notifications)
  main.jsx      — Entry point
```
