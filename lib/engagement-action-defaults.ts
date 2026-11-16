import type { EngagementCandidate } from "./engagement-candidates.js";
import type { WeeklyEngagementCandidate } from "./engagement-weekly-plan.js";
import type { RelationshipCommandIntent } from "./relationship-command.js";

export type EngagementActionDefaults = {
  actionKind: "log_touch" | "use_opportunity";
  actionType:
    | "claude_draft"
    | "follow_up"
    | "introduction"
    | "podcast"
    | "promise"
    | "reconnect"
    | "referral";
  commandIntent: RelationshipCommandIntent;
  defaultPriority: "high" | "normal" | "low";
  assistTitle: string;
  summary: string;
  touchLabel: string;
};

type EngagementActionCandidate = WeeklyEngagementCandidate &
  Partial<Pick<EngagementCandidate, "current_asks" | "ideal_referral" | "podcast_fit">>;

function includesAny(value: string, pattern: RegExp) {
  return pattern.test(value.toLowerCase());
}

export function engagementActionDefaults(
  candidate: EngagementActionCandidate,
): EngagementActionDefaults {
  const context = [
    candidate.nextAction,
    candidate.risk,
    candidate.why,
    candidate.current_asks,
    candidate.ideal_referral,
    candidate.podcast_fit,
  ]
    .filter(Boolean)
    .join(" ");

  if (candidate.rung === "Follow through") {
    return {
      actionKind: "log_touch",
      actionType: "promise",
      commandIntent: "draft_outreach",
      defaultPriority: "high",
      assistTitle: "Prepare follow-through",
      summary: `Weekly engagement follow-through: ${candidate.nextAction}`,
      touchLabel: "Log follow-through",
    };
  }

  if (includesAny(context, /intro|introduction|referral|buyer|investor|partner/)) {
    return {
      actionKind: "use_opportunity",
      actionType: "referral",
      commandIntent: "verify_referral_lane",
      defaultPriority: "high",
      assistTitle: "Prepare referral path",
      summary: `Weekly engagement opportunity: ${candidate.nextAction}`,
      touchLabel: "Log useful touch",
    };
  }

  if (includesAny(context, /podcast|guest|show|interview/)) {
    return {
      actionKind: "use_opportunity",
      actionType: "podcast",
      commandIntent: "draft_outreach",
      defaultPriority: "high",
      assistTitle: "Prepare podcast outreach",
      summary: `Weekly podcast engagement: ${candidate.nextAction}`,
      touchLabel: "Log outreach touch",
    };
  }

  if (candidate.risk === "Cooling relationship" || candidate.priority === "P3") {
    return {
      actionKind: "log_touch",
      actionType: "reconnect",
      commandIntent: "draft_outreach",
      defaultPriority: "normal",
      assistTitle: "Prepare rewarm note",
      summary: `Weekly rewarm touch: ${candidate.nextAction}`,
      touchLabel: "Log rewarm",
    };
  }

  return {
    actionKind: candidate.rung === "Be useful" ? "use_opportunity" : "log_touch",
    actionType: candidate.rung === "Be useful" ? "follow_up" : "claude_draft",
    commandIntent: candidate.rung === "Be useful" ? "draft_outreach" : "prep_for_call",
    defaultPriority: candidate.priority === "P4" ? "low" : "normal",
    assistTitle: "Prepare touch",
    summary: `Weekly engagement touch: ${candidate.nextAction}`,
    touchLabel: "Log touch",
  };
}
