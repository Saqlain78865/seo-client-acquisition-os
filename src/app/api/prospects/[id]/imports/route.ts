import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { reportError, withReference } from "@/lib/log";
import { IMPORT_KINDS, IMPORT_SOURCES, type ImportKind, type ImportSource } from "@/lib/research/csv";
import { MAX_IMPORT_BYTES, ResearchError, analyseKeywords, importCsv } from "@/lib/research/service";

/** CSV upload (route handler rather than a server action, so exports up to 8 MB are accepted). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Same check Next.js applies to server actions: a browser POST from another site is refused.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const originHost = origin ? URL.parse(origin)?.host ?? "invalid" : null;
  if (originHost && host && originHost !== host) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_IMPORT_BYTES + 64 * 1024) return NextResponse.json({ error: "The file is larger than 8 MB." }, { status: 413 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload a CSV file." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a CSV file to upload." }, { status: 400 });
  const kind = String(form.get("kind") ?? "");
  const source = String(form.get("source") ?? "");

  try {
    const result = await importCsv(
      session.workspace.id,
      session.user.id,
      id,
      { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) },
      {
        kind: kind in IMPORT_KINDS ? (kind as ImportKind) : undefined,
        source: source in IMPORT_SOURCES ? (source as ImportSource) : undefined,
        periodLabel: String(form.get("periodLabel") ?? "") || undefined,
      },
    );
    if (result.kind === "KEYWORDS" || result.kind === "GSC_QUERIES") await analyseKeywords(session.workspace.id, id);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ResearchError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: withReference("The import failed.", await reportError("imports", e)) }, { status: 500 });
  }
}
