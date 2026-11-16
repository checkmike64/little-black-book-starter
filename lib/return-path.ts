export function safeReturnPath(
  value: FormDataEntryValue | null | undefined,
  fallback: string,
) {
  const raw = String(value ?? fallback);
  if (
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(raw)
  ) {
    return fallback;
  }

  try {
    const base = "https://little-black-book.local";
    const url = new URL(raw, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export function pathWithMessage(path: string, message: string) {
  const url = new URL(path, "https://little-black-book.local");
  url.searchParams.delete("message");
  url.searchParams.set("message", message);

  return `${url.pathname}${url.search}${url.hash}`;
}
