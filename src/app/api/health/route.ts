import { NextResponse } from "next/server";
import { databaseHealthy } from "@/lib/system";

// For uptime monitors and load balancers. Public, so it reports only up/down — details are on /system.
export async function GET() {
  try {
    await databaseHealthy();
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
