'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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

// ---------------------------------------------------------------- self-made plans & exercises (MongoDB)
const GOALS = ['weight_loss', 'muscle_gain', 'endurance', 'flexibility', 'general_fitness'];
const CATEGORIES = ['strength', 'cardio', 'mobility', 'plyometric'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];

// Exercises a member may use: the shared library plus the ones they added
const visibleTo = (memberId) => ({ createdBy: { $in: [null, memberId] } });

// Builds a plan without a trainer. The builder sends the whole plan as JSON.
export async function createOwnPlan(prevState, formData) {
    const me = await requireRole('member');
    let input;
    try {
        input = JSON.parse(String(formData.get('plan') || '{}'));
    } catch {
        return { ok: false, message: 'Could not read the plan.' };
    }
    const title = String(input.title || '').trim();
    if (title.length < 3 || title.length > 100) return { ok: false, message: 'Give the plan a title (3–100 characters).' };
    if (!GOALS.includes(input.goal)) return { ok: false, message: 'Pick a goal.' };
    const days = Array.isArray(input.days) ? input.days.filter((d) => d.items?.length) : [];
    if (!days.length || days.length > 7) return { ok: false, message: 'Add exercises to 1–7 days.' };

    const slugs = [...new Set(days.flatMap((d) => d.items.map((i) => String(i.slug))))];
    const found = await mongo().collection('exercises').find({ slug: { $in: slugs }, ...visibleTo(me.member_id) }).toArray();
    const bySlug = new Map(found.map((e) => [e.slug, e]));

    const planDays = [];
    for (const [index, d] of days.entries()) {
        const exercises = [];
        for (const item of d.items) {
            const ex = bySlug.get(String(item.slug));
            const sets = int(item.sets);
            const reps = String(item.reps || '').trim().slice(0, 20);
            if (!ex) return { ok: false, message: 'One of the exercises no longer exists.' };
            if (!(sets >= 1 && sets <= 10)) return { ok: false, message: `${ex.name}: sets must be 1–10.` };
            if (!reps) return { ok: false, message: `${ex.name}: enter reps, e.g. 10-12 or 30s.` };
            exercises.push({ exerciseId: ex._id, name: ex.name, sets, reps, restSec: ex.category === 'strength' ? 90 : 45 });
        }
        planDays.push({ day: index + 1, title: String(d.title || '').trim().slice(0, 50) || `Day ${index + 1}`, exercises });
    }

    const now = new Date();
    const db = mongo();
    try {
        await db.collection('workout_plans').updateMany({ memberId: me.member_id, status: 'active' }, { $set: { status: 'archived', updatedAt: now } });
        await db.collection('workout_plans').insertOne({
            memberId: me.member_id, trainerId: null, title, goal: input.goal, durationWeeks: 8,
            status: 'active', days: planDays, createdAt: now, updatedAt: now,
        });
    } catch {
        return { ok: false, message: 'The plan did not pass validation.' };
    }
    revalidatePath('/member/workouts');
    redirect('/member/workouts');
}

// Make one of my plans the active one (only one plan is active at a time)
export async function activatePlan(prevState, formData) {
    const me = await requireRole('member');
    const id = toObjectId(formData.get('plan_id'));
    const db = mongo().collection('workout_plans');
    const plan = id && (await db.findOne({ _id: id, memberId: me.member_id }));
    if (!plan) return { ok: false, message: 'Plan not found.' };
    const now = new Date();
    await db.updateMany({ memberId: me.member_id, status: 'active' }, { $set: { status: 'archived', updatedAt: now } });
    await db.updateOne({ _id: id }, { $set: { status: 'active', updatedAt: now } });
    revalidatePath('/member/workouts');
    return { ok: true, message: `${plan.title} is now your active plan.` };
}

// Members may delete only plans they made themselves; trainer plans stay
export async function deleteOwnPlan(prevState, formData) {
    const me = await requireRole('member');
    const id = toObjectId(formData.get('plan_id'));
    const res = id ? await mongo().collection('workout_plans').deleteOne({ _id: id, memberId: me.member_id, trainerId: null }) : { deletedCount: 0 };
    revalidatePath('/member/workouts');
    return res.deletedCount ? { ok: true, message: 'Plan deleted.' } : { ok: false, message: 'Only plans you made yourself can be deleted.' };
}

// Adds a private exercise to the library, visible only to this member
export async function addCustomExercise(prevState, formData) {
    const me = await requireRole('member');
    const name = String(formData.get('name') || '').trim().slice(0, 60);
    const category = String(formData.get('category'));
    const level = String(formData.get('level'));
    const primaryMuscle = String(formData.get('primaryMuscle') || '').trim().toLowerCase().slice(0, 40);
    const equipment = String(formData.get('equipment') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 6);
    const instructions = String(formData.get('instructions') || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 10);

    if (name.length < 2) return { ok: false, message: 'Give the exercise a name.' };
    if (!CATEGORIES.includes(category) || !LEVELS.includes(level)) return { ok: false, message: 'Pick a type and level.' };
    if (!primaryMuscle) return { ok: false, message: 'Which muscle does it work?' };
    if (!instructions.length) return { ok: false, message: 'Add at least one instruction line.' };

    const base = name.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    try {
        await mongo().collection('exercises').insertOne({
            name, slug: `${base}-m${me.member_id}`, category, primaryMuscle, secondaryMuscles: [],
            equipment: equipment.length ? equipment : ['bodyweight'], level, instructions, tags: ['custom'],
            createdBy: me.member_id,
        });
    } catch (err) {
        return { ok: false, message: err.code === 11000 ? 'You already added an exercise with that name.' : 'The exercise did not pass validation.' };
    }
    revalidatePath('/member/exercises');
    revalidatePath('/member/workouts/new');
    return { ok: true, message: `${name} added. You can now use it in your own plans.` };
}
