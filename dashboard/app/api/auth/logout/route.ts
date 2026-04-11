import { NextResponse } from 'next/server';
import { authCookieClear } from '@/lib/auth';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.headers.set('Set-Cookie', authCookieClear());
  return response;
}
