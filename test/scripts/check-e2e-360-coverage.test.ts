import { describe, expect, it } from "vitest";
import {
  runCoverage360Check,
  validateCoverage360Contract,
  type Coverage360Contract,
} from "../../scripts/check-e2e-360-coverage.mjs";

type ScenarioStub = {
  id: string;
  coverage?: { primary?: string[]; secondary?: string[] };
};

function makeContract(overrides: Partial<Coverage360Contract> = {}): Coverage360Contract {
  return {
    version: 1,
    title: "test contract",
    requiredStages: ["input", "validation"],
    proofKinds: ["happy", "boundary"],
    requirements: [
      {
        id: "input-route",
        stage: "input",
        surface: "channels",
        title: "route input",
        proofs: [
          {
            kind: "happy",
            scenarioId: "input-scenario",
            coverageIds: ["channels.input-routing"],
          },
        ],
      },
      {
        id: "validation-gate",
        stage: "validation",
        surface: "security",
        title: "validate input",
        proofs: [
          {
            kind: "boundary",
            scenarioId: "validation-scenario",
            coverageIds: ["security.input-gate"],
          },
        ],
      },
    ],
    faultInjection: [],
    performance: {
      requiredMetrics: [
        "ingest_ms",
        "first_token_ms",
        "final_response_ms",
        "delivery_ms",
        "recovery_ms",
        "tool_success_rate",
        "duplicate_side_effect_rate",
      ],
      budgets: { ingestMsP95: 500 },
    },
    ...overrides,
  };
}

function asScenario(value: ScenarioStub) {
  return value as never;
}

describe("check-e2e-360-coverage", () => {
  it("passes the repository contract against the real QA catalog", () => {
    const report = runCoverage360Check({ repoRoot: process.cwd() });

    expect(report.issues).toEqual([]);
    expect(report.missingStages).toEqual([]);
    expect(report.missingProofKinds).toEqual([]);
    expect(report.requirementCount).toBeGreaterThanOrEqual(10);
    expect(report.resolvedScenarioIds).toContain("channel-dm-group-routing");
    expect(report.resolvedCoverageIds).toContain("observability.telemetry-trace");
  });

  it("rejects a proof that is only secondary evidence", () => {
    const report = validateCoverage360Contract(
      makeContract(),
      [
        asScenario({ id: "input-scenario", coverage: { secondary: ["channels.input-routing"] } }),
        asScenario({ id: "validation-scenario", coverage: { primary: ["security.input-gate"] } }),
      ],
      "test.yaml",
    );

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "scenario-missing-primary-coverage",
          proof: "input-scenario",
        }),
        expect.objectContaining({
          code: "coverage-id-not-primary",
          proof: "input-scenario",
        }),
      ]),
    );
  });

  it("rejects missing stages and missing proof kinds", () => {
    const contract = makeContract({
      requiredStages: ["input", "validation", "output"],
      proofKinds: ["happy", "boundary", "recovery"],
    });
    const report = validateCoverage360Contract(
      contract,
      [
        asScenario({ id: "input-scenario", coverage: { primary: ["channels.input-routing"] } }),
        asScenario({ id: "validation-scenario", coverage: { primary: ["security.input-gate"] } }),
      ],
      "test.yaml",
    );

    expect(report.missingStages).toEqual(["output"]);
    expect(report.missingProofKinds).toEqual(["recovery"]);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "stage-not-covered" }),
        expect.objectContaining({ code: "proof-kind-not-covered" }),
      ]),
    );
  });
});
