import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace } from "@/lib/workspace";
import { saveCredentials } from "@/lib/integrations";
import { rankingsAndCompetitors } from "@/lib/research/gbp";
import { competitorGap, findBusinesses, gridPoints, gridSummary, scanGrid, weaknessesOf } from "@/lib/research/places-tools";
import { addFoundBusiness, findProspects, scanMapsGrid } from "@/lib/research/places-service";
import { competitorLines } from "@/lib/proposals/generate";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const place = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, displayName: { text: name }, ...extra });

describe("Places API features (fake Google)", () => {
  it("finds businesses with the weakest profiles first", async () => {
    let mask = "";
    const fake = (async (_url: string, init?: RequestInit) => {
      mask = String((init?.headers as Record<string, string>)["X-Goog-FieldMask"]);
      return json({
        places: [
          place("a", "Bright Smiles", { rating: 4.8, userRatingCount: 320, websiteUri: "https://bright.example" }),
          place("b", "Dr Khan Dental", { rating: 3.6, userRatingCount: 12 }),
          place("c", "Closed Clinic", { businessStatus: "CLOSED_PERMANENTLY" }),
          place("d", "Marina Dental", { rating: 4.4, userRatingCount: 35, websiteUri: "https://marina.example" }),
        ],
      });
    }) as unknown as typeof fetch;
    const list = await findBusinesses("key", "dentist Dubai", fake);
    expect(mask).toContain("places.userRatingCount");
    expect(list.map((b) => b.name)).toEqual(["Dr Khan Dental", "Marina Dental", "Bright Smiles"]);
    expect(list[0].weaknesses).toEqual(["No website on the profile", "Low rating (3.6★)", "Only 12 reviews"]);
    expect(list[2].score).toBe(0);
    expect(weaknessesOf({ website: "x", rating: null, reviewCount: 0 }).weaknesses).toEqual(["No Google reviews yet"]);
  });

  it("adds a found business as a prospect once, with its profile figures", async () => {
    const user = await db.user.create({ data: { email: `pf${Date.now()}@test.example`, name: "P", passwordHash: "x" } });
    const ws = await createWorkspace("PF WS", user.id);
    await expect(findProspects(ws.id, "dentist Dubai")).rejects.toThrow(/Places API/);
    await saveCredentials(ws.id, "PLACES", { secret: { apiKey: "k" } });
    const fake = (async () => json({ places: [place("pl-1", "Dr Khan Dental", { rating: 3.6, userRatingCount: 12, formattedAddress: "Marina Walk, Dubai, UAE", googleMapsUri: "https://maps.google.com/?cid=1" })] })) as unknown as typeof fetch;
    const [found] = await findProspects(ws.id, "dentist Dubai", fake);
    expect(found.prospectId).toBeNull();
    const r = await addFoundBusiness(ws.id, user.id, found, "dentist Dubai");
    expect(r.created).toBe(true);
    const p = await db.prospect.findUniqueOrThrow({ where: { id: r.prospectId } });
    expect(p).toMatchObject({ businessName: "Dr Khan Dental", city: "Dubai", leadSource: "Prospect Finder" });
    const g = await db.gbpProfile.findFirstOrThrow({ where: { prospectId: p.id } });
    expect(g).toMatchObject({ placeId: "pl-1", rating: 3.6, reviewCount: 12, source: "PLACES_API" });
    expect((await addFoundBusiness(ws.id, user.id, found, "dentist Dubai")).created).toBe(false);
    expect((await findProspects(ws.id, "dentist Dubai", fake))[0].prospectId).toBe(p.id);
  });

  it("reads the top three competitors from the first Maps search", async () => {
    const masks: string[] = [];
    const fake = (async (_url: string, init?: RequestInit) => {
      masks.push(String((init?.headers as Record<string, string>)["X-Goog-FieldMask"]));
      return json({ places: [place("x", "Leader", { rating: 4.9, userRatingCount: 210 }), place("me", "Me", { rating: 4.1, userRatingCount: 18 }), place("y", "Second", { rating: 4.7, userRatingCount: 140 }), place("z", "Third", { rating: 4.5, userRatingCount: 70 }), place("w", "Fourth")] });
    }) as unknown as typeof fetch;
    const r = await rankingsAndCompetitors("k", "me", ["dentist marina", "dentist dubai"], fake);
    expect(r.rankings.map((x) => x.position)).toEqual([2, 2]);
    expect(r.competitors.map((c) => [c.name, c.reviewCount, c.position])).toEqual([
      ["Leader", 210, 1],
      ["Second", 140, 3],
      ["Third", 70, 4],
    ]);
    // Only the first search asks for ratings (the costlier fields).
    expect(masks[1]).toBe("places.id");
    expect(competitorGap({ name: "Me", rating: 4.1, reviewCount: 18 }, r.competitors)?.lines[0]).toBe("Me has 18 Google reviews; the top 3 competitors average 140.");
    const gbp = { name: "Me", category: null, rating: 4.1, reviewCount: 18, photoCount: 3, hasHours: true, source: "PLACES_API", rankings: [{ query: "dentist marina", position: 2, total: 20 }], issues: [], competitors: r.competitors };
    expect(competitorLines("Me", gbp)[0]).toMatch(/\*\*Me has 18 Google reviews; the top 3 businesses Google Maps shows for “dentist marina” have 140 on average\*\*/);
  });

  it("scans a ranking grid around the business", async () => {
    const pts = gridPoints({ lat: 25, lng: 55 }, 3, 1);
    expect(pts).toHaveLength(9);
    expect(pts[4]).toEqual({ lat: 25, lng: 55 });
    expect(pts[0].lat).toBeGreaterThan(25);
    expect(pts[0].lng).toBeLessThan(55);
    const fake = (async (_url: string, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      const lat = b.locationBias.circle.center.latitude;
      // North of the business it is not found; at the centre it is first; south it is 5th.
      const ids = lat > 25.001 ? ["o1", "o2"] : lat < 24.999 ? ["o1", "o2", "o3", "o4", "me"] : ["me"];
      return json({ places: ids.map((id) => ({ id })) });
    }) as unknown as typeof fetch;
    const grid = await scanGrid("k", "me", "dentist", { lat: 25, lng: 55 }, { size: 3, spacingKm: 1 }, fake);
    expect(grid.map((p) => p.position)).toEqual([null, null, null, 1, 1, 1, 5, 5, 5]);
    expect(gridSummary(grid)).toMatchObject({ top3: 3, top10: 6, missing: 3, total: 9 });
  });

  it("saves a grid scan for a prospect and shows it in the proposal", async () => {
    const user = await db.user.create({ data: { email: `grid${Date.now()}@test.example`, name: "G", passwordHash: "x" } });
    const ws = await createWorkspace("Grid WS", user.id);
    await saveCredentials(ws.id, "PLACES", { secret: { apiKey: "k" } });
    const fake = (async (url: string) => (url.includes("/places/me") ? json({ location: { latitude: 25, longitude: 55 } }) : json({ places: [{ id: "me" }] }))) as unknown as typeof fetch;
    const prospect = await db.prospect.create({ data: { workspaceId: ws.id, businessName: "Me", websiteUrl: "https://me.example/", domain: "me.example" } });
    await expect(scanMapsGrid(ws.id, user.id, prospect.id, { query: "dentist", size: 3, spacingKm: 1 }, fake)).rejects.toThrow(/Fetch the Google Business Profile/);
    await db.gbpProfile.create({ data: { workspaceId: ws.id, prospectId: prospect.id, source: "PLACES_API", placeId: "me", name: "Me", reviews: [], rankings: [] } });
    const scan = await scanMapsGrid(ws.id, user.id, prospect.id, { query: "dentist", size: 3, spacingKm: 1 }, fake);
    expect((scan.points as { position: number }[]).every((p) => p.position === 1)).toBe(true);
    expect((await db.gbpProfile.findFirstOrThrow({ where: { prospectId: prospect.id } })).lat).toBe(25);

    const { proposalGbp } = await import("@/lib/proposals/service");
    const { gbp } = await proposalGbp(prospect.id, "me.example");
    expect(gbp?.grid).toMatchObject({ query: "dentist", size: 3, positions: [1, 1, 1, 1, 1, 1, 1, 1, 1] });
  });
});
