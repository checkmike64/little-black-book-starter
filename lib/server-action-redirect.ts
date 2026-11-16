import { redirect } from "next/navigation";
import { pathWithMessage, safeReturnPath } from "@/lib/return-path";

export { safeReturnPath };

export function safeFormReturnPath(formData: FormData, fallback: string) {
  return safeReturnPath(formData.get("return_to"), fallback);
}

export function redirectWithMessage(path: string, message: string): never {
  redirect(pathWithMessage(path, message));
}

export function redirectToFormReturn(
  formData: FormData,
  fallback: string,
  message: string,
): never {
  redirectWithMessage(safeFormReturnPath(formData, fallback), message);
}
