// app/api/worldcup/route.js
// Proxy for worldcup26.ir API
// Requires WORLDCUP_API_TOKEN env var (get from POST /auth/authenticate)

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const endpoint = searchParams.get('endpoint')

    if (!endpoint) {
      return Response.json({ error: 'endpoint required' }, { status: 400 })
    }

    const url = `https://worldcup26.ir/${endpoint}`
    const token = process.env.WORLDCUP_API_TOKEN

    const headers = { 'Accept': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const response = await fetch(url, {
      headers,
      next: { revalidate: 120 },
    })

    const text = await response.text()

    return new Response(text, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
