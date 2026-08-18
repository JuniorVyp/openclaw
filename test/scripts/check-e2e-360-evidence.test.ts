import { describe, expect, it } from "vitest";
import type { QaEvidenceSummaryJson } from "../../extensions/qa-lab/src/evidence-summary.js";
import { runCoverage360Check } from "../../scripts/check-e2e-360-coverage.mjs";
import {
  validateE2E360Evidence,
  type E2E360EvidenceResult,
} from "../../scripts/check-e2e-360-evidence.mjs";

function makeSummary(
  coverage: ReturnType<typeof runCoverage360Check>,
  scenarioIds = coverage.resolvedScenarioIds,
): QaEvidenceSummaryJson {
  return {
    kind: "openclaw.qa.evidence-summary",
    schemaVersion: 2,
    generatedAt: "2026-08-18T00:00:00.000Z",
    evidenceMode: "full",
    entries: scenarioIds.map((scenarioId) => ({
      test: { kind: "qa-scenario", id: scenarioId, title: scenarioId },
      coverage: (coverage.scenarioCoverageIds[scenarioId] ?? []).map((id) => ({
        id,
        role: "primary",
      })),
      result: { status: "pass", timing: { wallMs: 10 } },
    })),
  };
}

describe("check-e2e-360-evidence", () => {
  it("passes when the full contract has primary evidence and positive timing", () => {
    const coverage = runCoverage360Check({ repoRoot: process.cwd() });
    const result = validateE2E360Evidence(coverage, makeSummary(coverage), { requireAll: true });

    expect(result.issues).toEqual([]);
    expect(result.entryCount).toBe(coverage.resolvedScenarioIds.length);
    expect(result.timingCoveragePercent).toBe(100);
    expect(result.samples).toHaveLength(coverage.resolvedScenarioIds.length);
  });

  it("fails require-all when a contract scenario is absent from the evidence artifact", () => {
    const coverage = runCoverage360Check({ repoRoot: process.cwd() });
    const result = validateE2E360Evidence(
      coverage,
      makeSummary(coverage, [coverage.resolvedScenarioIds[0]!]),
      { requireAll: true },
    );

    expect(result.missingScenarioIds.length).toBe(coverage.resolvedScenarioIds.length - 1);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "scenario-evidence-missing" })]),
    );
  });

  it("fails when primary coverage or timing is absent", () => {
    const coverage = runCoverage360Check({ repoRoot: process.cwd() });
    const scenarioId = "session-streaming";
    const summary = makeSummary(coverage, [scenarioId]);
    summary.entries[0] = {
      ...summary.entries[0]!,
      coverage: [],
      result: { status: "pass" },
    };

    const result: E2E360EvidenceResult = validateE2E360Evidence(coverage, summary);

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "evidence-missing-primary-coverage" }),
        expect.objectContaining({ code: "evidence-coverage-mismatch" }),
        expect.objectContaining({ code: "scenario-timing-missing" }),
      ]),
    );
    expect(result.timingCoveragePercent).toBe(0);
  });
});
