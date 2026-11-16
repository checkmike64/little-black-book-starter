export type ConversationInteractionInput = {
  id: string;
  occurred_at: string;
  interaction_type: string;
  title: string | null;
  summary: string | null;
  source: string;
  source_ref: string | null;
  metadata: Record<string, unknown>;
};

export type ConversationTranscriptInput = {
  id: string;
  interaction_id: string | null;
  title: string | null;
  source: string | null;
  source_ref: string | null;
  distilled_summary: string | null;
  action_items?: Array<{
    text?: string;
    assignee?: string | null;
    assignee_email?: string | null;
    contact_id?: string | null;
    owner_assigned?: boolean;
  }>;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ConversationPromiseInput = {
  id: string;
  interaction_id: string | null;
  promise_text: string;
  direction: string;
  status: string;
  due_on: string | null;
  source: string | null;
  evidence: Record<string, unknown>;
};

export type ConversationActionInput = {
  id: string;
  title: string;
  action_type: string;
  status: string;
  due_on: string | null;
  notes: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
};

export type ContactConversation = {
  id: string;
  occurredAt: string;
  interactionType: string;
  title: string;
  summary: string | null;
  source: string;
  sourceRef: string | null;
  transcripts: ConversationTranscriptInput[];
  promises: ConversationPromiseInput[];
  actions: ConversationActionInput[];
  storedInterpretation: string[];
  topics: string[];
  provenance: string[];
};

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function textList(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.flatMap((item) => textList(item));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [
    record.text,
    record.title,
    record.summary,
    record.description,
    record.action,
    record.promise,
  ].flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []));
}

function metadataLists(metadata: Record<string, unknown>, keys: string[]) {
  return unique(keys.flatMap((key) => textList(metadata[key])));
}

function actionInteractionId(action: ConversationActionInput) {
  const values = [
    action.metadata.interaction_id,
    action.metadata.source_interaction_id,
    action.metadata.source_ref,
  ];
  return values.find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
}

function sourceProvenance(
  interaction: ConversationInteractionInput,
  transcripts: ConversationTranscriptInput[],
  promises: ConversationPromiseInput[],
  actions: ConversationActionInput[],
) {
  const rows = [`Interaction source: ${interaction.source.replaceAll("_", " ")}`];
  if (interaction.source_ref) rows.push(`Source reference: ${interaction.source_ref}`);
  transcripts.forEach((transcript) => {
    rows.push(`Conversation summary: ${(transcript.source ?? "transcript").replaceAll("_", " ")}`);
  });
  promises.forEach((promise) => {
    rows.push(`Commitment extraction: ${(promise.source ?? "stored promise").replaceAll("_", " ")}`);
  });
  actions.forEach((action) => {
    rows.push(`Follow-up source: ${(action.source ?? "tracked action").replaceAll("_", " ")}`);
  });
  return unique(rows);
}

export function buildContactConversations({
  actions,
  interactions,
  promises,
  transcripts,
}: {
  actions: ConversationActionInput[];
  interactions: ConversationInteractionInput[];
  promises: ConversationPromiseInput[];
  transcripts: ConversationTranscriptInput[];
}): ContactConversation[] {
  return interactions
    .map((interaction) => {
      const linkedTranscripts = transcripts.filter(
        (transcript) => transcript.interaction_id === interaction.id,
      );
      const linkedPromises = promises.filter(
        (promise) => promise.interaction_id === interaction.id,
      );
      const linkedActions = actions.filter(
        (action) => actionInteractionId(action) === interaction.id,
      );
      const metadataSources = [
        interaction.metadata,
        ...linkedTranscripts.map((transcript) => transcript.metadata),
      ];
      const storedInterpretation = unique(
        [
          ...linkedTranscripts.flatMap((transcript) => textList(transcript.action_items ?? [])),
          ...metadataSources.flatMap((metadata) =>
            metadataLists(metadata, [
            "interpretation",
            "relationship_interpretation",
            "key_takeaways",
            "decisions",
            "next_steps",
            "action_items",
            "follow_ups",
            ]),
          ),
        ],
      );
      const topics = unique(
        metadataSources.flatMap((metadata) =>
          metadataLists(metadata, ["topics", "keywords", "themes"]),
        ),
      );

      return {
        id: interaction.id,
        occurredAt: interaction.occurred_at,
        interactionType: interaction.interaction_type,
        title: interaction.title ?? interaction.interaction_type.replaceAll("_", " "),
        summary: interaction.summary,
        source: interaction.source,
        sourceRef: interaction.source_ref,
        transcripts: linkedTranscripts,
        promises: linkedPromises,
        actions: linkedActions,
        storedInterpretation,
        topics,
        provenance: sourceProvenance(
          interaction,
          linkedTranscripts,
          linkedPromises,
          linkedActions,
        ),
      };
    })
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
}
