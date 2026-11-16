type FathomWebhook = {
  id: string;
  secret: string;
};

function clean(value: unknown, limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

async function fathomRequest(
  path: string,
  apiKey: string,
  init: RequestInit,
  acceptableStatuses: number[] = [],
) {
  const response = await fetch(`https://api.fathom.ai/external/v1${path}`, {
    ...init,
    headers: {
      "X-Api-Key": apiKey,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok && !acceptableStatuses.includes(response.status)) {
    throw new Error(`Fathom webhook request failed (${response.status}).`);
  }
  return response;
}

export async function createFathomWebhook({
  apiKey,
  destinationUrl,
}: {
  apiKey: string;
  destinationUrl: string;
}): Promise<FathomWebhook> {
  const response = await fathomRequest("/webhooks", apiKey, {
    method: "POST",
    body: JSON.stringify({
      destination_url: destinationUrl,
      triggered_for: ["my_recordings"],
      include_transcript: false,
      include_crm_matches: false,
      include_summary: true,
      include_action_items: true,
    }),
  });
  const data = await response.json() as Record<string, unknown>;
  const id = clean(data.id, 240);
  const secret = clean(data.secret, 500);
  if (!id || !secret.startsWith("whsec_")) {
    throw new Error("Fathom did not return a usable webhook credential.");
  }
  return { id, secret };
}

export async function deleteFathomWebhook({
  apiKey,
  webhookId,
}: {
  apiKey: string;
  webhookId: string;
}) {
  await fathomRequest(`/webhooks/${encodeURIComponent(webhookId)}`, apiKey, {
    method: "DELETE",
  }, [404, 410]);
}
