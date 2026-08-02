/**
 * Channel + language selection — 12 T-4 (FR-8). PURE.
 *
 * Deterministic: try each candidate channel in preference order (the guest's
 * opted-in preferred channel first, then the remaining configured channels).
 * For the chosen channel, prefer the requested language; fall back to `en` when
 * that language's template is absent. Returns the first (channel, language) for
 * which a template actually exists, or null when none does.
 */
import type { Channel } from "@prisma/client";

export type AvailableTemplate = { channel: Channel; language: string };

export type ChannelLanguage = { channel: Channel; language: string };

const DEFAULT_LANGUAGE = "en";

export function selectChannelAndLanguage(
  candidates: readonly Channel[],
  requestedLanguage: string,
  available: readonly AvailableTemplate[],
): ChannelLanguage | null {
  for (const ch of candidates) {
    const forChannel = available.filter((t) => t.channel === ch);
    if (forChannel.length === 0) continue;
    if (forChannel.some((t) => t.language === requestedLanguage)) {
      return { channel: ch, language: requestedLanguage };
    }
    if (forChannel.some((t) => t.language === DEFAULT_LANGUAGE)) {
      return { channel: ch, language: DEFAULT_LANGUAGE };
    }
  }
  return null;
}

/**
 * Build the candidate channel order: the guest's preferred channel (if any)
 * first, then the rest of the configured channels, de-duplicated.
 */
export function candidateChannels(
  preferred: Channel | null | undefined,
  configured: readonly Channel[],
): Channel[] {
  const seen = new Set<Channel>();
  const out: Channel[] = [];
  for (const ch of [preferred, ...configured]) {
    if (ch && !seen.has(ch)) {
      seen.add(ch);
      out.push(ch);
    }
  }
  return out;
}
