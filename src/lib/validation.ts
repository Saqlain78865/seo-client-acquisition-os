import { z } from "zod";
import { CURRENCIES, FOLLOW_UP_TYPES } from "./constants";

const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

// Empty form fields arrive as "" — treat them as "not provided" rather than coercing to 0.
const optionalMoney = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().nonnegative().max(1e9).optional(),
);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required").max(200),
});

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .regex(/[A-Za-z]/, "Include at least one letter")
  .regex(/[0-9]/, "Include at least one number");

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: passwordSchema,
  workspaceName: z.string().trim().min(2, "Workspace name is too short").max(100),
});

export const websiteUrlSchema = z
  .string()
  .trim()
  .min(4, "Enter a website URL")
  .max(2048)
  .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Enter a valid http(s) website URL");

export const prospectSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(200),
  websiteUrl: websiteUrlSchema,
  industry: optionalText(120),
  country: optionalText(80),
  city: optionalText(120),
  primaryServices: optionalText(500),
  leadSource: optionalText(80),
  notes: optionalText(5000),
  estimatedValue: optionalMoney,
  currency: z.enum(CURRENCIES).default("USD"),
  contactName: optionalText(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  phone: optionalText(40),
  whatsapp: optionalText(40),
});
export type ProspectInput = z.input<typeof prospectSchema>;

export const prospectStatusSchema = z.object({
  status: z.string().min(1).max(60),
  lostReason: optionalText(1000),
  wonValue: optionalMoney,
});

export const followUpSchema = z.object({
  prospectId: z.string().min(1),
  type: z.enum(Object.keys(FOLLOW_UP_TYPES) as [keyof typeof FOLLOW_UP_TYPES, ...(keyof typeof FOLLOW_UP_TYPES)[]]),
  dueAt: z.coerce.date(),
  note: optionalText(2000),
});

export const noteSchema = z.object({
  body: z.string().trim().min(1, "Note cannot be empty").max(10000),
  kind: z.enum(["MEETING", "OBJECTION", "GENERAL"]).default("GENERAL"),
});

export const auditRequestSchema = z.object({
  websiteUrl: websiteUrlSchema,
  prospectId: optionalText(40),
  clientName: optionalText(200),
  targetCountry: optionalText(80),
  targetCity: optionalText(120),
  primaryService: optionalText(200),
  secondaryServices: optionalText(500),
  preferredLanguage: optionalText(40),
  businessType: optionalText(120),
  servicePackage: optionalText(120),
  currency: z.enum(CURRENCIES).default("USD"),
  contactName: optionalText(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  whatsapp: optionalText(40),
  discoveryNotes: optionalText(5000),
  // Checkbox: draft the proposal automatically when the audit finishes.
  autoProposal: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()).optional(),
});
export type AuditRequest = Pick<z.output<typeof auditRequestSchema>, "websiteUrl" | "currency"> & Partial<z.output<typeof auditRequestSchema>>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(200),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ["confirmPassword"], message: "The passwords do not match" })
  .refine((d) => d.newPassword !== d.currentPassword, { path: ["newPassword"], message: "Choose a password you have not used here" });

export const addMemberSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  role: z.enum(["ADMIN", "MEMBER"]),
  tempPassword: passwordSchema,
});
