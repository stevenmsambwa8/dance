import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    // Let the browser handle the code exchange via detectSessionInUrl.
    // We redirect to a client page that picks up the code from the URL
    // and lets the browser supabase client exchange it into localStorage.
    return NextResponse.redirect(`${origin}/auth/confirm?code=${code}`)
  }

  return NextResponse.redirect(`${origin}/`)
}
