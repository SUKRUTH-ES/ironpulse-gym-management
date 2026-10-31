import { SignJWT, jwtVerify } from 'jose';

// The login session is a signed token (JWT) in an httpOnly cookie:
// JavaScript in the browser cannot read it, and any change to it breaks
// the signature, so the role inside it cannot be forged.
export const SESSION_COOKIE = 'gym_session';
const SESSION_HOURS = 8;
const key = new TextEncoder().encode(process.env.SESSION_SECRET);

export async function encryptSession(payload) {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${SESSION_HOURS}h`)
        .sign(key);
}

export async function decryptSession(token) {
    if (!token) return null;
    try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
        return payload;
    } catch {
        return null;
    }
}

export function sessionCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_HOURS * 3600,
    };
}

export const HOME_FOR_ROLE = { admin: '/admin', trainer: '/trainer', member: '/member' };
