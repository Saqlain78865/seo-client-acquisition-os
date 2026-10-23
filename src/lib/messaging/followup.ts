/**
 * Follow-up message drafted after the client opens the proposal but has not replied. It never
 * mentions that the link was opened (that would feel like tracking); it simply offers help.
 * The user reviews and edits it before anything is sent.
 */

export type FollowUpInput = {
  firstName: string | null;
  businessName: string;
  sentOn: string | null;
  shareLink: string | null;
  findingsSummary: string;
  consultantName: string | null;
  companyName: string | null;
};

export function followUpDraft(i: FollowUpInput) {
  const hello = `Hi ${i.firstName?.trim() || "there"},`;
  const reminder = i.findingsSummary ? `As a quick reminder: ${i.findingsSummary}` : "";
  const signature = [i.consultantName, i.companyName].filter(Boolean).join("\n");
  const email = [
    hello,
    `I hope you're well. I wanted to follow up on the SEO proposal I sent${i.sentOn ? ` on ${i.sentOn}` : ""} for ${i.businessName}.`,
    reminder,
    "Is there anything you would like me to explain, or any questions I can answer? I'm happy to walk you through it on a short 15-minute call at a time that suits you.",
    i.shareLink ? `You can view the proposal here: ${i.shareLink}` : "",
    `Best regards,${signature ? `\n${signature}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const whatsapp = [
    `${hello.replace(/,$/, "")} — just following up on the SEO proposal for ${i.businessName}. Any questions I can help with? Happy to do a quick call whenever suits you.`,
    i.shareLink ?? "",
    i.consultantName ? `– ${i.consultantName}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { subject: `Quick follow-up: SEO proposal for ${i.businessName}`, email, whatsapp };
}
