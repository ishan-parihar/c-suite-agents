import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken, COOKIE_NAME } from '@/lib/auth';

const PUBLIC_PATHS = new Set([
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/favicon.ico',
  '/api/ws',
  '/api/health',
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // Skip static assets and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const cookieSecret = process.env.COOKIE_SECRET;
  if (!cookieSecret) {
    console.error('COOKIE_SECRET not set — auth disabled (INSECURE)');
    return NextResponse.next();
  }

  const sessionHours = parseInt(process.env.SESSION_DURATION_HOURS || '24', 10);
  const maxAgeMs = sessionHours * 60 * 60 * 1000;

  // API routes: allow agent access via x-agent-id header, or require dashboard cookie
  if (pathname.startsWith('/api/')) {
    const hasAgentId = request.headers.get('x-agent-id');
    if (hasAgentId) {
      return NextResponse.next();
    }
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (token) {
      const ts = await verifyAuthToken(token, cookieSecret, maxAgeMs);
      if (ts !== null) {
        return NextResponse.next();
      }
    }
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 },
    );
  }

  // Page routes: require dashboard cookie
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (token) {
    const ts = await verifyAuthToken(token, cookieSecret, maxAgeMs);
    if (ts !== null) {
      return NextResponse.next();
    }
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
