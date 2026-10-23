// Format checks for contact values. A value that passes is well-formed, not proven to be reachable.

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export function isValidEmailFormat(value: string) {
  return EMAIL_RE.test(value.trim());
}

/** Keeps a leading "+" and digits only. */
export function normalizePhone(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (trimmed.startsWith("00") && digits.length > 2) return `+${digits.slice(2)}`;
  return digits;
}

/** E.164 allows at most 15 digits; national numbers are rarely shorter than 7. */
export function isValidPhoneFormat(value: string) {
  const digits = normalizePhone(value).replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function hasInternationalPrefix(value: string) {
  return normalizePhone(value).startsWith("+");
}

export function validateContactValue(type: string, value: string): "VALID_FORMAT" | "INVALID_FORMAT" | "UNCHECKED" {
  if (type === "EMAIL") return isValidEmailFormat(value) ? "VALID_FORMAT" : "INVALID_FORMAT";
  if (type === "PHONE" || type === "WHATSAPP") return isValidPhoneFormat(value) ? "VALID_FORMAT" : "INVALID_FORMAT";
  return "UNCHECKED";
}

export function normalizeContactValue(type: string, value: string) {
  if (type === "EMAIL") return value.trim().toLowerCase();
  if (type === "PHONE" || type === "WHATSAPP") return normalizePhone(value);
  return value.trim();
}
