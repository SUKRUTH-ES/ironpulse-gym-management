'use client';

import { createContext, startTransition, useActionState, useContext, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

// ActionForm submits through onSubmit, so useFormStatus() can't see it; it shares its pending flag here instead.
const PendingContext = createContext(false);

export function SubmitButton({ children, pendingText, className = 'btn btn-primary', disabled, ...props }) {
    const { pending: formPending } = useFormStatus();
    const actionFormPending = useContext(PendingContext);
    const pending = formPending || actionFormPending;
    return (
        <button type="submit" disabled={pending || disabled} className={className} {...props}>
            {pending ? (pendingText ?? 'Working…') : children}
        </button>
    );
}

// A <form> bound to a server action that returns { ok, message }.
// Shows the message under the form and optionally clears the inputs on success.
// `confirm` (text) asks "are you sure?" first - use it for actions that cannot be undone.
// `showSuccess={false}` hides a success message that no longer applies (errors are always shown).
// It calls the action from onSubmit rather than <form action>, because React resets a form after
// every <form action> submit, which wiped what the user typed whenever the server returned an error.
export function ActionForm({ action, children, className = '', resetOnSuccess = false, inlineMessage = false, confirm, showSuccess = true }) {
    const [state, formAction, isPending] = useActionState(action, null);
    const formRef = useRef(null);

    function handleSubmit(event) {
        event.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const formData = new FormData(event.currentTarget, event.nativeEvent.submitter);
        startTransition(() => formAction(formData));
    }

    useEffect(() => {
        if (state?.ok && resetOnSuccess) formRef.current?.reset();
    }, [state, resetOnSuccess]);

    const message = state?.message && (showSuccess || !state.ok) && (
        <p role="status" className={`text-sm ${state.ok ? 'text-emerald-700' : 'text-rose-700'} ${inlineMessage ? '' : 'mt-2'}`}>
            {state.message}
        </p>
    );

    return (
        <PendingContext value={isPending}>
            <form ref={formRef} onSubmit={handleSubmit} className={className}>
                {children}
                {message}
            </form>
        </PendingContext>
    );
}
