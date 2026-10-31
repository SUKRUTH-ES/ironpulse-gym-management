import Link from 'next/link';
import { sql } from '@/lib/db';
import { PageHeader, Card, Empty } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { checkIn, checkOut } from '../actions';
import { time } from '@/lib/format';

export const metadata = { title: 'Front desk' };

export default async function CheckInPage() {
    const inGym = await sql(
        `SELECT a.attendance_id, a.check_in, m.member_id, m.member_code, u.full_name,
                TIMESTAMPDIFF(MINUTE, a.check_in, NOW()) AS minutes, cm.plan_name
         FROM attendance a
         JOIN members m ON m.member_id = a.member_id
         JOIN users u   ON u.user_id = m.user_id
         LEFT JOIN v_current_memberships cm ON cm.member_id = m.member_id
         WHERE a.check_out IS NULL
         ORDER BY a.check_in DESC`);

    return (
        <>
            <PageHeader title="Front desk" subtitle="Check members in and out with the code on their card (e.g. GM000012)." />

            <div className="grid gap-6 lg:grid-cols-3">
                <Card title="Check in / out" className="lg:col-span-1">
                    <ActionForm action={checkIn} resetOnSuccess className="space-y-3">
                        <label className="label" htmlFor="code-in">Member code</label>
                        <input id="code-in" name="member_code" className="input font-mono uppercase" placeholder="GM000012" required pattern="[Gg][Mm][0-9]{6}" autoFocus />
                        <SubmitButton className="btn btn-primary w-full">Check in</SubmitButton>
                    </ActionForm>
                    <hr className="my-5 border-slate-200" />
                    <ActionForm action={checkOut} resetOnSuccess className="space-y-3">
                        <label className="label" htmlFor="code-out">Member code</label>
                        <input id="code-out" name="member_code" className="input font-mono uppercase" placeholder="GM000012" required pattern="[Gg][Mm][0-9]{6}" />
                        <SubmitButton className="btn btn-secondary w-full">Check out</SubmitButton>
                    </ActionForm>
                    <p className="mt-4 text-xs text-slate-500">
                        The database refuses entry if the member has no active plan today, if their plan is frozen, or if they are already inside.
                    </p>
                </Card>

                <Card title={`In the gym now (${inGym.length})`} className="lg:col-span-2">
                    {inGym.length ? (
                        <div className="overflow-x-auto">
                            <table className="data-table">
                                <thead><tr><th>Member</th><th>Code</th><th>Plan</th><th>Since</th><th /></tr></thead>
                                <tbody>
                                    {inGym.map((v) => (
                                        <tr key={v.attendance_id}>
                                            <td><Link href={`/admin/members/${v.member_id}`} className="font-medium text-teal-700 hover:underline">{v.full_name}</Link></td>
                                            <td className="font-mono text-xs">{v.member_code}</td>
                                            <td>{v.plan_name ?? '—'}</td>
                                            <td className="tabular-nums">{time(v.check_in)} <span className="text-xs text-slate-500">({v.minutes} min)</span></td>
                                            <td className="text-right">
                                                <ActionForm action={checkOut} inlineMessage className="flex items-center justify-end gap-2">
                                                    <input type="hidden" name="member_code" value={v.member_code} />
                                                    <SubmitButton className="btn btn-secondary btn-sm">Check out</SubmitButton>
                                                </ActionForm>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : <Empty>Nobody is checked in.</Empty>}
                </Card>
            </div>
        </>
    );
}
