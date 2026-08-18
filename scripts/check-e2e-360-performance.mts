import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCoverage360Check, type Coverage360Report } from "./check-e2e-360-coverage.mjs";

export type Coverage360PerformanceSample = {
  scenarioId: string;
  metrics: Record<string, number>;
};

export type Coverage360PerformanceReport = {
  samples: Coverage360PerformanceSample[];
  metadata?: Record<string, unknown>;
};

export type Coverage360MetricSummary = {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
};

export type Coverage360PerformanceIssue = {
  code: string;
  message: string;
  scenarioId?: string;
  metric?: string;
};

export type Coverage360PerformanceResult = {
  coverage: Coverage360Report;
  sampleCount: number;
  metrics: Record<string, Coverage360MetricSummary>;
  budgets: Record<string, number>;
  issues: Coverage360PerformanceIssue[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function percentile(values: readonly number[], percentileRank: number) {
  if (values.length === 0) {
    throw new Error("cannot calculate a percentile without values");
  }
  const sorted = [...values].toSorted((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(sorted.length * percentileRank));
  return sorted[rank - 1] ?? sorted.at(-1)!;
}

export function summarizeCoverage360Metric(values: readonly number[]): Coverage360MetricSummary {
  if (values.length === 0) {
    throw new Error("cannot summarize an empty metric series");
  }
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function parsePerformanceReport(raw: unknown): Coverage360PerformanceReport {
  if (!isRecord(raw) || !Array.isArray(raw.samples) || raw.samples.length === 0) {
    throw new Error("performance report must contain a non-empty samples array");
  }
  const samples: Coverage360PerformanceSample[] = [];
  for (const rawSample of raw.samples) {
    if (
      !isRecord(rawSample) ||
      typeof rawSample.scenarioId !== "string" ||
      !isRecord(rawSample.metrics)
    ) {
      throw new Error("each performance sample must contain scenarioId and metrics");
    }
    const metrics: Record<string, number> = {};
    for (const [metric, value] of Object.entries(rawSample.metrics)) {
      if (!isFiniteNumber(value)) {
        throw new Error(`performance metric must be a finite number: ${metric}`);
      }
      metrics[metric] = value;
    }
    samples.push({ scenarioId: rawSample.scenarioId, metrics });
  }
  return {
    samples,
    ...(isRecord(raw.metadata) ? { metadata: raw.metadata } : {}),
  };
}

export function validateCoverage360Performance(
  coverage: Coverage360Report,
  report: Coverage360PerformanceReport,
): Coverage360PerformanceResult {
  const issues: Coverage360PerformanceIssue[] = [];
  const expectedScenarioIds = new Set(coverage.resolvedScenarioIds);
  const valuesByMetric = new Map<string, number[]>();
  const requiredMetrics = new Set(coverage.performanceMetrics);

  if (coverage.issues.length > 0) {
    issues.push({
      code: "coverage-contract-invalid",
      message: `360-degree coverage contract has ${coverage.issues.length} validation issue(s)`,
    });
  }

  for (const sample of report.samples) {
    if (!expectedScenarioIds.has(sample.scenarioId)) {
      issues.push({
        code: "scenario-not-in-contract",
        message: `performance sample scenario is not part of the 360-degree contract: ${sample.scenarioId}`,
        scenarioId: sample.scenarioId,
      });
    }
    for (const metric of requiredMetrics) {
      const value = sample.metrics[metric];
      if (!isFiniteNumber(value)) {
        issues.push({
          code: "metric-missing",
          message: `performance sample is missing required metric: ${metric}`,
          scenarioId: sample.scenarioId,
          metric,
        });
        continue;
      }
      const metricValues = valuesByMetric.get(metric) ?? [];
      metricValues.push(value);
      valuesByMetric.set(metric, metricValues);
      if (value < 0) {
        issues.push({
          code: "metric-negative",
          message: `performance metric cannot be negative: ${metric}`,
          scenarioId: sample.scenarioId,
          metric,
        });
      }
    }
  }

  const metrics: Record<string, Coverage360MetricSummary> = {};
  for (const metric of requiredMetrics) {
    const values = valuesByMetric.get(metric) ?? [];
    if (values.length > 0) {
      metrics[metric] = summarizeCoverage360Metric(values);
    }
  }

  for (const [budgetName, budget] of Object.entries(coverage.performanceBudgets)) {
    const metric = budgetName
      .replace(/P95$/u, "")
      .replace(/Rate$/u, "_rate")
      .replace(/Ms$/u, "_ms")
      .replace(/([a-z])([A-Z])/gu, "$1_$2")
      .toLowerCase();
    const summary = metrics[metric];
    if (!summary) {
      issues.push({
        code: "budget-metric-missing",
        message: `budget has no measured metric series: ${budgetName} -> ${metric}`,
        metric,
      });
      continue;
    }
    const observed = budgetName.endsWith("P95") ? summary.p95 : summary.max;
    if (observed > budget) {
      issues.push({
        code: "budget-exceeded",
        message: `${metric} observed ${observed} exceeds budget ${budget}`,
        metric,
      });
    }
  }

  return {
    coverage,
    sampleCount: report.samples.length,
    metrics,
    budgets: { ...coverage.performanceBudgets },
    issues,
  };
}

function parseArgs(argv: readonly string[]) {
  let reportPath = "";
  let contractPath = "qa/e2e-360-coverage.yaml";
  let repoRoot = process.cwd();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") {
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--report") {
      reportPath = argv[++index] ?? "";
      if (!reportPath) {
        throw new Error("--report requires a path");
      }
      continue;
    }
    if (arg === "--contract") {
      contractPath = argv[++index] ?? "";
      if (!contractPath) {
        throw new Error("--contract requires a path");
      }
      continue;
    }
    if (arg === "--repo-root") {
      repoRoot = argv[++index] ?? "";
      if (!repoRoot) {
        throw new Error("--repo-root requires a path");
      }
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: pnpm check:e2e:360:performance --report <path> [--json] [--contract <path>] [--repo-root <path>]\n",
      );
      return null;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (!reportPath) {
    throw new Error("--report is required");
  }
  return { reportPath, contractPath, repoRoot, json };
}

function renderMarkdown(result: Coverage360PerformanceResult) {
  const lines = [
    "# E2E 360 Performance Report",
    "",
    `- Samples: ${result.sampleCount}`,
    `- Metrics: ${Object.keys(result.metrics).length}/${result.coverage.performanceMetrics.length}`,
    `- Validation issues: ${result.issues.length}`,
    "",
    "| Metric | Count | p50 | p95 | p99 | Min | Max |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...Object.entries(result.metrics).map(
      ([metric, summary]) =>
        `| ${metric} | ${summary.count} | ${summary.p50} | ${summary.p95} | ${summary.p99} | ${summary.min} | ${summary.max} |`,
    ),
    "",
  ];
  if (result.issues.length > 0) {
    lines.push("## Issues", "");
    for (const issue of result.issues) {
      lines.push(`- **${issue.code}**: ${issue.message}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function main(argv: readonly string[] = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options) {
    return 0;
  }
  const repoRoot = path.resolve(options.repoRoot);
  const reportPath = path.resolve(repoRoot, options.reportPath);
  const raw = JSON.parse(fs.readFileSync(reportPath, "utf8")) as unknown;
  const report = parsePerformanceReport(raw);
  const coverage = runCoverage360Check({ repoRoot, contractPath: options.contractPath });
  const result = validateCoverage360Performance(coverage, report);
  process.stdout.write(
    options.json ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result),
  );
  if (result.issues.length > 0) {
    process.exitCode = 1;
  }
  return result.issues.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
