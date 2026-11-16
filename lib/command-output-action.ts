type CommandOutputActionInput = {
  commandIntent?: string | null;
  commandLabel?: string | null;
  contactName?: string | null;
  commandOutput?: string | null;
  verificationSummary?: string | null;
  followUpNeeded?: string | null;
};

export type CommandOutputActionType =
  | "claude_draft"
  | "follow_up"
  | "introduction"
  | "referral";

export type CommandOutputActionPriority = "high" | "normal";

function cleanText(value: string | null | undefined, maxLength: number) {
  const clean = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  return clean || null;
}

function firstSentence(value: string | null | undefined, maxLength = 140) {
  const clean = cleanText(value, maxLength);
  if (!clean) return null;
  const sentence = clean.match(/^[^.!?]+[.!?]/)?.[0] ?? clean;
  return sentence.slice(0, maxLength).trim();
}

export function commandOutputActionType(
  intent: string | null | undefined,
): CommandOutputActionType {
  if (intent === "verify_referral_lane") return "referral";
  if (intent === "build_intro_map") return "introduction";
  if (intent === "prep_for_call") return "follow_up";
  if (intent === "draft_outreach") return "claude_draft";
  return "claude_draft";
}

export function commandOutputActionPriority({
  commandOutput,
  followUpNeeded,
  verificationSummary,
}: Pick<
  CommandOutputActionInput,
  "commandOutput" | "followUpNeeded" | "verificationSummary"
>): CommandOutputActionPriority {
  const text = [commandOutput, followUpNeeded, verificationSummary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/verify|confirm|owner|risk|guardrail|before sending|before outreach/.test(text)) {
    return "high";
  }

  return "normal";
}

export function commandOutputActionTitle({
  commandIntent,
  commandLabel,
  contactName,
  commandOutput,
  followUpNeeded,
}: CommandOutputActionInput) {
  const nextStep = firstSentence(followUpNeeded) ?? firstSentence(commandOutput);
  if (nextStep) return nextStep;

  const label = cleanText(commandLabel, 80) ?? "Claude command";
  if (commandIntent === "verify_referral_lane") {
    return contactName ? `Review referral lane for ${contactName}` : "Review referral lane";
  }
  if (commandIntent === "build_intro_map") {
    return contactName ? `Review intro map for ${contactName}` : "Review intro map";
  }
  if (commandIntent === "prep_for_call") {
    return contactName ? `Use call prep for ${contactName}` : "Use call prep";
  }

  return contactName ? `${label} for ${contactName}` : label;
}

export function commandOutputActionNotes({
  commandOutput,
  verificationSummary,
  followUpNeeded,
}: CommandOutputActionInput) {
  return [
    cleanText(commandOutput, 900),
    verificationSummary ? `Verification: ${cleanText(verificationSummary, 220)}` : null,
    followUpNeeded ? `Follow-up: ${cleanText(followUpNeeded, 220)}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 1200);
}

export function commandOutputActionRecommendation(input: CommandOutputActionInput) {
  return {
    title: commandOutputActionTitle(input),
    actionType: commandOutputActionType(input.commandIntent),
    priority: commandOutputActionPriority(input),
    notes: commandOutputActionNotes(input),
  };
}
