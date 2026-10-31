'use server';

import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sqlOne, sql, callProcedure, dbErrorMessage } from '@/lib/db';
import { SESSION_COOKIE, HOME_FOR_ROLE, encryptSession, sessionCookieOptions } from '@/lib/session';

// Compared against when the e-mail does not exist, so a wrong e-mail and a
// wrong password take the same time (does not reveal which accounts exist).
const DUMMY_HASH = bcrypt.hashSync('no-such-user', 10);

async function startSession(user) {
    const token = await encryptSession({ userId: user.user_id, role: user.role });
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function login(prevState, formData) {
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const password = String(formData.get('password') || '');
    if (!email || !password) return { ok: false, message: 'Enter your e-mail and password.' };

    const user = await sqlOne('SELECT user_id, role, password_hash, is_active FROM users WHERE email = ?', [email]);
    const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid) return { ok: false, message: 'Wrong e-mail or password.' };
    if (!user.is_active) return { ok: false, message: 'This account has been deactivated. Please contact the front desk.' };

    await sql('UPDATE users SET last_login_at = NOW() WHERE user_id = ?', [user.user_id]);
    await startSession(user);
    redirect(HOME_FOR_ROLE[user.role]);
}

export async function register(prevState, formData) {
    const f = Object.fromEntries(['full_name', 'email', 'phone', 'date_of_birth', 'gender', 'fitness_goal', 'password', 'confirm']
        .map((k) => [k, String(formData.get(k) || '').trim()]));

    // Friendly checks first; MySQL CHECK constraints and triggers enforce the same rules again.
    if (f.full_name.length < 2) return { ok: false, message: 'Please enter your full name.' };
    if (!/^[6-9]\d{9}$/.test(f.phone)) return { ok: false, message: 'Enter a 10-digit Indian mobile number.' };
    if (f.password.length < 8 || !/\d/.test(f.password) || !/[A-Za-z]/.test(f.password)) {
        return { ok: false, message: 'Password needs at least 8 characters with letters and numbers.' };
    }
    if (f.password !== f.confirm) return { ok: false, message: 'The two passwords do not match.' };

    let memberId;
    try {
        const hash = await bcrypt.hash(f.password, 12);
        const out = await callProcedure('sp_register_member',
            [f.email, hash, f.full_name, f.phone, f.date_of_birth || null, f.gender, f.fitness_goal || null],
            ['member_id', 'member_code']);
        memberId = out.member_id;
    } catch (err) {
        if (err.errno === 1062 && err.sqlMessage.includes('uq_users_email')) return { ok: false, message: 'An account with this e-mail already exists.' };
        if (err.errno === 1062 && err.sqlMessage.includes('uq_users_phone')) return { ok: false, message: 'This phone number is already registered.' };
        if (err.errno === 3819 && err.sqlMessage.includes('chk_users_email')) return { ok: false, message: 'Please enter a valid e-mail address.' };
        return { ok: false, message: dbErrorMessage(err) };
    }

    const user = await sqlOne('SELECT u.user_id, u.role FROM users u JOIN members m ON m.user_id = u.user_id WHERE m.member_id = ?', [memberId]);
    await startSession(user);
    redirect('/member/membership?welcome=1');
}

export async function logout() {
    (await cookies()).delete(SESSION_COOKIE);
    redirect('/login');
}
