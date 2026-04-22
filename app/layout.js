import './globals.css'
import NavWrapper from '../components/NavWrapper'
import ThemeProvider from '../components/ThemeProvider'
import PageTransition from '../components/PageTransition'
import AuthProvider from '../components/AuthProvider'
import PhoneGate from '../components/PhoneGate'
import LoadingProvider from '../components/LoadingContext'
import ThemeScript from '../components/ThemeScript'

export const metadata = {
  title: 'ARENA — Tournament Dashboard',
  description: 'Compete. Rank. Dominate.',
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
      </head>
      <body>
        <AuthProvider>
          <ThemeProvider>
            <LoadingProvider>
              <NavWrapper />
              <PhoneGate />
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
