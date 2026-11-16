import { redirect } from "next/navigation";

type AskRunRedirectPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AskRunRedirectPage({ params }: AskRunRedirectPageProps) {
  const { id } = await params;
  redirect(`/ask?run=${encodeURIComponent(id)}`);
}
