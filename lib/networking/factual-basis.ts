type ConnectionContact = {
  full_name: string | null;
  company_name: string | null;
  company_description: string | null;
  role_title: string[] | null;
  one_line_summary: string | null;
  current_asks: string | null;
  wants_help_with: string | null;
  what_they_want_more_of: string | null;
  ideal_referral: string | null;
  podcast_fit: string | null;
  podcast_url: string | null;
  services_offered: string[] | null;
  could_refer_me_for: string[] | null;
};

function firstText(...values: Array<string | string[] | null | undefined>) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const item = value.find((candidate) => candidate.trim());
      if (item) return item.trim();
    } else if (value?.trim()) {
      return value.trim();
    }
  }
  return null;
}

function concise(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > maxLength * 0.7 ? lastSpace : maxLength).trim()}…`;
}

export function networkingProfileBasis(
  contactA: ConnectionContact | null | undefined,
  contactB: ConnectionContact | null | undefined,
) {
  const aName = contactA?.full_name?.trim() || "Person A";
  const bName = contactB?.full_name?.trim() || "Person B";
  const aNeed = firstText(
    contactA?.current_asks,
    contactA?.wants_help_with,
    contactA?.ideal_referral,
  );
  const bNeed = firstText(
    contactB?.current_asks,
    contactB?.wants_help_with,
    contactB?.ideal_referral,
  );
  const aOffer = firstText(
    contactA?.services_offered,
    contactA?.could_refer_me_for,
  );
  const bOffer = firstText(
    contactB?.services_offered,
    contactB?.could_refer_me_for,
  );
  const aPodcastNeed = firstText(
    contactA?.podcast_fit,
    contactA?.current_asks,
    contactA?.wants_help_with,
    contactA?.what_they_want_more_of,
    contactA?.ideal_referral,
  );
  const bPodcastNeed = firstText(
    contactB?.podcast_fit,
    contactB?.current_asks,
    contactB?.wants_help_with,
    contactB?.what_they_want_more_of,
    contactB?.ideal_referral,
  );
  const aPodcastProfile = firstText(
    contactA?.one_line_summary,
    contactA?.company_description,
    contactA?.role_title,
    contactA?.company_name,
  );
  const bPodcastProfile = firstText(
    contactB?.one_line_summary,
    contactB?.company_description,
    contactB?.role_title,
    contactB?.company_name,
  );
  const aHasPodcastSource = Boolean(
    contactA?.podcast_url?.trim()
      || /\b(?:podcast|show|host|interview)\b/i.test(aPodcastProfile ?? ""),
  );
  const bHasPodcastSource = Boolean(
    contactB?.podcast_url?.trim()
      || /\b(?:podcast|show|host|interview)\b/i.test(bPodcastProfile ?? ""),
  );

  if (aPodcastNeed && /\bpodcast\b/i.test(aPodcastNeed) && bHasPodcastSource) {
    const providerFact = bPodcastProfile
      ? `saved profile: ${bPodcastProfile}`
      : "a podcast link is saved in the profile";
    return concise(`${aName} — podcast context: ${aPodcastNeed}. ${bName} — ${providerFact}.`);
  }
  if (bPodcastNeed && /\bpodcast\b/i.test(bPodcastNeed) && aHasPodcastSource) {
    const providerFact = aPodcastProfile
      ? `saved profile: ${aPodcastProfile}`
      : "a podcast link is saved in the profile";
    return concise(`${bName} — podcast context: ${bPodcastNeed}. ${aName} — ${providerFact}.`);
  }

  if (aNeed && bOffer) {
    return concise(`${aName} — looking for: ${aNeed}. ${bName} — offers: ${bOffer}.`);
  }
  if (bNeed && aOffer) {
    return concise(`${bName} — looking for: ${bNeed}. ${aName} — offers: ${aOffer}.`);
  }

  return "No supporting profile facts are stored for this pair. Review both profiles before approving.";
}
