import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardList, FileText, KanbanSquare, Star } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { boardTasks, isMonthKey, monthKey, monthLabel, shiftMonth, wonClients } from "@/lib/client-work";
import { EmptyState, PageHeader, buttonClass, tabBarClass, tabClass } from "@/components/ui";
import { Board, PlanMonth, type BoardTask } from "./board";

export const metadata: Metadata = { title: "Client Work" };

export default async function WorkPage({ searchParams }: { searchParams: Promise<{ month?: string; client?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const month = isMonthKey(sp.month) ? sp.month : monthKey();
  const clients = await wonClients(session.workspace.id);
  const clientId = clients.some((c) => c.id === sp.client) ? sp.client : undefined;
  const tasks = await boardTasks(session.workspace.id, month, clientId);
  const allMonth = clientId ? await boardTasks(session.workspace.id, month) : tasks;
  const planned = new Set(allMonth.map((t) => t.prospectId));
  const unplanned = clients.filter((c) => !planned.has(c.id) && (!clientId || c.id === clientId)).map((c) => ({ id: c.id, name: c.businessName }));
  const href = (m: string, c?: string) => `/work?month=${m}${c ? `&client=${c}` : ""}`;

  return (
    <>
      <PageHeader
        title="Client Work"
        description="Monthly work for won clients: plan it from the proposal, move it along, and turn it into a report."
        actions={
          clientId && (
            <>
              <Link href={`/review-kit?client=${clientId}`} className={buttonClass("secondary")}>
                <Star className="h-4 w-4" /> Review kit
              </Link>
              <Link href={`/work-report?client=${clientId}&month=${month}`} className={buttonClass("secondary")}>
                <FileText className="h-4 w-4" /> Monthly work report
              </Link>
            </>
          )
        }
      />

      {clients.length === 0 ? (
        <EmptyState
          icon={<KanbanSquare className="h-5 w-5" />}
          title="No won clients yet"
          description="When a client accepts a proposal (or you mark a prospect as Won), their monthly work is planned here."
          action={
            <Link href="/deals" className={buttonClass("primary")}>
              Clients and Deals
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-1 rounded-2xl border border-border bg-surface p-1 shadow-card">
              <Link href={href(shiftMonth(month, -1), clientId)} aria-label="Previous month" className="rounded-xl p-1.5 text-muted hover:bg-surface-2 hover:text-text">
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <span className="min-w-36 text-center text-sm font-semibold">{monthLabel(month)}</span>
              <Link href={href(shiftMonth(month, 1), clientId)} aria-label="Next month" className="rounded-xl p-1.5 text-muted hover:bg-surface-2 hover:text-text">
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
            <div className={tabBarClass} role="tablist" aria-label="Client">
              <Link href={href(month)} role="tab" aria-selected={!clientId} className={tabClass(!clientId)}>
                All clients
              </Link>
              {clients.map((c) => (
                <Link key={c.id} href={href(month, c.id)} role="tab" aria-selected={clientId === c.id} className={tabClass(clientId === c.id)}>
                  {c.businessName}
                </Link>
              ))}
            </div>
          </div>

          <PlanMonth month={month} clients={unplanned} />

          {tasks.length === 0 && unplanned.length === 0 ? (
            <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="Nothing on the board this month" description="Add a task in the To do column." />
          ) : null}
          <Board
            key={`${month}-${clientId ?? "all"}`}
            month={month}
            showClient={!clientId}
            clients={(clientId ? clients.filter((c) => c.id === clientId) : clients).map((c) => ({ id: c.id, name: c.businessName }))}
            tasks={tasks.map<BoardTask>((t) => ({ id: t.id, title: t.title, detail: t.detail, status: t.status as BoardTask["status"], source: t.source, client: { id: t.prospect.id, name: t.prospect.businessName } }))}
          />
        </>
      )}
    </>
  );
}
