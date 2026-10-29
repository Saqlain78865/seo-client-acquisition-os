import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Star } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { qrDataUri } from "@/lib/messaging/share";
import { reviewMessages } from "@/lib/review-kit";
import { CopyButton, PrintPosterButton, ReviewLinkForm } from "./kit-bits";

export const metadata: Metadata = { title: "Review kit", robots: { index: false } };

/**
 * A client's review kit: a printable QR poster for the counter and ready review requests for
 * WhatsApp and email, all pointing to the client's own Google review link.
 */
export default async function ReviewKitPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const session = await requireSession();
  const { client: clientId } = await searchParams;
  if (!clientId) notFound();
  const client = await db.prospect.findFirst({ where: { id: clientId, workspaceId: session.workspace.id }, select: { id: true, businessName: true, reviewLink: true } });
  if (!client) notFound();
  const settings = await db.workspaceSettings.findUnique({ where: { workspaceId: session.workspace.id }, select: { brandColor: true } });
  const brand = settings?.brandColor || "#4f46e5";
  const qr = client.reviewLink ? await qrDataUri(client.reviewLink) : null;
  const messages = client.reviewLink ? reviewMessages(client.businessName, client.reviewLink) : [];

  return (
    <div className="theme-light min-h-screen bg-[#eef1f6] py-8 text-[#0f172a] print:bg-white print:py-0">
      <div className="mx-auto max-w-4xl space-y-6 px-4 print:hidden">
        <div className="flex items-center justify-between">
          <Link href={`/prospects/${client.id}`} className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#0f172a]">
            <ArrowLeft className="h-4 w-4" /> {client.businessName}
          </Link>
          {qr && <PrintPosterButton />}
        </div>
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold">Review kit — {client.businessName}</h1>
          <p className="mt-1 text-sm text-[#475569]">
            More genuine Google reviews, every month. Ask <b>every</b> customer the same way — Google does not allow rewards for reviews or asking only happy customers.
          </p>
          <div className="mt-5">
            <p className="mb-1 text-sm font-medium">The client&apos;s Google review link</p>
            <ReviewLinkForm prospectId={client.id} link={client.reviewLink} />
            <p className="mt-1.5 text-xs text-[#64748b]">In Google Business Profile (Search “my business” on Google) press <b>Ask for reviews</b> and copy the link — it looks like g.page/r/…/review.</p>
          </div>
        </section>

        {messages.length > 0 && (
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold">Messages for the client&apos;s customers</h2>
            <p className="mt-1 text-sm text-[#475569]">Give these to the client: they send them after each job or visit, on WhatsApp or by email.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {messages.map((m) => (
                <div key={m.label} dir={m.dir} className="rounded-xl border border-[#e2e8f0] p-4 text-sm">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-[#64748b] uppercase" dir="ltr">
                    {m.label}
                  </p>
                  <p className="font-medium">WhatsApp / SMS</p>
                  <p className="mt-1 text-[#334155]">
                    {m.whatsapp.split("\n").map((line, i) =>
                      // The link always reads left to right, on its own line, even in Urdu and Arabic.
                      line.startsWith("https://") ? (
                        <span key={i} dir="ltr" className="mt-1 block break-all text-left text-[#4f46e5]">
                          {line}
                        </span>
                      ) : (
                        <span key={i} className="block">
                          {line}
                        </span>
                      ),
                    )}
                  </p>
                  <div dir="ltr">
                    <CopyButton text={m.whatsapp} />
                  </div>
                  <p className="mt-3 font-medium">Email</p>
                  <p className="mt-1 text-[#334155]">{m.email.subject}</p>
                  <div dir="ltr">
                    <CopyButton text={`${m.email.subject}\n\n${m.email.body}`} label="Copy email" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {qr && (
        <>
          <p className="mx-auto mt-6 max-w-4xl px-4 text-sm font-medium text-[#475569] print:hidden">Poster preview — print it for the counter, reception or delivery bags:</p>
          <article className="mx-auto mt-3 flex max-w-md flex-col items-center rounded-3xl bg-white px-10 py-12 text-center shadow-xl print:mt-0 print:max-w-none print:rounded-none print:shadow-none" style={{ borderTop: `14px solid ${brand}` }}>
            <div className="flex gap-1" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} className="h-8 w-8 fill-[#fbbc04] text-[#fbbc04]" />
              ))}
            </div>
            <h2 className="mt-5 text-3xl leading-tight font-extrabold">Enjoyed your visit?</h2>
            <p className="mt-2 text-lg text-[#475569]">Tell others on Google — it takes a minute.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code to leave a Google review" className="mt-7 h-60 w-60" />
            <p className="mt-4 text-sm text-[#64748b]">Scan with your phone camera</p>
            <p className="mt-6 text-xl font-bold" style={{ color: brand }}>
              {client.businessName}
            </p>
            <p className="mt-1 text-sm text-[#64748b]">Thank you! 🙏</p>
          </article>
        </>
      )}
    </div>
  );
}
