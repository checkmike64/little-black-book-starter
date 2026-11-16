const countryCodes: Record<string, string> = {
  argentina: "AR",
  australia: "AU",
  austria: "AT",
  belgium: "BE",
  brazil: "BR",
  canada: "CA",
  chile: "CL",
  colombia: "CO",
  denmark: "DK",
  finland: "FI",
  france: "FR",
  germany: "DE",
  india: "IN",
  ireland: "IE",
  israel: "IL",
  italy: "IT",
  japan: "JP",
  mexico: "MX",
  netherlands: "NL",
  "new zealand": "NZ",
  norway: "NO",
  portugal: "PT",
  singapore: "SG",
  spain: "ES",
  sweden: "SE",
  switzerland: "CH",
  "united arab emirates": "AE",
  uae: "AE",
  "united kingdom": "GB",
  uk: "GB",
  "united states": "US",
  usa: "US",
};

function flagEmoji(code: string) {
  return String.fromCodePoint(
    ...code.toUpperCase().split("").map((letter) => 127397 + letter.charCodeAt(0)),
  );
}

export function locationWithFlag(locations: string[] | null | undefined) {
  const label = locations?.map((item) => item.trim()).filter(Boolean).join(" · ") ?? "";
  if (!label) return null;

  const normalized = label.toLowerCase();
  const country = Object.entries(countryCodes)
    .sort(([a], [b]) => b.length - a.length)
    .find(([name]) => new RegExp(`(?:^|[,·\\s])${name.replaceAll(" ", "\\s+")}(?:$|[,·])`, "i").test(normalized));

  return {
    flag: country ? flagEmoji(country[1]) : null,
    label,
  };
}
