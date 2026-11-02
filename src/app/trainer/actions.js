'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { sql, sqlOne, transaction, dbErrorMessage } from '@/lib/db';
import { mongo } from '@/lib/mongo';
import { notify } from '@/lib/notifications';
import { dateTime, inr, payMethod } from '@/lib/format';

const int = (v) => Number.parseInt(String(v ?? ''), 10);
const METHODS = ['upi', 'card', 'cash', 'netbanking'];

// Moves one of MY personal training sessions to a new status.
// Completing a paid session also records its payment (method chosen by the trainer,
// recorded_by = the trainer's user id), in the same transaction.
export async function updatePtStatus(prevState, formData) {
    const me = await requireRole('trainer');
    const id = int(formData.get('pt_session_id'));
    const next = String(formData.get('status'));
    const method = String(formData.get('method') || '');
    const allowed = { confirmed: ['requested'], cancelled: ['requested', 'confirmed'], completed: ['confirmed'] };
    if (!allowed[next]) return { ok: false, message: 'Unknown action.' };

    try {
        const s = await transaction(async (conn) => {
            const [[row]] = await conn.execute(
                `SELECT ps.pt_session_id, ps.member_id, ps.status, ps.price, ps.starts_at, m.user_id
                 FROM pt_sessions ps JOIN members m ON m.member_id = ps.member_id
                 WHERE ps.pt_session_id = ? AND ps.trainer_id = ? FOR UPDATE`, [id, me.trainer_id]);
            if (!row || !allowed[next].includes(row.status)) {
                throw Object.assign(new Error(), { sqlState: '45000', sqlMessage: `A ${row?.status ?? 'missing'} session cannot be ${next}.` });
            }
            if (next === 'completed' && new Date(row.starts_at.replace(' ', 'T')) > new Date()) {
                throw Object.assign(new Error(), { sqlState: '45000', sqlMessage: 'The session has not happened yet.' });
            }
            const charged = next === 'completed' && row.price > 0;
            if (charged && !METHODS.includes(method)) {
                throw Object.assign(new Error(), { sqlState: '45000', sqlMessage: 'Pick how the member paid.' });
            }
            await conn.execute('UPDATE pt_sessions SET status = ? WHERE pt_session_id = ?', [next, id]);
            if (charged) {
                await conn.execute(
                    `INSERT INTO payments (member_id, pt_session_id, amount, method, transaction_ref, recorded_by)
                     VALUES (?, ?, ?, ?, CONCAT('PT-', ?, '-', UNIX_TIMESTAMP()), ?)`, [row.member_id, id, row.price, method, id, me.user_id]);
            }
            return row;
        });
        const verb = { confirmed: 'confirmed', cancelled: 'cancelled', completed: 'marked as done' }[next];
        const paid = next === 'completed' && s.price > 0 ? ` · ${inr(s.price)} paid by ${payMethod(method)}` : '';
        await notify(s.user_id, 'pt_update', `Personal training ${verb}`,
            `${me.full_name} ${verb} your session on ${dateTime(s.starts_at)}${paid}.`);
        revalidatePath('/trainer');
        return { ok: true, message: `Session ${verb}${paid}.` };
    } catch (err) {
        return { ok: false, message: dbErrorMessage(err) };
    }
}

// Takes attendance for one of MY classes once it has started. It can still be
// corrected for 2 days afterwards (the housekeeping event marks absentees as no_show).
export async function markAttendance(prevState, formData) {
    const me = await requireRole('trainer');
    const bookingId = int(formData.get('booking_id'));
    const status = formData.get('status') === 'attended' ? 'attended' : 'no_show';
    const res = await sql(
        `UPDATE class_bookings cb JOIN class_sessions cs ON cs.class_session_id = cb.class_session_id
         SET cb.status = ?
         WHERE cb.booking_id = ? AND cs.trainer_id = ?
           AND cs.starts_at <= NOW() AND cs.starts_at >= CURRENT_DATE - INTERVAL 2 DAY
           AND cb.status IN ('booked','attended','no_show')`, [status, bookingId, me.trainer_id]);
    revalidatePath('/trainer');
    return res.affectedRows
        ? { ok: true, message: 'Saved.' }
        : { ok: false, message: 'Attendance can be taken from the start of the class until 2 days later.' };
}

// Creates a workout plan document in MongoDB for a member.
export async function createWorkoutPlan(prevState, formData) {
    const me = await requireRole('trainer');
    const memberId = int(formData.get('member_id'));
    const title = String(formData.get('title') || '').trim();
    const goal = String(formData.get('goal'));

    // Cross-database integrity: the member must exist in MySQL first
    const member = await sqlOne('SELECT m.member_id, m.user_id FROM members m JOIN users u ON u.user_id = m.user_id WHERE m.member_id = ? AND u.is_active', [memberId]);
    if (!member) return { ok: false, message: 'Member not found.' };

    const ids = formData.getAll('exercise');
    const days = [];
    for (let d = 1; d <= 3; d++) {
        const picked = ids.filter((v) => v.startsWith(`${d}:`)).map((v) => v.slice(2));
        if (!picked.length) continue;
        const docs = await mongo().collection('exercises').find({ slug: { $in: picked } }).toArray();
        days.push({
            day: d * 2 - 1,
            title: String(formData.get(`day${d}_title`) || `Day ${d}`).trim() || `Day ${d}`,
            exercises: docs.map((e) => ({
                exerciseId: e._id, name: e.name,
                sets: e.category === 'cardio' ? 1 : 3,
                reps: e.category === 'cardio' ? '20 min' : e.category === 'mobility' ? '45s' : '10-12',
                restSec: e.category === 'strength' ? 90 : 45,
            })),
        });
    }
    if (title.length < 3) return { ok: false, message: 'Give the plan a title.' };
    if (!days.length) return { ok: false, message: 'Pick at least one exercise.' };

    const now = new Date();
    try {
        const db = mongo();
        // Only one active plan per member: archive the old one
        await db.collection('workout_plans').updateMany({ memberId, status: 'active' }, { $set: { status: 'archived', updatedAt: now } });
        await db.collection('workout_plans').insertOne({
            memberId, trainerId: me.trainer_id, title, goal, durationWeeks: 8, status: 'active', days, createdAt: now, updatedAt: now,
        });
    } catch {
        return { ok: false, message: 'The plan did not pass validation.' };
    }
    await notify(member.user_id, 'plan_assigned', `New workout plan: ${title}`, `${me.full_name} created a plan for you.`);
    revalidatePath('/trainer/members');
    return { ok: true, message: 'Plan saved and the member was notified.' };
}
