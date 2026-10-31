'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { sql, sqlOne, callProcedure, dbErrorMessage } from '@/lib/db';
import { mongo, toObjectId } from '@/lib/mongo';
import { notify } from '@/lib/notifications';
import { inr, dateTime } from '@/lib/format';
import { isTimed } from '@/lib/workout';

const fail = (err) => ({ ok: false, message: dbErrorMessage(err) });
const int = (v) => Number.parseInt(String(v ?? ''), 10);

// The member id always comes from the session, never from the form, so a
// member can only act on their own bookings and membership.

// ---------------------------------------------------------------- classes
export async function bookClass(prevState, formData) {
    const me = await requireRole('member');
    try {
        const out = await callProcedure('sp_book_class', [me.member_id, int(formData.get('class_session_id'))], ['booking_id', 'status']);
        revalidatePath('/member', 'layout');
        return out.status === 'booked'
            ? { ok: true, message: 'Booked! See you there.' }
            : { ok: true, message: 'The class is full, so you are on the waitlist. You get the seat automatically if someone cancels.' };
    } catch (err) {
        return fail(err);
    }
}

export async function cancelBooking(prevState, formData) {
    const me = await requireRole('member');
    try {
        const out = await callProcedure('sp_cancel_class_booking', [int(formData.get('booking_id')), me.member_id], ['promoted_member_id']);
        if (out.promoted_member_id) {
            const p = await sqlOne(
                `SELECT m.user_id, s.class_name, s.starts_at FROM members m
                 JOIN class_bookings cb ON cb.member_id = m.member_id
                 JOIN v_class_schedule s ON s.class_session_id = cb.class_session_id
                 WHERE cb.booking_id = ?`, [int(formData.get('booking_id'))]);
            await notify(p.user_id, 'waitlist_promoted', `You got a spot in ${p.class_name}`,
                `A seat opened up for ${dateTime(p.starts_at)}. You're booked in.`);
        }
        revalidatePath('/member', 'layout');
        return { ok: true, message: 'Booking cancelled.' };
    } catch (err) {
        return fail(err);
    }
}

// ---------------------------------------------------------------- membership
export async function buyMembership(prevState, formData) {
    const me = await requireRole('member');
    try {
        const out = await callProcedure('sp_purchase_membership',
            [me.member_id, int(formData.get('plan_id')), String(formData.get('method') || 'upi'), null],
            ['membership_id', 'payment_id']);
        const ms = await sqlOne(
            `SELECT p.name, p.price, ms.start_date, ms.end_date FROM memberships ms
             JOIN membership_plans p ON p.plan_id = ms.plan_id WHERE ms.membership_id = ?`, [out.membership_id]);
        revalidatePath('/member', 'layout');
        return { ok: true, message: `Paid ${inr(ms.price)}. ${ms.name} is valid from ${ms.start_date} to ${ms.end_date}.` };
    } catch (err) {
        return fail(err);
    }
}

export async function freezeMembership(prevState, formData) {
    const me = await requireRole('member');
    try {
        await callProcedure('sp_freeze_membership', [int(formData.get('membership_id')), me.member_id]);
        revalidatePath('/member', 'layout');
        return { ok: true, message: 'Membership frozen. The days you are away will be added back when you unfreeze.' };
    } catch (err) {
        return fail(err);
    }
}

export async function unfreezeMembership(prevState, formData) {
    const me = await requireRole('member');
    try {
        const out = await callProcedure('sp_unfreeze_membership', [int(formData.get('membership_id')), me.member_id], ['days_added']);
        revalidatePath('/member', 'layout');
        return { ok: true, message: `Welcome back! ${out.days_added} day(s) added to your plan.` };
    } catch (err) {
        return fail(err);
    }
}

// ---------------------------------------------------------------- personal training
export async function bookPt(prevState, formData) {
    const me = await requireRole('member');
    const f = Object.fromEntries(formData);
    try {
        const out = await callProcedure('sp_book_pt_session',
            [me.member_id, int(f.trainer_id), `${f.date} ${f.time}:00`, int(f.duration), String(f.note || '').slice(0, 255) || null],
            ['pt_session_id', 'price']);
        const trainer = await sqlOne('SELECT u.user_id, u.full_name FROM trainers t JOIN users u ON u.user_id = t.user_id WHERE t.trainer_id = ?', [int(f.trainer_id)]);
        await notify(trainer.user_id, 'pt_update', 'New personal training request', `${me.full_name} requested ${f.date} at ${f.time}.`);
        revalidatePath('/member/training');
        return { ok: true, message: `Request sent to ${trainer.full_name}. ${out.price > 0 ? `Price: ${inr(out.price)}, paid after the session.` : 'Included in your plan.'}` };
    } catch (err) {
        return fail(err);
    }
}

export async function cancelPt(prevState, formData) {
    const me = await requireRole('member');
    const res = await sql(
        `UPDATE pt_sessions SET status = 'cancelled'
         WHERE pt_session_id = ? AND member_id = ? AND status IN ('requested','confirmed') AND starts_at > NOW() + INTERVAL 2 HOUR`,
        [int(formData.get('pt_session_id')), me.member_id]);
    revalidatePath('/member/training');
    return res.affectedRows
        ? { ok: true, message: 'Session cancelled.' }
        : { ok: false, message: 'Sessions can only be cancelled up to 2 hours before they start.' };
}

// ---------------------------------------------------------------- workouts (MongoDB)
export async function logWorkout(prevState, formData) {
    const me = await requireRole('member');
    const plan = await mongo().collection('workout_plans').findOne({ _id: toObjectId(formData.get('plan_id')), memberId: me.member_id });
    if (!plan) return { ok: false, message: 'Plan not found.' };
    const day = plan.days.find((d) => d.day === int(formData.get('day')));
    if (!day) return { ok: false, message: 'Pick a workout day.' };

    // One sub-document per exercise, one entry per set that was filled in
    const exercises = [];
    for (const [i, ex] of day.exercises.entries()) {
        const timed = isTimed(ex.reps);
        const sets = [];
        for (let s = 0; s < ex.sets; s++) {
            const value = int(formData.get(`reps_${i}_${s}`));
            const weight = Number(formData.get(`kg_${i}_${s}`));
            if (Number.isNaN(value) || value <= 0) continue;
            if (timed) sets.push({ durationSec: value });
            else sets.push(weight > 0 ? { reps: value, weightKg: weight } : { reps: value });
        }
        if (sets.length) exercises.push({ exerciseId: ex.exerciseId, name: ex.name, sets });
    }
    if (!exercises.length) return { ok: false, message: 'Fill in reps for at least one set.' };

    const doc = {
        memberId: me.member_id, planId: plan._id, performedAt: new Date(),
        durationMin: Math.min(300, Math.max(5, int(formData.get('duration')) || 45)),
        rpe: Math.min(10, Math.max(1, int(formData.get('rpe')) || 7)),
        exercises,
    };
    const notes = String(formData.get('notes') || '').trim();
    if (notes) doc.notes = notes.slice(0, 500);
    try {
        await mongo().collection('workout_logs').insertOne(doc);
    } catch {
        return { ok: false, message: 'Some values are out of range (reps 0–200, weight 0–600 kg).' };
    }
    revalidatePath('/member/workouts');
    return { ok: true, message: `Logged ${day.title}: ${exercises.length} exercises, ${exercises.reduce((n, e) => n + e.sets.length, 0)} sets.` };
}

export async function logBodyWeight(prevState, formData) {
    const me = await requireRole('member');
    const weight = Number(formData.get('weight'));
    if (!(weight >= 25 && weight <= 300)) return { ok: false, message: 'Enter a weight between 25 and 300 kg.' };
    const reading = { memberId: me.member_id, recordedAt: new Date(), weightKg: weight };
    const fat = Number(formData.get('body_fat'));
    if (fat > 2 && fat < 70) reading.bodyFatPct = fat;
    await mongo().collection('body_metrics').insertOne(reading);
    revalidatePath('/member/workouts');
    return { ok: true, message: 'Saved.' };
}

export async function markNotificationsRead() {
    const me = await requireRole('member');
    await mongo().collection('notifications').updateMany({ userId: me.user_id, readAt: null }, { $set: { readAt: new Date() } });
    revalidatePath('/member');
}
