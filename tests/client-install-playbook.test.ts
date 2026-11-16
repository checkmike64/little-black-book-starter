import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildClientInstallPlaybook,
  type ClientInstallPlaybookInput,
} from "../lib/client-install-playbook.js";

type LaunchStatus = ClientInstallPlaybookInput["launchItems"][number]["status"];
type AcceptanceStatus = ClientInstallPlaybookInput["acceptanceItems"][number]["status"];

function launchItem(key: string, status: LaunchStatus) {
  return {
    key,
    label: key,
    detail: `${key} detail`,
    href: `/${key}`,
    status,
  };
}

function acceptanceItem(key: string, status: AcceptanceStatus) {
  return {
    key,
    label: key,
    detail: `${key} detail`,
    href: `/${key}`,
    status,
  };
}

function input(
  launchOverrides: Record<string, LaunchStatus> = {},
  acceptanceOverrides: Record<string, AcceptanceStatus> = {},
): ClientInstallPlaybookInput {
  const launchDefaults: Record<string, LaunchStatus> = {
    deployment: "pass",
    tenant: "pass",
    modules: "pass",
    "operator-plan": "pass",
    contacts: "pass",
    "data-quality": "pass",
    acceptance: "pass",
    "command-output": "pass",
    "review-pressure": "pass",
    ask: "pass",
    rehearsal: "pass",
    privacy: "pass",
    "handoff-notes": "pass",
    ...launchOverrides,
  };
  const acceptanceDefaults: Record<string, AcceptanceStatus> = {
    "test-job-created": "pass",
    "test-job-claimed": "pass",
    "test-job-completed": "pass",
    "low-risk-review": "pass",
    "audit-provenance": "pass",
    ...acceptanceOverrides,
  };

  return {
    launchItems: Object.entries(launchDefaults).map(([key, status]) =>
      launchItem(key, status),
    ),
    acceptanceItems: Object.entries(acceptanceDefaults).map(([key, status]) =>
      acceptanceItem(key, status),
    ),
    operatorQuestions: [],
  };
}

describe("client install playbook", () => {
  test("marks the full playbook complete when all gates pass", () => {
    const playbook = buildClientInstallPlaybook(input());

    assert.equal(playbook.ready, true);
    assert.equal(playbook.doneCount, playbook.total);
    assert.equal(playbook.active.key, "handoff");
    assert.match(playbook.summary, /complete/);
  });

  test("blocks configuration before downstream proof when production wiring is missing", () => {
    const playbook = buildClientInstallPlaybook(
      input({
        deployment: "action",
        contacts: "waiting",
        acceptance: "waiting",
        rehearsal: "waiting",
      }),
    );

    assert.equal(playbook.ready, false);
    assert.equal(playbook.active.key, "configure");
    assert.equal(playbook.active.status, "blocked");
    assert.ok(playbook.phases.some((phase) => phase.key === "data" && phase.status === "waiting"));
  });

  test("keeps Claude proof active until the job lifecycle has passed", () => {
    const playbook = buildClientInstallPlaybook(
      input(
        {
          acceptance: "action",
          "command-output": "action",
          rehearsal: "waiting",
        },
        {
          "test-job-created": "pass",
          "test-job-claimed": "action",
          "test-job-completed": "waiting",
        },
      ),
    );

    assert.equal(playbook.active.key, "claude");
    assert.equal(playbook.active.status, "active");
    assert.match(playbook.active.nextStep, /test job/i);
  });

  test("routes review before rehearsal when Ask or pending changes remain open", () => {
    const playbook = buildClientInstallPlaybook(
      input({
        "review-pressure": "action",
        ask: "action",
        rehearsal: "waiting",
      }),
    );

    assert.equal(playbook.active.key, "review");
    assert.equal(playbook.active.href, "/changes");
  });

  test("waits on handoff until rehearsal evidence exists", () => {
    const playbook = buildClientInstallPlaybook(
      input({
        rehearsal: "action",
        privacy: "action",
        "handoff-notes": "action",
      }),
    );

    assert.equal(playbook.active.key, "rehearse");
    assert.equal(playbook.phases.find((phase) => phase.key === "handoff")?.status, "waiting");
  });
});
