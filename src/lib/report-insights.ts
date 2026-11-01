import type { ExploreRow } from "./search-console";

/**
 * Findings worked out from a month of Search Console data against the month before: what grew,
 * what fell, what is close to page one, and where more clicks are within reach. Every point comes
 * straight from the numbers; nothing is estimated or invented.
 */

export type KeywordMove = { key: string; clicks: number; previousClicks: number; position: number; previousPosition: number | null; impressions: number };

const searches = (n: number) => `${n} search${n === 1 ? "" : "es"}`;

const toMove = (r: ExploreRow): KeywordMove => ({ key: r.key, clicks: r.clicks, previousClicks: r.previous?.clicks ?? 0, position: r.position, previousPosition: r.previous?.position ?? null, impressions: r.impressions });

export function insights(queries: ExploreRow[], pages: ExploreRow[]) {
  const gained = queries
    .filter((r) => r.clicks - (r.previous?.clicks ?? 0) >= 2)
    .sort((a, b) => b.clicks - (b.previous?.clicks ?? 0) - (a.clicks - (a.previous?.clicks ?? 0)))
    .slice(0, 8)
    .map(toMove);
  const lost = queries
    .filter((r) => r.previous && r.previous.clicks - r.clicks >= 2)
    .sort((a, b) => b.previous!.clicks - b.clicks - (a.previous!.clicks - a.clicks))
    .slice(0, 5)
    .map(toMove);
  const climbed = queries
    .filter((r) => r.previous && r.impressions >= 20 && r.previous.position - r.position >= 1)
    .sort((a, b) => b.previous!.position - b.position - (a.previous!.position - a.position))
    .slice(0, 8)
    .map(toMove);
  const newKeywords = queries.filter((r) => !r.previous && r.impressions > 0);
  // Page two today, page one next: searches people already see the site for.
  const nearPageOne = queries
    .filter((r) => r.position > 7.5 && r.position <= 20 && r.impressions >= 30)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10)
    .map(toMove);
  // Seen often near the top but rarely clicked: titles and descriptions to improve.
  const lowCtr = queries
    .filter((r) => r.position <= 7 && r.impressions >= 100 && r.ctr < 0.02)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 6)
    .map(toMove);
  const pagesDown = pages
    .filter((r) => r.previous && r.previous.clicks - r.clicks >= 5)
    .sort((a, b) => b.previous!.clicks - b.clicks - (a.previous!.clicks - a.clicks))
    .slice(0, 5)
    .map(toMove);
  const top3 = queries.filter((r) => r.position <= 3 && r.impressions >= 10).length;
  const top10 = queries.filter((r) => r.position <= 10 && r.impressions >= 10).length;
  const previousTop10 = queries.filter((r) => r.previous && r.previous.position <= 10 && r.previous.impressions >= 10).length;

  const plan: string[] = [];
  if (nearPageOne.length) plan.push(`Move ${searches(nearPageOne.length)} from page two to page one — starting with “${nearPageOne[0].key}” (position ${nearPageOne[0].position.toFixed(1)}, ${Math.round(nearPageOne[0].impressions).toLocaleString()} impressions)`);
  if (lowCtr.length) plan.push(`Rewrite titles and descriptions for ${searches(lowCtr.length)} that ${lowCtr.length === 1 ? "is" : "are"} seen often but rarely clicked, such as “${lowCtr[0].key}”`);
  if (pagesDown.length) plan.push(`Refresh ${pagesDown.length} page${pagesDown.length === 1 ? "" : "s"} that lost clicks, beginning with ${pagesDown[0].key.replace(/^https?:\/\/[^/]+/, "") || "/"}`);
  if (lost.length) plan.push(`Win back “${lost[0].key}”${lost.length > 1 ? ` and ${lost.length - 1} other search${lost.length === 2 ? "" : "es"}` : ""} with stronger content and internal links`);
  if (newKeywords.length) plan.push(`Build on ${newKeywords.length} new ${newKeywords.length === 1 ? "search" : "searches"} the site started to appear for — supporting content and internal links`);
  if (!plan.length) plan.push("Keep publishing helpful content around the main services and strengthen internal links between related pages");

  return { gained, lost, climbed, newKeywords: newKeywords.length, nearPageOne, lowCtr, pagesDown, top3, top10, previousTop10, plan };
}
