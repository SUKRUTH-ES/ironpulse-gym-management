import { NextResponse } from 'next/server';
import { SESSION_COOKIE, HOME_FOR_ROLE, decryptSession } from '@/lib/session';

// Quick role check before a page renders. The real check happens again in
// each page/action through requireRole() (lib/auth.js).
const AREAS = { '/admin': 'admin', '/trainer': 'trainer', '/member': 'member' };

export async function proxy(request) {
    const { pathname } = request.nextUrl;
    const session = await decryptSession(request.cookies.get(SESSION_COOKIE)?.value);
    const area = Object.keys(AREAS).find((p) => pathname === p || pathname.startsWith(`${p}/`));

    if (area) {
        if (!session) return NextResponse.redirect(new URL('/login', request.url));
        if (session.role !== AREAS[area]) return NextResponse.redirect(new URL(HOME_FOR_ROLE[session.role], request.url));
    }
    if ((pathname === '/login' || pathname === '/register') && session) {
        return NextResponse.redirect(new URL(HOME_FOR_ROLE[session.role], request.url));
    }
    return NextResponse.next();
}

export const config = {
    matcher: ['/admin/:path*', '/trainer/:path*', '/member/:path*', '/login', '/register'],
};
