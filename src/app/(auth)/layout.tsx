import { redirect } from "next/navigation";
import { CheckCircle2, SearchCheck } from "lucide-react";
import { getSession } from "@/lib/auth";

const POINTS = [
  "Paste a website — get an evidence-based audit in minutes",
  "A client-ready SEO proposal is drafted for you automatically",
  "Know when the client opens it, and let them accept online",
];

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSession()) redirect("/");
  return (
    <div className="app-backdrop grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-navy via-navy-2 to-[#2a1f6e] p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -top-32 -right-24 h-96 w-96 rounded-full bg-primary/35 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-accent/25 blur-3xl" />
        <div className="relative flex items-center gap-2.5 text-sm font-semibold">
          <span className="rounded-xl bg-gradient-to-br from-primary to-accent p-2 shadow-lg shadow-primary/30">
            <SearchCheck className="h-4 w-4" />
          </span>
          SEO Client Acquisition OS
        </div>
        <div className="animate-rise relative max-w-md">
          <p className="text-4xl leading-tight font-bold tracking-tight">
            From website URL to <span className="bg-gradient-to-r from-[#a5b4fc] to-[#c4b5fd] bg-clip-text text-transparent">signed client</span>.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/75">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#a5b4fc]" /> {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">Findings are only reported when they are backed by collected evidence.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="animate-rise w-full max-w-sm rounded-3xl border border-border bg-surface p-7 shadow-lift sm:p-8">{children}</div>
      </div>
    </div>
  );
}
