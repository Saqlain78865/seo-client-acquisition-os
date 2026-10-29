import "server-only";
import { db } from "./db";
import { logActivity } from "./activity";

/**
 * Review kit for a client: its own Google "write a review" link as a QR poster for the counter and
 * ready messages to send to happy customers. Every customer gets the same request — no incentives
 * and no filtering of unhappy customers, which Google's review policy forbids.
 */

export class ReviewKitError extends Error {}

// Links Google gives for collecting reviews (Business Profile → "Ask for reviews") or opening the profile.
const REVIEW_HOSTS = /^(?:g\.page|search\.google\.com|maps\.app\.goo\.gl|goo\.gl|share\.google|g\.co|(?:www\.)?google\.[a-z.]+|maps\.google\.[a-z.]+|business\.google\.com)$/i;

export function normalizeReviewLink(raw: string) {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new ReviewKitError("Paste the review link from Google Business Profile (Ask for reviews → copy link).");
  }
  if (!REVIEW_HOSTS.test(u.hostname)) throw new ReviewKitError("Use the review link Google gives you (it starts with g.page/r/… or a Google address).");
  u.protocol = "https:";
  return u.toString();
}

export async function setReviewLink(workspaceId: string, userId: string, prospectId: string, raw: string) {
  const link = raw.trim() ? normalizeReviewLink(raw) : null;
  const { count } = await db.prospect.updateMany({ where: { id: prospectId, workspaceId }, data: { reviewLink: link } });
  if (!count) throw new ReviewKitError("Client not found.");
  await logActivity({ workspaceId, prospectId, userId, type: "review_kit.link", message: link ? "Google review link saved for the review kit" : "Google review link removed" });
  return link;
}

export type ReviewMessages = { label: string; dir: "ltr" | "rtl"; whatsapp: string; email: { subject: string; body: string } }[];

/** Ready-to-send review requests in English, Urdu and Arabic. */
export function reviewMessages(businessName: string, link: string): ReviewMessages {
  return [
    {
      label: "English",
      dir: "ltr",
      whatsapp: `Hi! Thank you for choosing ${businessName} 🙏 If you have a minute, we'd really appreciate a quick Google review about your experience — it helps other customers find us:\n${link}`,
      email: {
        subject: `How was your experience with ${businessName}?`,
        body: `Hi,\n\nThank you for choosing ${businessName}. We'd love to hear how it went — your honest review on Google takes about a minute and helps other customers decide:\n\n${link}\n\nThank you!\n${businessName}`,
      },
    },
    {
      label: "اردو (Urdu)",
      dir: "rtl",
      whatsapp: `السلام علیکم! ${businessName} کو منتخب کرنے کا شکریہ 🙏 اگر ایک منٹ ہو تو گوگل پر اپنے تجربے کے بارے میں ریویو ضرور لکھیں — اس سے دوسرے کسٹمرز کو مدد ملتی ہے:\n${link}`,
      email: {
        subject: `${businessName} کے ساتھ آپ کا تجربہ کیسا رہا؟`,
        body: `السلام علیکم،\n\n${businessName} کو منتخب کرنے کا شکریہ۔ گوگل پر آپ کا ایماندارانہ ریویو صرف ایک منٹ لیتا ہے اور دوسرے کسٹمرز کی مدد کرتا ہے:\n\n${link}\n\nشکریہ!\n${businessName}`,
      },
    },
    {
      label: "العربية (Arabic)",
      dir: "rtl",
      whatsapp: `مرحباً! شكراً لاختيارك ${businessName} 🙏 إذا كان لديك دقيقة، يسعدنا تقييمك لتجربتك على جوجل — فهو يساعد العملاء الآخرين:\n${link}`,
      email: {
        subject: `كيف كانت تجربتك مع ${businessName}؟`,
        body: `مرحباً،\n\nشكراً لاختيارك ${businessName}. تقييمك الصادق على جوجل يستغرق دقيقة واحدة ويساعد العملاء الآخرين:\n\n${link}\n\nشكراً لك!\n${businessName}`,
      },
    },
  ];
}
