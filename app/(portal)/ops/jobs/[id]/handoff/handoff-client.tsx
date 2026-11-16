"use client";

import { type MouseEvent, useId, useRef, useState } from "react";

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

function extractJson(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").join("\n");
  }

  return typeof value === "string" ? value : "";
}

function setFormValue(form: HTMLFormElement, name: string, value: string) {
  const field = form.elements.namedItem(name);
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
  ) {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function parsedResult(rawText: string) {
  const jsonText = extractJson(rawText);
  if (!jsonText) return null;
  const parsed = JSON.parse(jsonText) as unknown;
  return asObject(parsed);
}

export function PacketCopyPanel({ packetText }: { packetText: string }) {
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState("Ready to copy");

  async function copyPacket() {
    try {
      await navigator.clipboard.writeText(packetText);
      setStatus("Copied");
    } catch {
      textareaRef.current?.select();
      document.execCommand("copy");
      setStatus("Copied");
    }
  }

  return (
    <>
      <div className="review-actions">
        <button className="button primary" onClick={copyPacket} type="button">
          Copy packet
        </button>
        <span className="source-note inline">{status}</span>
      </div>
      <div className="field">
        <label htmlFor={textareaId}>Copy into the client Claude project</label>
        <textarea
          className="packet-textarea"
          id={textareaId}
          readOnly
          ref={textareaRef}
          rows={26}
          value={packetText}
        />
      </div>
    </>
  );
}

export function CompletionPasteParser() {
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState("Optional: paste Claude JSON, then parse.");

  function parseIntoForm(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.closest("form");
    if (!form) return;

    try {
      const result = parsedResult(textareaRef.current?.value || raw);
      if (!result) {
        setStatus("Paste Claude JSON first.");
        return;
      }

      const nestedResult = asObject(result.result);
      setFormValue(form, "summary", asString(result.summary));
      setFormValue(
        form,
        "created_pending_change_ids",
        asStringList(result.created_pending_change_ids),
      );
      setFormValue(
        form,
        "created_interaction_ids",
        asStringList(result.created_interaction_ids),
      );
      setFormValue(
        form,
        "outcome",
        asString(nestedResult.outcome) || asString(result.outcome) || "submitted_changes",
      );
      setFormValue(
        form,
        "verification_summary",
        asString(nestedResult.verification_summary) ||
          asString(result.verification_summary),
      );
      setFormValue(
        form,
        "follow_up_needed",
        asString(nestedResult.follow_up_needed) || asString(result.follow_up_needed),
      );
      setFormValue(
        form,
        "command_output",
        asString(nestedResult.command_output) || asString(result.command_output),
      );
      setStatus("Parsed into completion fields.");
    } catch {
      setStatus("That JSON could not be parsed.");
    }
  }

  return (
    <div className="handoff-parser">
      <div className="field">
        <label htmlFor={textareaId}>Paste Claude success JSON</label>
        <textarea
          id={textareaId}
          onChange={(event) => setRaw(event.target.value)}
          placeholder='{"summary":"Reviewed context...","created_pending_change_ids":["..."],"created_interaction_ids":[],"result":{"outcome":"submitted_changes"}}'
          ref={textareaRef}
          value={raw}
        />
      </div>
      <div className="review-actions">
        <button className="button ghost" onClick={parseIntoForm} type="button">
          Parse success JSON
        </button>
        <span className="source-note inline">{status}</span>
      </div>
    </div>
  );
}

export function FailurePasteParser() {
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState("Optional: paste Claude blocked JSON, then parse.");

  function parseIntoForm(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.closest("form");
    if (!form) return;

    try {
      const result = parsedResult(textareaRef.current?.value || raw);
      if (!result) {
        setStatus("Paste Claude JSON first.");
        return;
      }

      const nestedResult = asObject(result.result);
      setFormValue(form, "error", asString(result.error));
      setFormValue(
        form,
        "blocked_on",
        asString(nestedResult.blocked_on) || asString(result.blocked_on),
      );
      setFormValue(
        form,
        "retry_after_seconds",
        String(result.retry_after_seconds ?? 3600),
      );
      setFormValue(
        form,
        "suggested_next_step",
        asString(nestedResult.suggested_next_step) ||
          asString(result.suggested_next_step),
      );

      const terminalField = form.elements.namedItem("terminal");
      if (terminalField instanceof HTMLInputElement) {
        terminalField.checked = result.terminal === true;
      }

      setStatus("Parsed into blocked fields.");
    } catch {
      setStatus("That JSON could not be parsed.");
    }
  }

  return (
    <div className="handoff-parser">
      <div className="field">
        <label htmlFor={textareaId}>Paste Claude blocked JSON</label>
        <textarea
          id={textareaId}
          onChange={(event) => setRaw(event.target.value)}
          placeholder='{"error":"Owner verification is needed.","retry_after_seconds":3600,"terminal":false,"result":{"blocked_on":"owner_verification"}}'
          ref={textareaRef}
          value={raw}
        />
      </div>
      <div className="review-actions">
        <button className="button ghost" onClick={parseIntoForm} type="button">
          Parse blocked JSON
        </button>
        <span className="source-note inline">{status}</span>
      </div>
    </div>
  );
}
