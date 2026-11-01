"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Input, Select } from "@/components/ui";
import { createWebsiteAction } from "./actions";

export function AddWebsiteForm() {
  const [form, setForm] = useState({ name: "", url: "", kind: "OWN" as "OWN" | "CLIENT" });
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createWebsiteAction(form);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Website added");
          router.push(`/websites/${r.id}`);
        });
      }}
    >
      <Field label="Name" name="name" required>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My SEO blog" required />
      </Field>
      <Field label="Website" name="url" required>
        <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="example.com" required />
      </Field>
      <Field label="Type" name="kind">
        <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "OWN" | "CLIENT" })}>
          <option value="OWN">My own site</option>
          <option value="CLIENT">Client site</option>
        </Select>
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add website
      </Button>
    </form>
  );
}
