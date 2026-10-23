/**
 * Google PageSpeed Insights client. Works without an API key (lower shared quota); set
 * PAGESPEED_API_KEY for a higher quota. Lab data is a simulated Lighthouse run; field data is
 * 28-day real-user data from the Chrome UX Report and only exists for sites with enough traffic.
 */

export type Strategy = "MOBILE" | "DESKTOP";

export type LabMetrics = {
  performanceScore: number | null;
  lcpMs: number | null;
  fcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
  speedIndexMs: number | null;
};

export type FieldMetric = { percentile: number; category: "FAST" | "AVERAGE" | "SLOW" | string };
export type FieldMetrics = {
  lcp?: FieldMetric;
  inp?: FieldMetric;
  cls?: FieldMetric;
  fcp?: FieldMetric;
  ttfb?: FieldMetric;
  overall?: string;
};

export type PageSpeedResult = { url: string; strategy: Strategy; lab: LabMetrics; field: FieldMetrics | null; fieldScope: "URL" | "ORIGIN" | "NONE"; lighthouseVersion: string | null; fetchedAt: Date };

export class PageSpeedError extends Error {
  constructor(
    message: string,
    readonly code: "QUOTA" | "UNREACHABLE" | "HTTP" | "NETWORK",
  ) {
    super(message);
  }
}

type PsiResponse = {
  lighthouseResult?: {
    lighthouseVersion?: string;
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, { numericValue?: number }>;
  };
  loadingExperience?: PsiExperience;
  originLoadingExperience?: PsiExperience;
  error?: { code?: number; message?: string };
};
type PsiExperience = { id?: string; overall_category?: string; metrics?: Record<string, { percentile: number; category: string }>; origin_fallback?: boolean };

function readField(exp: PsiExperience | undefined): FieldMetrics | null {
  if (!exp?.metrics || Object.keys(exp.metrics).length === 0) return null;
  const m = exp.metrics;
  const pick = (k: string) => (m[k] ? { percentile: m[k].percentile, category: m[k].category } : undefined);
  return {
    lcp: pick("LARGEST_CONTENTFUL_PAINT_MS"),
    inp: pick("INTERACTION_TO_NEXT_PAINT"),
    cls: pick("CUMULATIVE_LAYOUT_SHIFT_SCORE"),
    fcp: pick("FIRST_CONTENTFUL_PAINT_MS"),
    ttfb: pick("EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
    overall: exp.overall_category,
  };
}

export function parsePsiResponse(url: string, strategy: Strategy, body: PsiResponse): PageSpeedResult {
  const audits = body.lighthouseResult?.audits ?? {};
  const num = (k: string) => (typeof audits[k]?.numericValue === "number" ? Math.round(audits[k].numericValue! * (k === "cumulative-layout-shift" ? 1000 : 1)) / (k === "cumulative-layout-shift" ? 1000 : 1) : null);
  const score = body.lighthouseResult?.categories?.performance?.score;
  const urlField = body.loadingExperience && !body.loadingExperience.origin_fallback ? readField(body.loadingExperience) : null;
  const originField = readField(body.originLoadingExperience);
  return {
    url,
    strategy,
    lab: {
      performanceScore: typeof score === "number" ? Math.round(score * 100) : null,
      lcpMs: num("largest-contentful-paint"),
      fcpMs: num("first-contentful-paint"),
      tbtMs: num("total-blocking-time"),
      cls: num("cumulative-layout-shift"),
      speedIndexMs: num("speed-index"),
    },
    field: urlField ?? originField,
    fieldScope: urlField ? "URL" : originField ? "ORIGIN" : "NONE",
    lighthouseVersion: body.lighthouseResult?.lighthouseVersion ?? null,
    fetchedAt: new Date(),
  };
}

export async function runPageSpeed(url: string, strategy: Strategy, fetchImpl: typeof fetch = fetch, apiKey: string | null = process.env.PAGESPEED_API_KEY ?? null): Promise<PageSpeedResult> {
  const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  api.searchParams.set("url", url);
  api.searchParams.set("strategy", strategy.toLowerCase());
  api.searchParams.set("category", "performance");
  const headers: Record<string, string> = {};
  if (apiKey) headers["x-goog-api-key"] = apiKey;
  let res: Response;
  try {
    res = await fetchImpl(api, { headers, signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    throw new PageSpeedError(`Could not reach PageSpeed Insights: ${(e as Error).message}`, "NETWORK");
  }
  const body = (await res.json().catch(() => ({}))) as PsiResponse;
  if (res.status === 429) throw new PageSpeedError("PageSpeed Insights quota reached. Try again later, or add a free PAGESPEED_API_KEY.", "QUOTA");
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    if (/unable to resolve|failed_document_request|errored_document_request|NO_FCP|not reachable/i.test(msg)) throw new PageSpeedError(`Google could not load the page: ${msg.slice(0, 200)}`, "UNREACHABLE");
    throw new PageSpeedError(`PageSpeed Insights error: ${msg.slice(0, 200)}`, "HTTP");
  }
  return parsePsiResponse(url, strategy, body);
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

/** Turns a test into at most one honest finding draft (or none when everything passes). */
export function performanceFinding(r: PageSpeedResult) {
  const device = r.strategy === "MOBILE" ? "mobile" : "desktop";
  if (r.field) {
    const failing = (["lcp", "inp", "cls"] as const).filter((k) => r.field![k] && r.field![k]!.category !== "FAST");
    if (failing.length === 0) return null;
    const label = { lcp: "Largest Contentful Paint", inp: "Interaction to Next Paint", cls: "Cumulative Layout Shift" };
    const value = (k: "lcp" | "inp" | "cls") => (k === "cls" ? (r.field![k]!.percentile / 100).toFixed(2) : fmtMs(r.field![k]!.percentile));
    const slow = failing.some((k) => r.field![k]!.category === "SLOW");
    return {
      ruleId: `perf.field-cwv-${device}`,
      category: "Technical SEO",
      title: `Core Web Vitals need improvement for real ${device} visitors`,
      severity: slow ? "HIGH" : "MEDIUM",
      evidenceStatus: "CONFIRMED",
      observedFacts: `Chrome UX Report data (${r.fieldScope === "URL" ? "this page" : "whole site"}, 75th percentile, last 28 days, ${device}): ${failing
        .map((k) => `${label[k]} ${value(k)} (${r.field![k]!.category.toLowerCase().replace("average", "needs improvement")})`)
        .join("; ")}.`,
      businessImpact: "These are measurements from real visitors. Slow loading or unstable pages lose visitors and Core Web Vitals are part of Google's page experience signals.",
      recommendation: "Investigate the largest elements, render-blocking resources, image sizes and third-party scripts; re-measure in PageSpeed Insights after changes (field data updates over 28 days).",
      verificationMethod: "PageSpeed Insights / Search Console Core Web Vitals report after 28 days.",
      confidence: "HIGH",
      measurement: { source: "Chrome UX Report via PageSpeed Insights", scope: r.fieldScope, device, field: r.field },
    } as const;
  }
  const score = r.lab.performanceScore;
  if (score == null || score >= 50) return null;
  return {
    ruleId: `perf.lab-${device}`,
    category: "Technical SEO",
    title: `Low ${device} performance score in a lab test`,
    severity: "NEEDS_VERIFICATION",
    evidenceStatus: "POTENTIAL",
    observedFacts: `Lighthouse ${r.lighthouseVersion ?? ""} lab test (${device}, simulated throttling) scored ${score}/100: LCP ${r.lab.lcpMs != null ? fmtMs(r.lab.lcpMs) : "—"}, TBT ${r.lab.tbtMs != null ? fmtMs(r.lab.tbtMs) : "—"}, CLS ${r.lab.cls ?? "—"}. No real-user (field) data is available for this site.`,
    businessImpact: "A lab test simulates one load on a slow device; it points to likely problems but is not a measurement of real visitors.",
    recommendation: "Review the PageSpeed Insights diagnostics (images, scripts, server response) and re-test; prioritise fixes that improve LCP.",
    verificationMethod: "Repeat the PageSpeed test several times; add real-user monitoring if needed.",
    confidence: "MEDIUM",
    measurement: { source: "Lighthouse lab via PageSpeed Insights", device, lab: r.lab },
  } as const;
}
