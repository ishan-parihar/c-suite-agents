import { NextRequest, NextResponse } from 'next/server';
import { sha256, createAuthToken, authCookieSet } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const passwordHash = process.env.DASHBOARD_PASSWORD_HASH;
  const cookieSecret = process.env.COOKIE_SECRET;
  const sessionHours = parseInt(process.env.SESSION_DURATION_HOURS || '24', 10);

  if (!passwordHash || !cookieSecret) {
    return Response.json(
      { error: 'Server configuration error' },
      { status: 500 },
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.password) {
    return Response.json({ error: 'Password is required' }, { status: 400 });
  }

  const submittedHash = await sha256(body.password);

  if (submittedHash !== passwordHash) {
    return Response.json({ error: 'Invalid password' }, { status: 401 });
  }

  const token = await createAuthToken(cookieSecret);
  const maxAge = sessionHours * 60 * 60;
  const cookieHeader = authCookieSet(token, maxAge);

  const response = NextResponse.json({ success: true });
  response.headers.set('Set-Cookie', cookieHeader);
  return response;
}
