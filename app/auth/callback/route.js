import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    return NextResponse.redirect(`${origin}/auth/confirm?code=${code}`)
  }

  return NextResponse.redirect(`${origin}/`)
}
