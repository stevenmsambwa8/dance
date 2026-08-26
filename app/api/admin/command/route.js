// app/api/admin/command/route.js
//
// The doorway. Checks your password, then runs the command.

import { NextResponse } from 'next/server';
import { runCommand, COMMANDS } from '@/lib/adminCommands';

export async function GET() {
  return NextResponse.json({ available_commands: Object.keys(COMMANDS) });
}

export async function POST(req) {
  const secret = req.headers.get('x-admin-secret');
  if (!secret || secret !== process.env.ADMIN_COMMAND_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { command, params } = body || {};
  if (!command) {
    return NextResponse.json({ error: 'missing "command" field' }, { status: 400 });
  }

  try {
    const result = await runCommand(command, params);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
