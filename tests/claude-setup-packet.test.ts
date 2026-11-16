import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  claudeSetupPacketFileName,
  formatClaudeSetupPacket,
  type ClaudeSetupPacketInput,
} from "../lib/claude-setup-packet.js";

function packet(overrides: Partial<ClaudeSetupPacketInput> = {}) {
  return formatClaudeSetupPacket({
    tenantName: "Acme Executive Install",
    generatedAt: "2026-07-20T15:00:00.000Z",
    intakePercent: 80,
    revision: {
      createdAt: "2026-07-20T14:00:00.000Z",
      actionLabel: "Intake profile saved",
      summary: "Network thesis, Prospecting buckets",
    },
    enabledModules: ["Ask", "Want to Know"],
    installBrief: "Install brief body.",
    projectInstructions: "Project instructions body.",
    endpointCheatsheet: "Endpoint contract body.",
    firstRunSequence: [
      {
        label: "Install project instructions",
        detail: "Paste setup packet into Claude.",
        evidence: "Claude can repeat the boundaries.",
      },
      {
        label: "Prove one write and one review",
        detail: "Submit a safe interaction and a pending change.",
        evidence: "Both appear in the app.",
      },
    ],
    intakeTranscriptPrompt: "Intake prompt body.",
    firstContactImportPrompt: "Import prompt body.",
    ownerVerificationPrompt: "Verification prompt body.",
    dailyCloseoutPrompt: "Daily prompt body.",
    weeklyNetworkPrompt: "Weekly prompt body.",
    prospectingResearchPrompt: "Research prompt body.",
    prospectingProposalPrompt: "Proposal prompt body.",
    prospectingVerificationPrompt: "Prospecting verification body.",
    ...overrides,
  });
}

describe("Claude setup packet", () => {
  test("formats a complete operator packet with revision context", () => {
    const body = packet();

    assert.match(body, /Little Black Book Claude Setup Packet/);
    assert.match(body, /Tenant: Acme Executive Install/);
    assert.match(body, /Latest setup revision: Intake profile saved/);
    assert.match(body, /Enabled modules: Ask, Want to Know/);
    assert.match(body, /## Claude Project Instructions/);
    assert.match(body, /## Endpoint Contract/);
    assert.match(body, /## First Operating Pass/);
    assert.match(body, /1\. Install project instructions/);
    assert.match(body, /Evidence: Claude can repeat the boundaries/);
    assert.match(body, /Do not paste Supabase service-role keys into Claude/);
  });

  test("handles empty modules and missing revision conservatively", () => {
    const body = packet({
      revision: null,
      enabledModules: [],
    });

    assert.match(body, /No setup revision has been recorded yet/);
    assert.match(body, /Enabled modules: None/);
  });

  test("creates safe text filenames", () => {
    assert.equal(
      claudeSetupPacketFileName("Alex / Demo Client!"),
      "alex-demo-client-claude-setup-packet.txt",
    );
  });

  test("makes tenant scope and idempotency explicit for Claude", () => {
    const source = readFileSync("lib/claude-setup-package.ts", "utf8");

    assert.match(source, /Never invent tenant_id values/);
    assert.match(source, /idempotency_key/);
    assert.match(source, /Do not invent tenant_id/);
    assert.match(source, /require stable idempotency_key values/);
  });

  test("keeps the first Claude run focused on proof before volume", () => {
    const source = readFileSync("lib/claude-setup-package.ts", "utf8");

    assert.match(source, /buildClaudeFirstRunSequence/);
    assert.match(source, /Import a small verified batch/);
    assert.match(source, /Prove one write and one review/);
    assert.match(source, /prospecting-bucket workflow/);
  });
});
