export type LoginMessageTone = "error" | "status";

export type LoginMessage = {
  text: string;
  tone: LoginMessageTone;
};

export function authErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
    return "Too many sign-in emails were requested. Please wait a few minutes, then request one fresh link.";
  }

  if (
    normalized.includes("expired") ||
    normalized.includes("invalid") ||
    normalized.includes("otp") ||
    normalized.includes("token")
  ) {
    return "That sign-in link or code is no longer valid. Please request a fresh one in this browser.";
  }

  return "Sign-in could not be completed. Please request a fresh link and try again.";
}

export function loginMessageFor(code?: string): LoginMessage | null {
  if (!code) return null;
  if (code === "check-email") {
    return {
      text: "Check your email for the private sign-in link or code.",
      tone: "status",
    };
  }
  if (code === "missing-env") {
    return {
      text: "This private workspace is not connected yet.",
      tone: "error",
    };
  }

  return { text: code, tone: "error" };
}

export function loginPathWithMessage(message: string, next: string) {
  const params = new URLSearchParams({ message, next });
  return `/login?${params.toString()}`;
}
