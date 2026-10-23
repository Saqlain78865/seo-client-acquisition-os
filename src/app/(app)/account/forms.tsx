"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { addMemberAction, changePasswordAction, changeRoleAction, removeMemberAction, signOutOthersAction } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      toast.success(state.message ?? "Password changed");
    }
  }, [state]);
  const e = state?.fieldErrors;
  return (
    <form ref={formRef} action={action} className="space-y-3" noValidate>
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="Current password" name="currentPassword" error={e?.currentPassword}>
        <Input type="password" autoComplete="current-password" />
      </Field>
      <Field label="New password" name="newPassword" error={e?.newPassword} hint="At least 10 characters, with a letter and a number">
        <Input type="password" autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password" name="confirmPassword" error={e?.confirmPassword}>
        <Input type="password" autoComplete="new-password" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}

export function SignOutOthersButton({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending || disabled}
      onClick={() =>
        start(async () => {
          const r = await signOutOthersAction();
          toast.success(`Signed out ${r.count} other session${r.count === 1 ? "" : "s"}`);
          router.refresh();
        })
      }
    >
      Sign out other devices
    </Button>
  );
}

export function AddMemberForm() {
  const [state, action, pending] = useActionState(addMemberAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);
  const e = state?.fieldErrors;
  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-2" noValidate>
      {state?.error && <Alert tone="danger" className="sm:col-span-2">{state.error}</Alert>}
      {state?.ok && state.message && <Alert tone="success" className="sm:col-span-2">{state.message}</Alert>}
      <Field label="Name" name="name" id="member-name" error={e?.name}>
        <Input autoComplete="off" />
      </Field>
      <Field label="Email" name="email" id="member-email" error={e?.email}>
        <Input type="email" autoComplete="off" />
      </Field>
      <Field label="Role" name="role" id="member-role" error={e?.role} hint="Admins can change settings and integrations">
        <Select defaultValue="MEMBER">
          <option value="MEMBER">Member</option>
          <option value="ADMIN">Admin</option>
        </Select>
      </Field>
      <Field label="Temporary password" name="tempPassword" id="member-tempPassword" error={e?.tempPassword} hint="Only used if they do not have an account yet">
        <Input type="password" autoComplete="new-password" />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          Add member
        </Button>
      </div>
    </form>
  );
}

export function MemberControls({ membershipId, role, name }: { membershipId: string; role: string; name: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(done);
      else toast.error(r.error ?? "Failed");
      router.refresh();
    });
  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label={`Role for ${name}`}
        className="h-8 w-28 text-xs"
        value={role}
        disabled={pending}
        onChange={(ev) => run(() => changeRoleAction(membershipId, ev.target.value), "Role updated")}
      >
        <option value="OWNER">Owner</option>
        <option value="ADMIN">Admin</option>
        <option value="MEMBER">Member</option>
      </Select>
      <Button
        size="sm"
        variant="ghost"
        className="text-danger"
        disabled={pending}
        onClick={() => confirm(`Remove ${name} from this workspace? They will be signed out.`) && run(() => removeMemberAction(membershipId), "Member removed")}
      >
        Remove
      </Button>
    </div>
  );
}
