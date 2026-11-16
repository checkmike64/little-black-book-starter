export type ContactNextMoveBrief = {
  askHref: string;
  bestMove: string;
  guardrails: string[];
  status: "Act" | "Verify" | "Rewarm" | "Watch";
};

export type ContactNextMoveAction = {
  action_type: string;
  due_on: string | null;
  id: string;
  priority: string;
  status: string;
  title: string;
};

export type ContactNextMoveRail = {
  detail: string;
  eyebrow: string;
  headline: string;
  mode: "work_tracked" | "save_suggested";
  pressureTestHref: string;
  saveMove: {
    defaultPriority: string;
    defaultTitle: string;
    defaultType: string;
    evidenceSummary: string;
    notes: string;
    source: string;
    sourceLabel: string;
    sourceRef: string;
    title: string;
  } | null;
  trackedAction: ContactNextMoveAction | null;
};

function inferredActionType(brief: ContactNextMoveBrief) {
  const text = brief.bestMove.toLowerCase();

  if (brief.status === "Verify") return "owner_verification";
  if (/promise|close the loop/.test(text)) return "promise";
  if (/intro|introduction|referral/.test(text)) return "referral";
  if (/podcast|outreach|guest|interview/.test(text)) return "podcast";
  if (brief.status === "Rewarm" || /rewarm|reconnect|catch up/.test(text)) {
    return "reconnect";
  }
  return "follow_up";
}

function inferredPriority(brief: ContactNextMoveBrief) {
  if (brief.status === "Act" || brief.status === "Verify") return "high";
  return "normal";
}

export function buildContactNextMoveRail({
  contactId,
  contactName,
  contactRisk,
  contactValue,
  executiveBrief,
  proofState,
  trackedAction,
}: {
  contactId: string;
  contactName: string;
  contactRisk: string;
  contactValue: string;
  executiveBrief: ContactNextMoveBrief;
  proofState: string;
  trackedAction?: ContactNextMoveAction | null;
}): ContactNextMoveRail {
  if (trackedAction) {
    return {
      detail:
        "A move is already tracked for this person. Work or close that loop before creating another one.",
      eyebrow: "Tracked move",
      headline: trackedAction.title,
      mode: "work_tracked",
      pressureTestHref: executiveBrief.askHref,
      saveMove: null,
      trackedAction,
    };
  }

  const evidenceSummary = `${contactValue} · ${contactRisk} · ${proofState}`;

  return {
    detail:
      "No open move is tracked yet. Save the recommended move first, then use Ask if you want more context.",
    eyebrow: "Ready to save",
    headline: executiveBrief.bestMove,
    mode: "save_suggested",
    pressureTestHref: executiveBrief.askHref,
    saveMove: {
      defaultPriority: inferredPriority(executiveBrief),
      defaultTitle: executiveBrief.bestMove,
      defaultType: inferredActionType(executiveBrief),
      evidenceSummary,
      notes: `Saved from contact next-move rail. Guardrail: ${executiveBrief.guardrails[0] ?? "Verify before high-stakes use."}`,
      source: "contact_next_move_rail",
      sourceLabel: "Next move rail",
      sourceRef: `contact:${contactId}:next_move_rail`,
      title: `Save move for ${contactName}`,
    },
    trackedAction: null,
  };
}
