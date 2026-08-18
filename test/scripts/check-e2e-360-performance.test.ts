import { describe, expect, it } from "vitest";
import { runCoverage360Check } from "../../scripts/check-e2e-360-coverage.mjs";
import {
  summarizeCoverage360Metric,
  validateCoverage360Performance,
  type Coverage360PerformanceReport,
} from "../../scripts/check-e2e-360-performance.mjs";

function makeMetrics(firstTokenMs = 100): Record<string, number> {
  return {
    ingest_ms: 20,
    first_token_ms: firstTokenMs,
    final_response_ms: 500,
    delivery_ms: 100,
    recovery_ms: 300,
    tool_success_rate: 1,
    duplicate_side_effect_rate: 0,
  };
}

describe("check-e2e-360-performance", () => {
  it("summarizes deterministic p50, p95 and p99 values", () => {
    expect(summarizeCoverage360Metric([30, 10, 20, 40])).toEqual({
      count: 4,
      p50: 20,
      p95: 40,
      p99: 40,
      min: 10,
      max: 40,
    });
  });

  it("passes samples that satisfy the 360-degree performance contract", () => {
    const coverage = runCoverage360Check({ repoRoot: process.cwd() });
    const performance: Coverage360PerformanceReport = {
      samples: [
        { scenarioId: "channel-dm-group-routing", metrics: makeMetrics() },
        { scenarioId: "session-streaming", metrics: makeMetrics(120) },
      ],
    };

    const result = validateCoverage360Performance(coverage, performance);

    expect(result.issues).toEqual([]);
    expect(result.metrics.first_token_ms.p95).toBe(120);
  });

  it("fails when a required budget is exceeded", () => {
    const coverage = runCoverage360Check({ repoRoot: process.cwd() });
    const performance: Coverage360PerformanceReport = {
      samples: [{ scenarioId: "session-streaming", metrics: makeMetrics(6000) }],
    };

    const result = validateCoverage360Performance(coverage, performance);

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "budget-exceeded", metric: "first_token_ms" }),
      ]),
    );
  });
});
