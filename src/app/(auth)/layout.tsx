import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { getSession } from "@/lib/auth";
import { Constellation, Marquee, OrbitCore, Typewriter } from "@/components/motion";

const CAPABILITIES = ["Evidence-based website audits", "Issue screenshots", "Google Business checks", "Branded SEO proposals", "Proposal reading analytics", "Follow-ups that write themselves", "Client work board"];

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSession()) redirect("/");
  return (
    <div className="grid min-h-screen bg-[#05070d] lg:grid-cols-[1.15fr_1fr]">
      <div className="relative hidden flex-col overflow-hidden border-r border-white/5 bg-[radial-gradient(60rem_40rem_at_80%_10%,rgb(79_70_229/0.28),transparent_60%),radial-gradient(40rem_30rem_at_0%_100%,rgb(103_232_249/0.12),transparent_60%),#05070d] text-white lg:flex">
        <Constellation />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.025)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.025)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />

        <div className="relative px-10 pt-9">
          <Logo tagline inverted />
        </div>

        <div className="relative grid flex-1 items-center gap-6 px-10 xl:grid-cols-[1fr_0.95fr]">
          <div className="animate-rise">
            <Typewriter text="Audit · Propose · Win" className="text-[#67e8f9]" />
            <h1 className="mt-5 text-5xl leading-[1.02] font-bold tracking-[-0.03em] xl:text-6xl">
              Win more
              <br />
              clients.
              <br />
              <span className="font-light text-white/55">Without the</span>
              <br />
              <span className="text-glow">busywork.</span>
            </h1>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-white/60">Paste a website and get an evidence-based audit, a branded proposal and the follow-ups — then see when your client reads it.</p>
          </div>
          <div className="hidden xl:block">
            <OrbitCore />
            <p className="mt-2 text-center font-mono text-[10px] tracking-[0.25em] text-white/30 uppercase">Illustrative · move your cursor</p>
          </div>
        </div>

        <div className="relative border-t border-white/5 py-4 text-sm font-medium text-white/55">
          <Marquee items={CAPABILITIES} />
        </div>
      </div>

      <div className="relative flex items-center justify-center bg-bg p-6">
        <div className="animate-rise w-full max-w-sm rounded-3xl border border-border bg-surface p-7 shadow-lift sm:p-8">{children}</div>
      </div>
    </div>
  );
}
