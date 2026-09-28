import './globals.css'
import Script from 'next/script'
import NavWrapper from '../components/NavWrapper'
import ThemeProvider from '../components/ThemeProvider'
import LanguageProvider from '../components/LanguageProvider'
import PageTransition from '../components/PageTransition'
// import { PageLoaderOverlay } from '../components/PageTransition' // reserved: centered loader, currently disabled
import AuthProvider from '../components/AuthProvider'
import { ToastProvider } from '../components/ToastProvider'
import PhoneGate from '../components/PhoneGate'
import LoadingProvider from '../components/LoadingContext'
import GameSettingsProvider from '../components/GameSettingsProvider'
import ThemeScript from '../components/ThemeScript'
import MaintenanceGate from '../components/MaintenanceGate'
import { AuthGateProvider } from '../components/AuthGateModal'
import MusicPlayerProvider from '../components/MusicPlayerContext' // ← NEW
import ViewportHeightSync from '../components/ViewportHeightSync'

export const metadata = {
  title: 'Nabogaming — Tournament Dashboard',
  description: 'Compete. Rank. Dominate.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Nabogaming',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Forces a consistent, immediate layout-viewport resize when the keyboard
  // opens on every supporting browser, instead of some falling back to a
  // visual-only resize that then corrects itself a frame later — that
  // correction is what reads as "flicker" on fixed bottom bars.
  interactiveWidget: 'resizes-content',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />

        {/* OneSignal */}
        <Script
          src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js"
          strategy="afterInteractive"
        />

        <Script id="onesignal-init" strategy="afterInteractive">
          {`
            window.OneSignalDeferred = window.OneSignalDeferred || [];
            OneSignalDeferred.push(async function(OneSignal) {
              await OneSignal.init({
                appId: "18c70277-bb1b-4c5c-97c2-613b4af0efc7",
              });
            });
          `}
        </Script>

        <link
          href="https://cdn.jsdelivr.net/npm/remixicon@4.2.0/fonts/remixicon.css"
          rel="stylesheet"
        />

        {/* PWA / iOS */}
        <link rel="apple-touch-icon" href="/logo.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#0a0a0a" />
      </head>

      <body>
        <ViewportHeightSync />
        <AuthProvider>
          <ToastProvider>
            <ThemeProvider>
              <LanguageProvider>
              <LoadingProvider>
                <GameSettingsProvider>
                <MusicPlayerProvider>          {/* ← NEW */}
                  <AuthGateProvider>
                    <MaintenanceGate>
                      {/* Fixed UI */}
                      <NavWrapper />
                      <PhoneGate />
                      {/* Centered page loading circle is disabled for now.
                          To bring it back: import PageLoaderOverlay above and render <PageLoaderOverlay /> here. */}

                      <PageTransition>
                        <main>{children}</main>
                      </PageTransition>
                    </MaintenanceGate>
                  </AuthGateProvider>
                </MusicPlayerProvider>          {/* ← NEW */}
                </GameSettingsProvider>
              </LoadingProvider>
              </LanguageProvider>
            </ThemeProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
// cache bust Sun Jun 14 15:21:25 EAT 2026
