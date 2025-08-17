import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // evita cache

export async function GET() {
  // corpo mínimo para responder rápido
  return NextResponse.json({ ok: true, serverTime: Date.now() });
}
