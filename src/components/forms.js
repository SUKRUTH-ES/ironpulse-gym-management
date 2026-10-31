'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

export function SubmitButton({ children, pendingText, className = 'btn btn-primary', ...props }) {
    const { pending } = useFormStatus();
    return (
        <button type="submit" disabled={pending} className={className} {...props}>
            {pending ? (pendingText ?? 'Working…') : children}
        </button>
    );
}

// A <form> bound to a server action that returns { ok, message }.
// Shows the message under the form and optionally clears the inputs on success.
export function ActionForm({ action, children, className = '', resetOnSuccess = false, inlineMessage = false }) {
    const [state, formAction] = useActionState(action, null);
    const formRef = useRef(null);

    useEffect(() => {
        if (state?.ok && resetOnSuccess) formRef.current?.reset();
    }, [state, resetOnSuccess]);

    const message = state?.message && (
        <p role="status" className={`text-sm ${state.ok ? 'text-emerald-700' : 'text-rose-700'} ${inlineMessage ? '' : 'mt-2'}`}>
            {state.message}
        </p>
    );

    return (
        <form ref={formRef} action={formAction} className={className}>
            {children}
            {message}
        </form>
    );
}
