'use server';

import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { sql, sqlOne, callProcedure, transaction, dbErrorMessage } from '@/lib/db';
import { notify } from '@/lib/notifications';
import { inr, date, dateTime, plural, isoDay, daysAgo } from '@/lib/format';

const fail = (err) => ({ ok: false, message: dbErrorMessage(err) });
const int = (v) => Number.parseInt(String(v ?? ''), 10);

// ---------------------------------------------------------------- front desk
export async function checkIn(prevState, formData) {
    await requireRole('admin');
    const code = String(formData.get('member_code') || '').trim().toUpperCase();
    try {
        const out = await callProcedure('sp_check_in', [code], ['attendance_id', 'full_name']);
        revalidatePath('/admin/check-in');
        return { ok: true, message: `${out.full_name} checked in.` };
    } catch (err) {
        return fail(err);
    }
}

export async function checkOut(prevState, formData) {
    await requireRole('admin');
    const code = String(formData.get('member_code') || '').trim().toUpperCase();
    try {
        const out = await callProcedure('sp_check_out', [code], ['minutes']);
        revalidatePath('/admin/check-in');
        return { ok: true, message: `Checked out after ${out.minutes} minutes.` };
    } catch (err) {
        return fail(err);
    }
}

// ---------------------------------------------------------------- memberships & payments
export async function sellMembership(prevState, formData) {
    const admin = await requireRole('admin');
    const memberId = int(formData.get('member_id'));
    const planId = int(formData.get('plan_id'));
    const method = String(formData.get('method') || '');
    try {
        const out = await callProcedure('sp_purchase_membership', [memberId, planId, method, admin.user_id], ['membership_id', 'payment_id']);
        const ms = await sqlOne(
            `SELECT ms.start_date, ms.end_date, p.name, p.price, u.user_id FROM memberships ms
             JOIN membership_plans p ON p.plan_id = ms.plan_id
             JOIN members m ON m.member_id = ms.member_id JOIN users u ON u.user_id = m.user_id
             WHERE ms.membership_id = ?`, [out.membership_id]);
        await notify(ms.user_id, 'general', `${ms.name} plan activated`, `Valid from ${date(ms.start_date)} to ${date(ms.end_date)}.`);
        revalidatePath(`/admin/members/${memberId}`);
        return { ok: true, message: `${ms.name} sold for ${inr(ms.price)} — valid ${date(ms.start_date)} to ${date(ms.end_date)}.` };
    } catch (err) {
        return fail(err);
    }
}

// A refund never deletes the payment row (a trigger forbids that). It marks
// it refunded and, for a membership, cancels that membership - both changes
// in one transaction so they cannot get out of sync.
export async function refundPayment(prevState, formData) {
    await requireRole('admin');
    const paymentId = int(formData.get('payment_id'));
    try {
        const result = await transaction(async (conn) => {
            const [[p]] = await conn.execute(
                "SELECT payment_id, membership_id, amount FROM payments WHERE payment_id = ? AND status = 'completed' FOR UPDATE",
                [paymentId]);
            if (!p) throw Object.assign(new Error(), { sqlState: '45000', sqlMessage: 'Payment not found or already refunded' });
            await conn.execute("UPDATE payments SET status = 'refunded' WHERE payment_id = ?", [paymentId]);
            if (p.membership_id) {
                await conn.execute(
                    "UPDATE memberships SET status = 'cancelled', frozen_from = NULL WHERE membership_id = ? AND status <> 'cancelled'",
                    [p.membership_id]);
            }
            return p;
        });
        // Tell the member (after the commit; notifications live in MongoDB)
        const who = await sqlOne(
            `SELECT m.user_id, p.name AS plan_name FROM payments pay
             JOIN members m ON m.member_id = pay.member_id
             LEFT JOIN memberships ms ON ms.membership_id = pay.membership_id
             LEFT JOIN membership_plans p ON p.plan_id = ms.plan_id
             WHERE pay.payment_id = ?`, [paymentId]);
        await notify(who.user_id, 'general', `Refund of ${inr(result.amount)} processed`,
            who.plan_name ? `Your ${who.plan_name} membership has been cancelled.` : 'Your personal training payment was refunded.');
        revalidatePath('/admin/payments');
        revalidatePath('/admin/members', 'layout');
        return { ok: true, message: `Refunded ${inr(result.amount)}${result.membership_id ? ' and cancelled the membership' : ''}. Member notified.` };
    } catch (err) {
        return fail(err);
    }
}

export async function setMemberActive(prevState, formData) {
    await requireRole('admin');
    const userId = int(formData.get('user_id'));
    const active = formData.get('active') === '1';
    await sql("UPDATE users SET is_active = ? WHERE user_id = ? AND role = 'member'", [active, userId]);
    revalidatePath('/admin/members', 'layout');
    return { ok: true, message: active ? 'Account re-activated.' : 'Account deactivated. The member can no longer log in or check in.' };
}

// ---------------------------------------------------------------- classes
export async function createClassSession(prevState, formData) {
    await requireRole('admin');
    const f = Object.fromEntries(formData);
    // The timetable (admin and member) shows the next 7 days, so classes are planned within it
    if (!(f.date >= isoDay() && f.date <= isoDay(daysAgo(-7)))) {
        return { ok: false, message: 'Classes can be scheduled from today up to 7 days ahead.' };
    }
    try {
        await sql(
            'INSERT INTO class_sessions (class_type_id, trainer_id, room_id, starts_at, ends_at, capacity) VALUES (?, ?, ?, ?, NULL, ?)',
            [int(f.class_type_id), int(f.trainer_id), int(f.room_id), `${f.date} ${f.time}:00`, int(f.capacity)]);
        revalidatePath('/admin/classes');
        return { ok: true, message: 'Class added to the timetable.' };
    } catch (err) {
        return fail(err);
    }
}

export async function cancelClassSession(prevState, formData) {
    await requireRole('admin');
    const id = int(formData.get('class_session_id'));
    try {
        // who to tell, read before the trigger cancels their bookings
        const affected = await sql(
            `SELECT u.user_id, s.class_name, s.starts_at FROM class_bookings cb
             JOIN members m ON m.member_id = cb.member_id JOIN users u ON u.user_id = m.user_id
             JOIN v_class_schedule s ON s.class_session_id = cb.class_session_id
             WHERE cb.class_session_id = ? AND cb.status IN ('booked','waitlisted')`, [id]);
        const res = await sql("UPDATE class_sessions SET status = 'cancelled' WHERE class_session_id = ? AND status = 'scheduled'", [id]);
        if (!res.affectedRows) return { ok: false, message: 'Only a scheduled class can be cancelled.' };
        for (const a of affected) {
            await notify(a.user_id, 'class_cancelled', `${a.class_name} on ${dateTime(a.starts_at)} was cancelled`, 'Sorry! Your booking has been released. Please pick another class.');
        }
        revalidatePath('/admin/classes');
        return { ok: true, message: `Class cancelled. ${plural(affected.length, 'member')} notified.` };
    } catch (err) {
        return fail(err);
    }
}

// ---------------------------------------------------------------- plans
export async function createPlan(prevState, formData) {
    await requireRole('admin');
    const f = Object.fromEntries(formData);
    try {
        await sql(
            `INSERT INTO membership_plans (name, description, duration_days, price, classes_per_week, pt_sessions_included, max_freeze_days)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [String(f.name).trim(), String(f.description || '').trim() || null, int(f.duration_days), Number(f.price),
                f.classes_per_week ? int(f.classes_per_week) : null, int(f.pt_sessions_included) || 0, int(f.max_freeze_days) || 0]);
        revalidatePath('/admin/plans');
        return { ok: true, message: 'Plan created.' };
    } catch (err) {
        if (err.errno === 3819) return { ok: false, message: 'Check the numbers: price must be 0 or more, duration 1–730 days, freeze days not more than the duration.' };
        return fail(err);
    }
}

export async function togglePlan(prevState, formData) {
    await requireRole('admin');
    await sql('UPDATE membership_plans SET is_active = NOT is_active WHERE plan_id = ?', [int(formData.get('plan_id'))]);
    revalidatePath('/admin/plans');
    return { ok: true, message: 'Saved.' };
}

// ---------------------------------------------------------------- gym setup (rooms, class types, trainers)
export async function addRoom(prevState, formData) {
    await requireRole('admin');
    const name = String(formData.get('name') || '').trim();
    if (name.length < 2) return { ok: false, message: 'Give the room a name.' };
    try {
        await sql('INSERT INTO rooms (name, capacity) VALUES (?, ?)', [name, int(formData.get('capacity'))]);
        revalidatePath('/admin/setup');
        return { ok: true, message: `${name} added.` };
    } catch (err) {
        if (err.errno === 1062) return { ok: false, message: 'A room with that name already exists.' };
        if (err.errno === 3819) return { ok: false, message: 'Capacity must be between 1 and 200.' };
        return fail(err);
    }
}

export async function addClassType(prevState, formData) {
    await requireRole('admin');
    const f = Object.fromEntries(formData);
    const name = String(f.name || '').trim();
    if (name.length < 2) return { ok: false, message: 'Give the class a name.' };
    try {
        await sql('INSERT INTO class_types (name, description, intensity, duration_min) VALUES (?, ?, ?, ?)',
            [name, String(f.description || '').trim() || null, String(f.intensity), int(f.duration_min)]);
        revalidatePath('/admin/setup');
        return { ok: true, message: `${name} added. It can now be scheduled on the Classes page.` };
    } catch (err) {
        if (err.errno === 1062) return { ok: false, message: 'A class type with that name already exists.' };
        if (err.errno === 3819) return { ok: false, message: 'Duration must be between 15 and 180 minutes.' };
        if (err.errno === 1265) return { ok: false, message: 'Pick an intensity.' };
        return fail(err);
    }
}

// The admin sets a first password; it is hashed here and only the hash reaches MySQL.
export async function addTrainer(prevState, formData) {
    await requireRole('admin');
    const f = Object.fromEntries(['full_name', 'email', 'phone', 'specialization', 'bio', 'experience_years', 'session_rate', 'password']
        .map((k) => [k, String(formData.get(k) || '').trim()]));
    if (f.full_name.length < 2) return { ok: false, message: 'Enter the trainer\'s full name.' };
    if (f.phone && !/^[6-9]\d{9}$/.test(f.phone)) return { ok: false, message: 'Enter a 10-digit Indian mobile number.' };
    if (f.password.length < 8 || !/\d/.test(f.password) || !/[A-Za-z]/.test(f.password)) {
        return { ok: false, message: 'First password needs at least 8 characters with letters and numbers.' };
    }
    try {
        const hash = await bcrypt.hash(f.password, 12);
        await callProcedure('sp_add_trainer',
            [f.email, hash, f.full_name, f.phone || null, f.specialization, f.bio, int(f.experience_years) || 0, Number(f.session_rate)],
            ['trainer_id']);
        revalidatePath('/admin/setup');
        return { ok: true, message: `${f.full_name} can now log in with ${f.email.toLowerCase()}.` };
    } catch (err) {
        if (err.errno === 1062 && err.sqlMessage.includes('uq_users_email')) return { ok: false, message: 'An account with this e-mail already exists.' };
        if (err.errno === 1062 && err.sqlMessage.includes('uq_users_phone')) return { ok: false, message: 'This phone number is already registered.' };
        if (err.errno === 3819 && err.sqlMessage.includes('chk_users_email')) return { ok: false, message: 'Please enter a valid e-mail address.' };
        if (err.errno === 3819) return { ok: false, message: 'Rate must be more than 0 and experience at most 50 years.' };
        return fail(err);
    }
}

export async function toggleTrainerPt(prevState, formData) {
    await requireRole('admin');
    await sql('UPDATE trainers SET accepts_pt = NOT accepts_pt WHERE trainer_id = ?', [int(formData.get('trainer_id'))]);
    revalidatePath('/admin/setup');
    return { ok: true, message: 'Saved.' };
}
