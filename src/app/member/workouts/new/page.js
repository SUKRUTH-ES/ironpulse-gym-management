import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { mongo } from '@/lib/mongo';
import { PageHeader, Card } from '@/components/ui';
import { PlanBuilder } from './plan-builder';
import { createOwnPlan } from '../../actions';

export const metadata = { title: 'Create my plan' };

export default async function NewPlanPage() {
    const me = await requireRole('member');
    // Shared library + this member's private exercises
    const exercises = await mongo().collection('exercises')
        .find({ createdBy: { $in: [null, me.member_id] } }, { projection: { name: 1, slug: 1, category: 1, primaryMuscle: 1, createdBy: 1 } })
        .sort({ category: 1, name: 1 })
        .toArray();

    return (
        <>
            <PageHeader title="Create my own plan" subtitle="No trainer needed: choose your days, exercises, sets and reps.">
                <Link href="/member/exercises#add" className="btn btn-secondary">Add a missing exercise</Link>
            </PageHeader>
            <Card>
                <PlanBuilder
                    action={createOwnPlan}
                    exercises={exercises.map((e) => ({ slug: e.slug, name: e.name, category: e.category, primaryMuscle: e.primaryMuscle, custom: e.createdBy != null }))}
                />
            </Card>
        </>
    );
}
