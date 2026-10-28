import "server-only";
import { z } from "zod";
import { getApiKey } from "../integrations";
import { AiError, getAiProvider, type AiProvider } from "../ai/provider";
import { ProposalError, getProposalWithVersion, saveProposalVersion, versionPayloadSchema } from "./service";
import type { Deliverable, ProposalFinding, RoadmapPhase } from "./types";

/**
 * Translates a proposal into the client's language with Gemini and saves it as a new version, so
 * the English version stays untouched. Only wording is translated: business names, website
 * addresses, numbers, prices, keywords and audit evidence stay exactly as they are.
 */

export const TRANSLATION_LANGUAGES = { ur: "Urdu", ar: "Arabic" } as const;
export type TranslationLanguage = keyof typeof TRANSLATION_LANGUAGES;

type Entry = { id: string; text: string };
const CHUNK_CHARS = 6000;

const outputSchema = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) });

function systemPrompt(language: string) {
  return [
    `You translate an SEO services proposal from English into ${language} for a local business owner.`,
    `Write natural, warm, professional ${language} that a business owner reads easily — not word-for-word, not overly formal.`,
    "Keep unchanged: business and brand names, website addresses and URLs, email addresses, phone numbers, prices, currency codes, percentages and other numbers, and search keywords in quotes.",
    "Common SEO terms (SEO, Google Business Profile, Google Maps, backlinks, keywords) may stay in English where a business owner would say them that way.",
    "Keep the same line breaks, bullet markers (- or •) and **bold** markers. Do not add or remove information.",
    "Return every id you were given, each with its translated text.",
  ].join("\n");
}

function chunks(entries: Entry[]) {
  const out: Entry[][] = [];
  let cur: Entry[] = [];
  let size = 0;
  for (const e of entries) {
    if (cur.length && size + e.text.length > CHUNK_CHARS) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(e);
    size += e.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function translateProposal(workspaceId: string, userId: string, proposalId: string, language: TranslationLanguage, providerOverride?: AiProvider) {
  const name = TRANSLATION_LANGUAGES[language];
  if (!name) throw new ProposalError("Choose Urdu or Arabic.");
  const provider = providerOverride ?? getAiProvider(await getApiKey(workspaceId, "GEMINI"));
  if (!provider) throw new ProposalError("Translation uses Gemini (free). Add your Gemini key on the Integrations page first.");
  const loaded = await getProposalWithVersion(workspaceId, proposalId);
  if (!loaded) throw new ProposalError("Proposal not found.");
  const { proposal, version } = loaded;

  // Every piece of wording gets an id; translated text is put back by id, so nothing can shift places.
  const entries: Entry[] = [];
  const add = (id: string, text: string | null | undefined) => {
    if (text && /[A-Za-z]{2}/.test(text)) entries.push({ id, text });
  };
  add("title", version.title ?? proposal.title);
  add("paymentTerms", version.paymentTerms);
  add("clientNotes", version.clientNotes);
  const deliverables = (version.deliverables as Deliverable[] | null) ?? [];
  deliverables.forEach((d, i) => {
    add(`d${i}.title`, d.title);
    add(`d${i}.detail`, d.detail);
  });
  version.sections.forEach((s, si) => {
    add(`s${si}.title`, s.title);
    add(`s${si}.body`, s.body);
    const data = (s.data ?? {}) as { findings?: ProposalFinding[]; phases?: RoadmapPhase[] };
    data.findings?.forEach((f, fi) => {
      for (const k of ["title", "observed", "whyItMatters", "solution", "period", "verification"] as const) add(`s${si}.f${fi}.${k}`, f[k]);
    });
    data.phases?.forEach((p, pi) => {
      add(`s${si}.p${pi}.title`, p.title);
      add(`s${si}.p${pi}.period`, p.period);
      p.items.forEach((item, ii) => add(`s${si}.p${pi}.i${ii}`, item));
    });
  });

  const done = new Map<string, string>();
  try {
    for (const part of chunks(entries)) {
      const res = await provider.generateJson({
        system: systemPrompt(name),
        prompt: `Translate each "text" into ${name}. Keep each "id" unchanged.\n\n${JSON.stringify({ items: part })}`,
        schema: outputSchema,
        maxOutputTokens: 16384,
      });
      const ids = new Set(part.map((e) => e.id));
      for (const it of res.items) if (ids.has(it.id) && it.text.trim()) done.set(it.id, it.text.trim());
    }
  } catch (e) {
    if (e instanceof AiError) throw new ProposalError(`Translation failed: ${e.message}`);
    throw e;
  }
  if (done.size < entries.length * 0.8) throw new ProposalError("Gemini returned an incomplete translation. Please try again.");
  const t = (id: string, text: string) => done.get(id) ?? text;

  const parsed = versionPayloadSchema.safeParse({
    title: t("title", version.title ?? proposal.title),
    proposalDate: version.proposalDate,
    validUntil: version.validUntil,
    currency: version.currency,
    monthlyPrice: version.monthlyPrice,
    setupFee: version.setupFee,
    durationMonths: version.durationMonths,
    paymentTerms: version.paymentTerms ? t("paymentTerms", version.paymentTerms) : null,
    roadmap: version.roadmap,
    theme: version.theme,
    services: version.services ?? [],
    deliverables: deliverables.map((d, i) => ({ title: t(`d${i}.title`, d.title), detail: t(`d${i}.detail`, d.detail) })),
    clientNotes: version.clientNotes ? t("clientNotes", version.clientNotes) : null,
    includeAppendix: version.includeAppendix,
    changeNote: `Translated to ${name} from v${version.version}`,
    sections: version.sections
      .filter((s) => s.key !== "pricing")
      .map((s) => {
        const si = version.sections.indexOf(s);
        const data = s.data as { findings?: ProposalFinding[]; phases?: RoadmapPhase[] } | null;
        return {
          key: s.key,
          title: t(`s${si}.title`, s.title),
          body: t(`s${si}.body`, s.body),
          included: s.included,
          data: data
            ? {
                ...data,
                ...(data.findings && {
                  findings: data.findings.map((f, fi) => ({
                    ...f,
                    title: t(`s${si}.f${fi}.title`, f.title),
                    observed: t(`s${si}.f${fi}.observed`, f.observed),
                    whyItMatters: t(`s${si}.f${fi}.whyItMatters`, f.whyItMatters),
                    solution: t(`s${si}.f${fi}.solution`, f.solution),
                    period: t(`s${si}.f${fi}.period`, f.period),
                    verification: t(`s${si}.f${fi}.verification`, f.verification),
                  })),
                }),
                ...(data.phases && {
                  phases: data.phases.map((p, pi) => ({ title: t(`s${si}.p${pi}.title`, p.title), period: t(`s${si}.p${pi}.period`, p.period), items: p.items.map((item, ii) => t(`s${si}.p${pi}.i${ii}`, item)) })),
                }),
              }
            : null,
        };
      }),
  });
  if (!parsed.success) throw new ProposalError(`The translation of “${parsed.error.issues[0].path.join(" › ")}” came back too long. Shorten that part in English and translate again.`);
  return saveProposalVersion(workspaceId, userId, proposalId, version.version, parsed.data, true);
}
