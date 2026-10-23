export const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export const DEFAULT_PIPELINE_STATUSES: { key: string; label: string; isTerminal?: boolean }[] = [
  { key: "NEW_PROSPECT", label: "New Prospect" },
  { key: "AUDIT_IN_PROGRESS", label: "Audit In Progress" },
  { key: "AUDIT_COMPLETED", label: "Audit Completed" },
  { key: "PROPOSAL_DRAFT", label: "Proposal Draft" },
  { key: "PROPOSAL_READY", label: "Proposal Ready" },
  { key: "PROPOSAL_SENT", label: "Proposal Sent" },
  { key: "FOLLOW_UP_DUE", label: "Follow-up Due" },
  { key: "MEETING_SCHEDULED", label: "Meeting Scheduled" },
  { key: "NEGOTIATION", label: "Negotiation" },
  { key: "WON", label: "Won", isTerminal: true },
  { key: "LOST", label: "Lost", isTerminal: true },
  { key: "NOT_INTERESTED", label: "Not Interested", isTerminal: true },
];

export const LEAD_SOURCES = [
  "Website audit outreach",
  "Referral",
  "Inbound enquiry",
  "LinkedIn",
  "Directory",
  "Event",
  "Other",
] as const;

export const CONTACT_TYPES = [
  "EMAIL",
  "PHONE",
  "WHATSAPP",
  "ADDRESS",
  "CONTACT_FORM",
  "CONTACT_PAGE",
  "SOCIAL",
  "PERSON_NAME",
  "BUSINESS_NAME",
] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  EMAIL: "Email",
  PHONE: "Phone",
  WHATSAPP: "WhatsApp",
  ADDRESS: "Address",
  CONTACT_FORM: "Contact form",
  CONTACT_PAGE: "Contact page",
  SOCIAL: "Social profile",
  PERSON_NAME: "Contact person",
  BUSINESS_NAME: "Business name",
};

export const FOLLOW_UP_TYPES = {
  PROPOSAL_REMINDER: "Proposal reminder",
  CUSTOM: "Custom follow-up",
  MEETING_REMINDER: "Meeting reminder",
  REVIEW_UNANSWERED: "Review unanswered proposal",
  OPENED_NO_REPLY: "Opened, no reply yet — send a follow-up",
} as const;
export type FollowUpType = keyof typeof FOLLOW_UP_TYPES;

export const FOLLOW_UP_STATUSES = ["PENDING", "DONE", "PAUSED", "CANCELLED"] as const;

export const CURRENCIES = ["USD", "EUR", "GBP", "PKR", "AED", "SAR", "INR", "CAD", "AUD"] as const;

export const SESSION_COOKIE = "seo_os_session";
export const SESSION_TTL_DAYS = 14;
