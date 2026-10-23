"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { login } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="Email" name="email" error={state?.fieldErrors?.email}>
        <Input type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" name="password" error={state?.fieldErrors?.password}>
        <Input type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
