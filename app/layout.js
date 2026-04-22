import './globals.css'
import NavWrapper from '../components/NavWrapper'
import ThemeProvider from '../components/ThemeProvider'
import PageTransition from '../components/PageTransition'
import AuthProvider from '../components/AuthProvider'
import PhoneGate from '../components/PhoneGate'
import LoadingProvider from '../components/LoadingContext'
import ThemeScript from '../components/ThemeScript'
import PWAInstallPrompt from '../components/PWAInstallPrompt'

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
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <link href="https://cdn.jsdelivr.net/npm/remixicon@4.2.0/fonts/remixicon.css" rel="stylesheet" />
        {/* PWA / iOS */}
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#0a0a0a" />
      </head>
      <body>
        <AuthProvider>
          <ThemeProvider>
            <LoadingProvider>
              <NavWrapper />
              <PhoneGate />
              <PWAInstallPrompt />
              <PageTransition>
                <main>{children}</main>
              </PageTransition>
            </LoadingProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
