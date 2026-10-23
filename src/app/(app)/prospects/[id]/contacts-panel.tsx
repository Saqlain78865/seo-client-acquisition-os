"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { BadgeCheck, ExternalLink, Pencil, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, type ContactType } from "@/lib/constants";
import { addContactAction, updateContactAction } from "../actions";

type Contact = {
  id: string;
  type: string;
  value: string;
  label: string | null;
  sourceUrl: string | null;
  sourceMethod: string;
  validationStatus: string;
  confidence: string;
  verified: boolean;
  isPreferred: boolean;
  hasConflict: boolean;
  conflictNote: string | null;
};

function ContactRow({ c }: { c: Contact }) {
  const [editing, setEditing] = useState(false);
  const update = updateContactAction.bind(null, c.id);
  const canPrefer = ["EMAIL", "PHONE", "WHATSAPP"].includes(c.type);

  return (
    <li className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">{CONTACT_TYPE_LABELS[c.type as ContactType] ?? c.type}</span>
          {c.isPreferred && <Badge tone="primary">Preferred</Badge>}
          {c.verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Unverified</Badge>}
          {c.validationStatus === "INVALID_FORMAT" && <Badge tone="danger">Invalid format</Badge>}
          {c.hasConflict && <Badge tone="danger">Conflict</Badge>}
        </div>
        {editing ? (
          <form
            action={async (fd) => {
              await update(fd);
              setEditing(false);
              toast.success("Contact updated");
            }}
            className="mt-1 flex gap-2"
          >
            <input type="hidden" name="intent" value="edit" />
            <Input name="value" defaultValue={c.value} aria-label="Contact value" autoFocus />
            <Button type="submit" size="sm">Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </form>
        ) : (
          <p className="mt-0.5 break-all text-sm font-medium">{c.value}</p>
        )}
        <p className="mt-0.5 text-xs text-muted">
          {c.sourceMethod === "CRAWL" ? "Found on website" : c.sourceMethod === "IMPORT" ? "Imported" : "Entered manually"}
          {c.sourceUrl && (
            <>
              {" · "}
              <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 hover:text-primary">
                source <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}
          {c.conflictNote && ` · ${c.conflictNote}`}
        </p>
      </div>
      {!editing && (
        <div className="flex shrink-0 gap-1">
          <form action={update}>
            <input type="hidden" name="intent" value="verify" />
            <Button type="submit" size="icon" variant="ghost" aria-label={c.verified ? "Mark unverified" : "Mark verified"} title={c.verified ? "Mark unverified" : "Mark verified"}>
              <BadgeCheck className={c.verified ? "h-4 w-4 text-success" : "h-4 w-4"} />
            </Button>
          </form>
          {canPrefer && !c.isPreferred && (
            <form action={update}>
              <input type="hidden" name="intent" value="prefer" />
              <Button type="submit" size="icon" variant="ghost" aria-label="Set as preferred recipient" title="Set as preferred recipient">
                <Star className="h-4 w-4" />
              </Button>
            </form>
          )}
          <Button size="icon" variant="ghost" aria-label="Edit contact" title="Edit" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <form
            action={update}
            onSubmit={(e) => {
              if (!confirm(`Remove ${c.value}?`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="delete" />
            <Button type="submit" size="icon" variant="ghost" aria-label="Remove contact" title="Remove">
              <Trash2 className="h-4 w-4 text-danger" />
            </Button>
          </form>
        </div>
      )}
    </li>
  );
}

function AddContactForm({ prospectId }: { prospectId: string }) {
  const [state, action, pending] = useActionState(addContactAction.bind(null, prospectId), undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      toast.success("Contact added");
    }
  }, [state]);
  const e = state?.fieldErrors;
  return (
    <form ref={formRef} action={action} className="grid gap-3 border-t border-border p-5 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
      {state?.error && <Alert tone="danger" className="sm:col-span-3">{state.error}</Alert>}
      <Field label="Contact type" name="type" id="contact-type" error={e?.type}>
        <Select defaultValue="EMAIL">
          {CONTACT_TYPES.map((t) => (
            <option key={t} value={t}>
              {CONTACT_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Contact value" name="value" id="contact-value" error={e?.value}>
        <Input placeholder="name@business.com or +92…" />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        Add
      </Button>
    </form>
  );
}

export function ContactsPanel({ prospectId, contacts }: { prospectId: string; contacts: Contact[] }) {
  return (
    <Card>
      <CardHeader
        title="Contact details"
        description="Verify details and choose a preferred recipient before any outreach."
      />
      {contacts.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">No contact details yet. Run an audit to extract public details, or add them below.</p>
      ) : (
        <ul className="divide-y divide-border">
          {contacts.map((c) => (
            <ContactRow key={c.id} c={c} />
          ))}
        </ul>
      )}
      <AddContactForm prospectId={prospectId} />
    </Card>
  );
}
