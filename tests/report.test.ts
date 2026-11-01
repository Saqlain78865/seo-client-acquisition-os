import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { createWebsite } from "@/lib/websites";
import { WorkLogError, addWork, deleteWork, monthWork } from "@/lib/work-log";
import { insights } from "@/lib/report-insights";
import type { ExploreRow } from "@/lib/search-console";

const row = (key: string, clicks: number, impressions: number, position: number, prev?: [number, number, number]): ExploreRow => ({
  key,
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
  previous: prev ? { key, clicks: prev[0], impressions: prev[1], ctr: prev[1] ? prev[0] / prev[1] : 0, position: prev[2] } : null,
});

describe("monthly website report", () => {
  it("logs real work per website and month, never another workspace's", async () => {
    const user = await db.user.create({ data: { email: `wl${Date.now()}@test.example`, name: "W", passwordHash: "x" } });
    const ws = await createWorkspace("WL WS", user.id);
    const site = await createWebsite(ws.id, user.id, { name: "Blog", url: `blog${Date.now()}.example`, kind: "OWN" });
    await addWork(ws.id, site.id, { month: "2026-10", category: "INTERNAL_LINKING" });
    await addWork(ws.id, site.id, { month: "2026-10", category: "NEW_CONTENT", title: "Published “Best pad thai in NYC”", url: "blog.example/pad-thai", count: 3 });
    await expect(addWork(ws.id, site.id, { month: "2026-13", category: "OTHER" })).rejects.toThrow(WorkLogError);
    await expect(addWork("other-ws", site.id, { month: "2026-10", category: "OTHER" })).rejects.toThrow(/not found/);
    const entries = await monthWork(ws.id, site.id, "2026-10");
    expect(entries.map((e) => [e.category, e.title, e.count])).toEqual([
      ["INTERNAL_LINKING", "Added internal links between related pages", 1],
      ["NEW_CONTENT", "Published “Best pad thai in NYC”", 3],
    ]);
    expect(entries[1].url).toBe("https://blog.example/pad-thai");
    expect(await monthWork(ws.id, site.id, "2026-11")).toEqual([]);
    await expect(deleteWork("other-ws", entries[0].id)).rejects.toThrow(WorkLogError);
    await deleteWork(ws.id, entries[0].id);
    expect(await monthWork(ws.id, site.id, "2026-10")).toHaveLength(1);
  });

  it("finds wins, losses and opportunities only from the numbers", () => {
    const queries = [
      row("mango sticky rice", 40, 900, 4, [20, 800, 6]),
      row("pad thai nyc", 3, 600, 12.4, [3, 500, 14]),
      row("zoob zib", 5, 2000, 2.5, [12, 1900, 2.4]),
      row("new dish", 2, 50, 9, undefined),
      row("thai near me", 4, 400, 3, [4, 380, 3]),
    ];
    const pages = [row("https://x.example/menu", 10, 300, 5, [30, 320, 5])];
    const r = insights(queries, pages);
    expect(r.gained.map((g) => g.key)).toEqual(["mango sticky rice", "new dish"]);
    expect(r.lost.map((g) => g.key)).toEqual(["zoob zib"]);
    expect(r.climbed.map((g) => g.key)).toEqual(["mango sticky rice", "pad thai nyc"]);
    expect(r.nearPageOne.map((g) => g.key)).toEqual(["pad thai nyc", "new dish"]);
    expect(r.lowCtr.map((g) => g.key)).toEqual(["zoob zib", "thai near me"]);
    expect(r.pagesDown.map((g) => g.key)).toEqual(["https://x.example/menu"]);
    expect(r.newKeywords).toBe(1);
    expect(r.plan[0]).toMatch(/Move 2 searches from page two to page one — starting with “pad thai nyc”/);
    expect(r.plan.length).toBeGreaterThanOrEqual(4);
  });
});
