import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import {
  readQaScenarioPack,
  type QaSeedScenarioWithSource,
} from "../extensions/qa-lab/src/scenario-catalog.js";

export type Coverage360ProofKind = "happy" | "boundary" | "recovery" | "observability";

export type Coverage360Proof = {
  kind: Coverage360ProofKind;
  scenarioId: string;
  coverageIds: string[];
};

export type Coverage360FaultInjection = {
  id: string;
  kind: string;
  scenarioId: string;
};

export type Coverage360Requirement = {
  id: string;
  stage: string;
  surface: string;
  title: string;
  proofs: Coverage360Proof[];
};

export type Coverage360Contract = {
  version: number;
  title: string;
  summary?: string;
  requiredStages: string[];
  proofKinds: Coverage360ProofKind[];
  requirements: Coverage360Requirement[];
  faultInjection: Coverage360FaultInjection[];
  performance: {
    requiredMetrics: string[];
    budgets: Record<string, number>;
  };
};

type Coverage360Issue = {
  code: string;
  message: string;
  requirementId?: string;
  proof?: string;
};

export type Coverage360Report = {
  contractPath: string;
  scenarioCount: number;
  requirementCount: number;
  proofCount: number;
  faultInjectionCount: number;
  resolvedFaultInjectionIds: string[];
  requiredStages: string[];
  coveredStages: string[];
  missingStages: string[];
  requiredProofKinds: Coverage360ProofKind[];
  coveredProofKinds: Coverage360ProofKind[];
  missingProofKinds: Coverage360ProofKind[];
  resolvedScenarioIds: string[];
  resolvedCoverageIds: string[];
  performanceMetrics: string[];
  performanceBudgets: Record<string, number>;
  issues: Coverage360Issue[];
};

type Coverage360CheckOptions = {
  contractPath?: string;
  repoRoot?: string;
  scenarios?: readonly QaSeedScenarioWithSource[];
};

const DEFAULT_CONTRACT_PATH = "qa/e2e-360-coverage.yaml";
const ALLOWED_PROOF_KINDS = new Set<Coverage360ProofKind>([
  "happy",
  "boundary",
  "recovery",
  "observability",
]);
const ALLOWED_FAULT_KINDS = new Set([
  "lifecycle",
  "provider",
  "policy",
  "observability",
  "delivery",
  "storage",
  "network",
]);
const REQUIRED_METRICS = new Set([
  "ingest_ms",
  "first_token_ms",
  "final_response_ms",
  "delivery_ms",
  "recovery_ms",
  "tool_success_rate",
  "duplicate_side_effect_rate",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function numberRecord(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

function pushIssue(
  issues: Coverage360Issue[],
  code: string,
  message: string,
  requirementId?: string,
  proof?: string,
) {
  issues.push({
    code,
    message,
    ...(requirementId ? { requirementId } : {}),
    ...(proof ? { proof } : {}),
  });
}

function parseContract(raw: unknown, issues: Coverage360Issue[]): Coverage360Contract | null {
  if (!isRecord(raw)) {
    pushIssue(issues, "contract-invalid", "360-degree coverage contract must be a mapping");
    return null;
  }

  const version = raw.version;
  const title = raw.title;
  const requiredStages = raw.requiredStages;
  const proofKinds = raw.proofKinds;
  const rawRequirements = raw.requirements;
  const rawPerformance = raw.performance;
  const rawFaultInjection = raw.faultInjection;

  if (version !== 1) {
    pushIssue(issues, "contract-version-invalid", "contract version must be 1");
  }
  if (!nonEmptyString(title)) {
    pushIssue(issues, "contract-title-missing", "contract title must be a non-empty string");
  }
  if (!stringArray(requiredStages) || requiredStages.length === 0) {
    pushIssue(issues, "required-stages-missing", "requiredStages must contain at least one stage");
  }
  if (!stringArray(proofKinds) || proofKinds.length === 0) {
    pushIssue(issues, "proof-kinds-missing", "proofKinds must contain at least one proof kind");
  }
  if (!Array.isArray(rawRequirements) || rawRequirements.length === 0) {
    pushIssue(issues, "requirements-missing", "requirements must contain at least one requirement");
  }
  if (!isRecord(rawPerformance)) {
    pushIssue(issues, "performance-missing", "performance must define requiredMetrics and budgets");
  }
  if (!Array.isArray(rawFaultInjection) || rawFaultInjection.length === 0) {
    pushIssue(
      issues,
      "fault-injection-missing",
      "faultInjection must contain at least one fault definition",
    );
  }

  const parsedRequirements: Coverage360Requirement[] = [];
  if (Array.isArray(rawRequirements)) {
    for (const rawRequirement of rawRequirements) {
      if (!isRecord(rawRequirement)) {
        pushIssue(issues, "requirement-invalid", "each requirement must be a mapping");
        continue;
      }
      const id = rawRequirement.id;
      const stage = rawRequirement.stage;
      const surface = rawRequirement.surface;
      const requirementTitle = rawRequirement.title;
      const rawProofs = rawRequirement.proofs;
      if (
        !nonEmptyString(id) ||
        !nonEmptyString(stage) ||
        !nonEmptyString(surface) ||
        !nonEmptyString(requirementTitle)
      ) {
        pushIssue(
          issues,
          "requirement-fields-missing",
          "requirement id, stage, surface and title are required",
          nonEmptyString(id) ? id : undefined,
        );
        continue;
      }
      const proofs: Coverage360Proof[] = [];
      if (!Array.isArray(rawProofs) || rawProofs.length === 0) {
        pushIssue(
          issues,
          "requirement-proofs-missing",
          "requirement must define at least one proof",
          id,
        );
      } else {
        for (const rawProof of rawProofs) {
          if (!isRecord(rawProof)) {
            pushIssue(issues, "proof-invalid", "proof must be a mapping", id);
            continue;
          }
          const kind = rawProof.kind;
          const scenarioId = rawProof.scenarioId;
          const coverageIds = rawProof.coverageIds;
          if (
            !ALLOWED_PROOF_KINDS.has(kind as Coverage360ProofKind) ||
            !nonEmptyString(scenarioId) ||
            !stringArray(coverageIds) ||
            coverageIds.length === 0
          ) {
            pushIssue(
              issues,
              "proof-fields-invalid",
              "proof kind, scenarioId and at least one coverageId are required",
              id,
              nonEmptyString(scenarioId) ? scenarioId : undefined,
            );
            continue;
          }
          proofs.push({ kind: kind as Coverage360ProofKind, scenarioId, coverageIds });
        }
      }
      parsedRequirements.push({ id, stage, surface, title: requirementTitle, proofs });
    }
  }

  const parsedFaultInjection: Coverage360FaultInjection[] = [];
  if (Array.isArray(rawFaultInjection)) {
    for (const rawFault of rawFaultInjection) {
      if (
        !isRecord(rawFault) ||
        !nonEmptyString(rawFault.id) ||
        !nonEmptyString(rawFault.kind) ||
        !nonEmptyString(rawFault.scenarioId)
      ) {
        pushIssue(
          issues,
          "fault-injection-invalid",
          "fault injection requires id, kind and scenarioId",
        );
        continue;
      }
      parsedFaultInjection.push({
        id: rawFault.id,
        kind: rawFault.kind,
        scenarioId: rawFault.scenarioId,
      });
    }
  }
  const performance = isRecord(rawPerformance) ? rawPerformance : {};
  const requiredMetrics = stringArray(performance.requiredMetrics)
    ? performance.requiredMetrics
    : [];
  const budgets = numberRecord(performance.budgets) ? performance.budgets : {};
  return {
    version: typeof version === "number" ? version : 0,
    title: nonEmptyString(title) ? title : "",
    ...(nonEmptyString(raw.summary) ? { summary: raw.summary } : {}),
    requiredStages: stringArray(requiredStages) ? requiredStages : [],
    proofKinds: stringArray(proofKinds)
      ? proofKinds.filter((kind): kind is Coverage360ProofKind =>
          ALLOWED_PROOF_KINDS.has(kind as Coverage360ProofKind),
        )
      : [],
    requirements: parsedRequirements,
    faultInjection: parsedFaultInjection,
    performance: { requiredMetrics, budgets },
  };
}

function validateUniqueValues(
  values: readonly string[],
  code: string,
  label: string,
  issues: Coverage360Issue[],
) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      pushIssue(issues, code, `${label} contains duplicate value: ${value}`);
    }
    seen.add(value);
  }
}

export function validateCoverage360Contract(
  contract: Coverage360Contract,
  scenarios: readonly QaSeedScenarioWithSource[],
  contractPath = DEFAULT_CONTRACT_PATH,
): Coverage360Report {
  const issues: Coverage360Issue[] = [];
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const requiredStageSet = new Set(contract.requiredStages);
  const proofKindSet = new Set(contract.proofKinds);
  const coveredStages = new Set<string>();
  const coveredProofKinds = new Set<Coverage360ProofKind>();
  const resolvedScenarioIds = new Set<string>();
  const resolvedCoverageIds = new Set<string>();
  const resolvedFaultInjectionIds = new Set<string>();

  validateUniqueValues(contract.requiredStages, "duplicate-stage", "requiredStages", issues);
  validateUniqueValues(contract.proofKinds, "duplicate-proof-kind", "proofKinds", issues);
  validateUniqueValues(
    contract.requirements.map((requirement) => requirement.id),
    "duplicate-requirement-id",
    "requirements",
    issues,
  );

  const requirementIds = new Set<string>();
  for (const requirement of contract.requirements) {
    if (requirementIds.has(requirement.id)) {
      continue;
    }
    requirementIds.add(requirement.id);
    if (!requiredStageSet.has(requirement.stage)) {
      pushIssue(
        issues,
        "stage-not-declared",
        `requirement stage is not listed in requiredStages: ${requirement.stage}`,
        requirement.id,
      );
    }
    if (requirement.proofs.length === 0) {
      continue;
    }
    coveredStages.add(requirement.stage);
    for (const proof of requirement.proofs) {
      coveredProofKinds.add(proof.kind);
      if (!proofKindSet.has(proof.kind)) {
        pushIssue(
          issues,
          "proof-kind-not-declared",
          `proof kind is not listed in proofKinds: ${proof.kind}`,
          requirement.id,
          proof.scenarioId,
        );
      }
      const scenario = scenarioById.get(proof.scenarioId);
      if (!scenario) {
        pushIssue(
          issues,
          "scenario-not-found",
          `scenario is not present in the QA catalog: ${proof.scenarioId}`,
          requirement.id,
          proof.scenarioId,
        );
        continue;
      }
      resolvedScenarioIds.add(proof.scenarioId);
      const primaryCoverageIds = new Set(scenario.coverage?.primary ?? []);
      if (primaryCoverageIds.size === 0) {
        pushIssue(
          issues,
          "scenario-missing-primary-coverage",
          `scenario has no primary coverage IDs: ${proof.scenarioId}`,
          requirement.id,
          proof.scenarioId,
        );
      }
      for (const coverageId of proof.coverageIds) {
        resolvedCoverageIds.add(coverageId);
        if (!primaryCoverageIds.has(coverageId)) {
          pushIssue(
            issues,
            "coverage-id-not-primary",
            `coverage ID is not a primary owner of ${proof.scenarioId}: ${coverageId}`,
            requirement.id,
            proof.scenarioId,
          );
        }
      }
    }
  }

  const faultIds = new Set<string>();
  for (const fault of contract.faultInjection) {
    if (faultIds.has(fault.id)) {
      pushIssue(
        issues,
        "duplicate-fault-injection-id",
        `fault injection ID is duplicated: ${fault.id}`,
      );
    }
    faultIds.add(fault.id);
    if (!ALLOWED_FAULT_KINDS.has(fault.kind)) {
      pushIssue(
        issues,
        "fault-injection-kind-unknown",
        `fault injection kind is unsupported: ${fault.kind}`,
        undefined,
        fault.scenarioId,
      );
    }
    const scenario = scenarioById.get(fault.scenarioId);
    if (!scenario) {
      pushIssue(
        issues,
        "fault-injection-scenario-not-found",
        `fault injection scenario is not present in the QA catalog: ${fault.scenarioId}`,
        undefined,
        fault.scenarioId,
      );
      continue;
    }
    if ((scenario.coverage?.primary ?? []).length === 0) {
      pushIssue(
        issues,
        "fault-injection-missing-primary-coverage",
        `fault injection scenario has no primary coverage IDs: ${fault.scenarioId}`,
        undefined,
        fault.scenarioId,
      );
    }
    resolvedFaultInjectionIds.add(fault.id);
  }

  for (const stage of contract.requiredStages) {
    if (!coveredStages.has(stage)) {
      pushIssue(issues, "stage-not-covered", `required stage has no proof: ${stage}`);
    }
  }
  for (const proofKind of contract.proofKinds) {
    if (!coveredProofKinds.has(proofKind)) {
      pushIssue(issues, "proof-kind-not-covered", `required proof kind has no proof: ${proofKind}`);
    }
  }

  const missingMetrics = contract.performance.requiredMetrics.filter(
    (metric) => !REQUIRED_METRICS.has(metric),
  );
  for (const metric of missingMetrics) {
    pushIssue(
      issues,
      "metric-unknown",
      `performance metric is not part of the supported contract: ${metric}`,
    );
  }
  for (const metric of REQUIRED_METRICS) {
    if (!contract.performance.requiredMetrics.includes(metric)) {
      pushIssue(issues, "metric-missing", `required performance metric is missing: ${metric}`);
    }
  }
  for (const [budget, value] of Object.entries(contract.performance.budgets)) {
    if (!Number.isFinite(value) || value < 0) {
      pushIssue(
        issues,
        "budget-invalid",
        `performance budget must be a finite non-negative number: ${budget}`,
      );
    }
  }

  return {
    contractPath,
    scenarioCount: scenarios.length,
    requirementCount: contract.requirements.length,
    proofCount: contract.requirements.reduce(
      (total, requirement) => total + requirement.proofs.length,
      0,
    ),
    faultInjectionCount: contract.faultInjection.length,
    resolvedFaultInjectionIds: [...resolvedFaultInjectionIds].toSorted(),
    requiredStages: [...contract.requiredStages],
    coveredStages: [...coveredStages].toSorted(),
    missingStages: contract.requiredStages.filter((stage) => !coveredStages.has(stage)),
    requiredProofKinds: [...contract.proofKinds],
    coveredProofKinds: [...coveredProofKinds].toSorted(),
    missingProofKinds: contract.proofKinds.filter((kind) => !coveredProofKinds.has(kind)),
    resolvedScenarioIds: [...resolvedScenarioIds].toSorted(),
    resolvedCoverageIds: [...resolvedCoverageIds].toSorted(),
    performanceMetrics: [...contract.performance.requiredMetrics],
    performanceBudgets: { ...contract.performance.budgets },
    issues,
  };
}

function parseArgs(argv: readonly string[]) {
  let json = false;
  let contractPath = DEFAULT_CONTRACT_PATH;
  let repoRoot = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") {
      continue;
    }
    if (arg === "--json") {
      json = true;
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
        "Usage: pnpm check:e2e:360 [--json] [--contract <path>] [--repo-root <path>]\n",
      );
      return null;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return { json, contractPath, repoRoot };
}

function renderMarkdownReport(report: Coverage360Report) {
  const lines = [
    "# E2E 360 Coverage Contract",
    "",
    `- Contract: ${report.contractPath}`,
    `- Scenarios in catalog: ${report.scenarioCount}`,
    `- Requirements: ${report.requirementCount}`,
    `- Proofs: ${report.proofCount}`,
    `- Fault injections: ${report.resolvedFaultInjectionIds.length}/${report.faultInjectionCount}`,
    `- Covered stages: ${report.coveredStages.length}/${report.requiredStages.length}`,
    `- Covered proof kinds: ${report.coveredProofKinds.length}/${report.requiredProofKinds.length}`,
    `- Resolved scenarios: ${report.resolvedScenarioIds.length}`,
    `- Resolved coverage IDs: ${report.resolvedCoverageIds.length}`,
    `- Validation issues: ${report.issues.length}`,
    "",
    "## Performance contract",
    "",
    `- Metrics: ${report.performanceMetrics.join(", ") || "none"}`,
    "",
    "| Budget | Value |",
    "|---|---:|",
    ...Object.entries(report.performanceBudgets).map(
      ([budget, value]) => `| ${budget} | ${value} |`,
    ),
    "",
  ];
  if (report.missingStages.length > 0) {
    lines.push("## Missing stages", "", ...report.missingStages.map((stage) => `- ${stage}`), "");
  }
  if (report.issues.length > 0) {
    lines.push("## Validation issues", "");
    for (const issue of report.issues) {
      const context = [issue.requirementId, issue.proof].filter(Boolean).join(" / ");
      lines.push(`- **${issue.code}**${context ? ` (${context})` : ""}: ${issue.message}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function runCoverage360Check(options: Coverage360CheckOptions = {}): Coverage360Report {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const contractPath = path.resolve(repoRoot, options.contractPath ?? DEFAULT_CONTRACT_PATH);
  const raw = YAML.parse(fs.readFileSync(contractPath, "utf8")) as unknown;
  const issues: Coverage360Issue[] = [];
  const contract = parseContract(raw, issues);
  const scenarios = options.scenarios ?? readQaScenarioPack().scenarios;
  if (!contract) {
    return {
      contractPath: path.relative(repoRoot, contractPath),
      scenarioCount: scenarios.length,
      requirementCount: 0,
      proofCount: 0,
      faultInjectionCount: 0,
      resolvedFaultInjectionIds: [],
      requiredStages: [],
      coveredStages: [],
      missingStages: [],
      requiredProofKinds: [],
      coveredProofKinds: [],
      missingProofKinds: [],
      resolvedScenarioIds: [],
      resolvedCoverageIds: [],
      performanceMetrics: [],
      performanceBudgets: {},
      issues,
    };
  }
  const report = validateCoverage360Contract(
    contract,
    scenarios,
    path.relative(repoRoot, contractPath),
  );
  return { ...report, issues: [...issues, ...report.issues] };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    return;
  }
  const report = runCoverage360Check(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderMarkdownReport(report));
  }
  if (report.issues.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
