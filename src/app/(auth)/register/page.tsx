"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { register } from "../actions";

export default function RegisterPage() {
  const [state, action, pending] = useActionState(register, undefined);
  const e = state?.fieldErrors;
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create owner account</h1>
      <p className="mt-1 text-sm text-muted">This sets up your workspace. Team members can be added later.</p>
      <form action={action} className="mt-6 space-y-4" noValidate>
        {state?.error && <Alert tone="danger">{state.error}</Alert>}
        <Field label="Your name" name="name" error={e?.name} required>
          <Input autoComplete="name" />
        </Field>
        <Field label="Agency / workspace name" name="workspaceName" error={e?.workspaceName} required>
          <Input autoComplete="organization" />
        </Field>
        <Field label="Email" name="email" error={e?.email} required>
          <Input type="email" autoComplete="email" />
        </Field>
        <Field label="Password" name="password" error={e?.password} hint="At least 10 characters, with a letter and a number." required>
          <Input type="password" autoComplete="new-password" />
        </Field>
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
