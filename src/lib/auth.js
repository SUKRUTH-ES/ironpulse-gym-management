import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sqlOne } from './db';
import { SESSION_COOKIE, HOME_FOR_ROLE, decryptSession } from './session';

// Data Access Layer: every page and server action asks this module who the
// user is. The cookie is verified AND the account is re-checked in MySQL,
// so a deactivated user loses access immediately.
export const getUser = cache(async () => {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const session = await decryptSession(token);
    if (!session?.userId) return null;

    const user = await sqlOne(
        `SELECT u.user_id, u.full_name, u.email, u.role, m.member_id, m.member_code, t.trainer_id
         FROM users u
         LEFT JOIN members m  ON m.user_id = u.user_id
         LEFT JOIN trainers t ON t.user_id = u.user_id
         WHERE u.user_id = ? AND u.is_active`,
        [session.userId],
    );
    return user;
});

// Use at the top of a page or action: returns the user, or redirects.
export async function requireRole(...roles) {
    const user = await getUser();
    if (!user) redirect('/login');
    if (!roles.includes(user.role)) redirect(HOME_FOR_ROLE[user.role]);
    return user;
}
