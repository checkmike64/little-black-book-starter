import { revalidatePath } from "next/cache";

export function revalidateRelationshipWorkspace(
  contactIds: Array<string | null | undefined> = [],
) {
  revalidatePath("/dashboard");
  revalidatePath("/networking");
  revalidatePath("/engagement");
  revalidatePath("/ask");
  revalidatePath("/contacts");

  contactIds.filter(Boolean).forEach((contactId) => {
    revalidatePath(`/contacts/${contactId}`);
  });
}

export function revalidateContactRelationshipSurfaces(
  contactId: string,
  options: { includeAsk?: boolean; includeOps?: boolean; includeEngagement?: boolean } = {},
) {
  revalidatePath("/dashboard");
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);

  if (options.includeEngagement !== false) revalidatePath("/engagement");
  if (options.includeAsk) revalidatePath("/ask");
  if (options.includeOps) revalidatePath("/ops");
}
