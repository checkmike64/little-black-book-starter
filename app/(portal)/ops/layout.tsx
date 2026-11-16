import { requireOperatorAccess } from "@/lib/operator-access";
import type React from "react";

export default async function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOperatorAccess();

  return children;
}
