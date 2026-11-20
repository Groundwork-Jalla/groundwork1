# Groundwork Mobile App (Capacitor — iOS & Android)

Groundwork ships as **one unified mobile app** (Homeowner, Contractor, and Supplier roles) by wrapping the existing React 19 + Vite + React Router SPA (`build/client`) with Capacitor.

## What Is Already Wired in the Repo
- `capacitor.config.ts` — App ID `com.tryjalla.groundwork`, `webDir: 'build/client'`, `androidScheme: 'https'`, Brand Green `#1f4d36` splash screen, safe-area configuration.
- `src/lib/mobile/runtime.ts` — Native detection (`isNativeApp`), `apiUrl()`, HTTPS `authCallbackOrigin()`, strict `parseNativeDeepLink()`, and automatic `/api/*` fetch bridge (100% inert on web).
- `src/components/mobile/NativeAppBridge.tsx` — Mounted in `src/app/root.tsx`; handles Universal Links (`appUrlOpen`), Android hardware back button, StatusBar light/dark sync, and SplashScreen hide.
- `api/_lib/cors.ts` — Explicit Capacitor origin CORS (`capacitor://localhost`, `https://localhost`) + `OPTIONS` preflight on all browser-called API routes.
- `src/lib/mobile/compress-image.ts` — Client-side image compression for 3G/4G site uploads.
- Safe-area CSS (`viewport-fit=cover`, `.safe-top`, `.safe-bottom`) across `AppShell`, `PortalShell`, and `LiveChatWidget`, plus `public/manifest.webmanifest`.

## Step 1: Install Capacitor Packages (One-Time Setup)
```bash
pnpm add @capacitor/core @capacitor/app @capacitor/status-bar @capacitor/splash-screen @capacitor/keyboard @capacitor/camera @capacitor/push-notifications
pnpm add -D @capacitor/cli @capacitor/ios @capacitor/android
```

## Step 2: Generate Native iOS & Android Projects
```bash
pnpm mobile:build
npx cap add ios
npx cap add android
```
*(Add `ios/` and `android/` to git once generated, or keep them generated via CI depending on team workflow.)*

## Step 3: Build & Run Locally
```bash
# Build web bundle with production API origin & sync into iOS + Android:
pnpm mobile:sync

# Open in Xcode (macOS required for iOS builds & TestFlight):
pnpm mobile:ios

# Open in Android Studio (Linux / macOS / Windows):
pnpm mobile:android
```

## Step 4: Deep Links & Auth Checklist Before Store Submission
1. **iOS Universal Links**: Host `public/.well-known/apple-app-site-association` with your Apple Team ID + `com.tryjalla.groundwork`.
2. **Android App Links**: Host `public/.well-known/assetlinks.json` with your Play App Signing SHA-256 fingerprint.
3. **Supabase Auth Redirect URLs**: Confirm `https://tryjalla.com/auth/callback` and `com.tryjalla.groundwork://auth/callback` are listed in Supabase Dashboard → Authentication → URL Configuration.
4. **Apple App Store Review Note**: Physical construction milestones & material orders are exempt from Apple IAP under Guideline 3.1.3(e). Digital SaaS subscription links (*Jalla Verify*) should follow Apple's subscription guidelines before iOS submission.
