import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateQaEvidenceSummaryJson,
  type QaEvidenceSummaryJson,
} from "../extensions/qa-lab/src/evidence-summary.js";
import { runCoverage360Check, type Coverage360Report } from "./check-e2e-360-coverage.mjs";

export type E2E360EvidenceIssue = {
  code: string;
  message: string;
  scenarioId?: string;
};

export type E2E360ObservedMetricSample = {
  scenarioId: string;
  metrics: {
    final_response_ms?: number;
    tool_success_rate?: number;
  };
};

export type E2E360EvidenceResult = {
  evidencePath: string;
  coverage: Coverage360Report;
  entryCount: number;
  observedScenarioIds: string[];
  missingScenarioIds: string[];
  failedScenarioIds: string[];
  timingCoveragePercent: number;
  samples: E2E360ObservedMetricSample[];
  issues: E2E360EvidenceIssue[];
};

type E2E360EvidenceOptions = {
  requireAll?: boolean;
};

function addIssue(
  issues: E2E360EvidenceIssue[],
  code: string,
  message: string,
  scenarioId?: string,
) {
  issues.push({ code, message, ...(scenarioId ? { scenarioId } : {}) });
}

function observedMetricSamples(summary: QaEvidenceSummaryJson): E2E360ObservedMetricSample[] {
  return summary.entries.flatMap((entry) => {
    const timing = entry.result.timing?.wallMs;
    if (typeof timing !== "number" || !Number.isFinite(timing) || timing <= 0) {
      return [];
    }
    return [
      {
        scenarioId: entry.test.id,
        metrics: {
          final_response_ms: timing,
          tool_success_rate: entry.result.status === "pass" ? 1 : 0,
        },
      },
    ];
  });
}

export function validateE2E360Evidence(
  coverage: Coverage360Report,
  summary: QaEvidenceSummaryJson,
  options: E2E360EvidenceOptions = {},
  evidencePath = "qa-evidence.json",
): E2E360EvidenceResult {
  const issues: E2E360EvidenceIssue[] = [];
  const contractScenarioIds = new Set(coverage.resolvedScenarioIds);
  const observedScenarioIds = summary.entries.map((entry) => entry.test.id);
  const observedScenarioSet = new Set(observedScenarioIds);
  const failedScenarioIds = summary.entries
    .filter((entry) => entry.result.status !== "pass")
    .map((entry) => entry.test.id);

  if (coverage.issues.length > 0) {
    addIssue(
      issues,
      "coverage-contract-invalid",
      `coverage contract has ${coverage.issues.length} validation issue(s)`,
    );
  }

  for (const entry of summary.entries) {
    const scenarioId = entry.test.id;
    if (!contractScenarioIds.has(scenarioId)) {
      addIssue(
        issues,
        "scenario-not-in-contract",
        `evidence scenario is not declared by the 360-degree contract: ${scenarioId}`,
        scenarioId,
      );
    }
    const evidencePrimaryCoverageIds = new Set(
      entry.coverage
        .filter((coverageEntry) => coverageEntry.role === "primary")
        .map((coverageEntry) => coverageEntry.id),
    );
    if (evidencePrimaryCoverageIds.size === 0) {
      addIssue(
        issues,
        "evidence-missing-primary-coverage",
        `evidence entry has no primary coverage proof: ${scenarioId}`,
        scenarioId,
      );
    }
    for (const expectedCoverageId of coverage.scenarioCoverageIds[scenarioId] ?? []) {
      if (!evidencePrimaryCoverageIds.has(expectedCoverageId)) {
        addIssue(
          issues,
          "evidence-coverage-mismatch",
          `evidence entry is missing expected primary coverage ID ${expectedCoverageId}: ${scenarioId}`,
          scenarioId,
        );
      }
    }
    if (entry.result.status !== "pass") {
      addIssue(
        issues,
        "scenario-not-passing",
        `evidence scenario status is ${entry.result.status}: ${scenarioId}`,
        scenarioId,
      );
    }
    const wallMs = entry.result.timing?.wallMs;
    if (typeof wallMs !== "number" || !Number.isFinite(wallMs) || wallMs <= 0) {
      addIssue(
        issues,
        "scenario-timing-missing",
        `evidence scenario has no positive wallMs timing: ${scenarioId}`,
        scenarioId,
      );
    }
  }

  const missingScenarioIds = options.requireAll
    ? coverage.resolvedScenarioIds.filter((scenarioId) => !observedScenarioSet.has(scenarioId))
    : [];
  for (const scenarioId of missingScenarioIds) {
    addIssue(
      issues,
      "scenario-evidence-missing",
      `required contract scenario is absent from the evidence artifact: ${scenarioId}`,
      scenarioId,
    );
  }

  const samples = observedMetricSamples(summary);
  return {
    evidencePath,
    coverage,
    entryCount: summary.entries.length,
    observedScenarioIds: [...observedScenarioSet].toSorted(),
    missingScenarioIds,
    failedScenarioIds: [...new Set(failedScenarioIds)].toSorted(),
    timingCoveragePercent:
      summary.entries.length === 0
        ? 0
        : Math.round((samples.length / summary.entries.length) * 10000) / 100,
    samples,
    issues,
  };
}

function parseArgs(argv: readonly string[]) {
  let evidencePath = "";
  let contractPath = "qa/e2e-360-coverage.yaml";
  let repoRoot = process.cwd();
  let outputPath = "";
  let json = false;
  let requireAll = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") {
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--require-all") {
      requireAll = true;
      continue;
    }
    if (arg === "--evidence" || arg === "--report") {
      evidencePath = argv[++index] ?? "";
      if (!evidencePath) {
        throw new Error(`${arg} requires a path`);
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
    if (arg === "--output") {
      outputPath = argv[++index] ?? "";
      if (!outputPath) {
        throw new Error("--output requires a path");
      }
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: pnpm check:e2e:360:evidence --evidence <qa-evidence.json> [--require-all] [--json] [--output <path>]\n",
      );
      return null;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (!evidencePath) {
    throw new Error("--evidence is required");
  }
  return { contractPath, evidencePath, json, outputPath, repoRoot, requireAll };
}

function renderMarkdown(result: E2E360EvidenceResult) {
  const lines = [
    "# E2E 360 Evidence Gate",
    "",
    `- Evidence: ${result.evidencePath}`,
    `- Entries: ${result.entryCount}`,
    `- Observed scenarios: ${result.observedScenarioIds.length}`,
    `- Timing coverage: ${result.timingCoveragePercent}%`,
    `- Failed scenarios: ${result.failedScenarioIds.length}`,
    `- Validation issues: ${result.issues.length}`,
    "",
    "| Scenario | final_response_ms | tool_success_rate |",
    "|---|---:|---:|",
    ...result.samples.map(
      (sample) =>
        `| ${sample.scenarioId} | ${sample.metrics.final_response_ms ?? "n/a"} | ${sample.metrics.tool_success_rate ?? "n/a"} |`,
    ),
    "",
  ];
  if (result.missingScenarioIds.length > 0) {
    lines.push("## Missing scenarios", "", ...result.missingScenarioIds.map((id) => `- ${id}`), "");
  }
  if (result.issues.length > 0) {
    lines.push("## Issues", "");
    for (const issue of result.issues) {
      lines.push(
        `- **${issue.code}**${issue.scenarioId ? ` (${issue.scenarioId})` : ""}: ${issue.message}`,
      );
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
  const evidencePath = path.resolve(repoRoot, options.evidencePath);
  const summary = validateQaEvidenceSummaryJson(
    JSON.parse(fs.readFileSync(evidencePath, "utf8")) as unknown,
  );
  const coverage = runCoverage360Check({ repoRoot, contractPath: options.contractPath });
  const result = validateE2E360Evidence(
    coverage,
    summary,
    { requireAll: options.requireAll },
    path.relative(repoRoot, evidencePath),
  );
  const body = options.json ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result);
  if (options.outputPath) {
    const outputPath = path.resolve(repoRoot, options.outputPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, body, "utf8");
    process.stdout.write(`E2E 360 evidence report: ${outputPath}\n`);
  } else {
    process.stdout.write(body);
  }
  if (result.issues.length > 0) {
    process.exitCode = 1;
  }
  return result.issues.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
