# QA Scenarios

Seed QA assets for the private `qa-lab` extension.

Files:

- `scenarios/index.yaml` - canonical QA scenario pack, kickoff mission, and operator identity.
- `scenarios/<theme>/*.yaml` - one runnable scenario per YAML file.
- `frontier-harness-plan.md` - big-model bakeoff and tuning loop for harness work.
- `e2e-360-coverage.yaml` - declarative traceability contract for input, validation, processing, decision, output, recovery, and monitoring.
- `convex-credential-broker/` - standalone Convex v1 lease broker for pooled live credentials.

Key workflow:

- `qa suite` is the executable frontier subset / regression loop.
- `qa manual` is the scoped personality and style probe after the executable subset is green.
- `qa coverage` prints the scenario coverage inventory from scenario YAML.
- `pnpm check:e2e:360` verifies that every required 360-degree proof resolves to a primary-owned scenario and coverage ID.
- `pnpm check:e2e:360:performance -- --report <path>` aggregates observed samples and enforces the contract budgets for p50/p95/p99 and side-effect safety.
- `pnpm check:e2e:360:evidence -- --evidence <qa-evidence.json> [--require-all]` validates real suite evidence against the contract, including primary coverage IDs, pass status, scenario timing and missing contract scenarios.

Real runtime note for the sandbox:

- The local Node `v22.13.0` is unsupported because it embeds an unsafe SQLite version. Use Node `v24.15.0+` (or Node `v22.22.3+`) and export the binary directory in `PATH` before running host-backed QA.
- `session-streaming` is executable with the following deterministic command, which skips the redundant rebuild after the workspace has been prepared, enables the private QA surface, writes all artifacts, and keeps the process from blocking on a failing scenario:

```bash
NODE_BIN=$(find "$HOME/.local/share/pnpm/store/v11/links/@/node/24.15.0" -type f -path '*/bin/node' -print -quit)
NODE_DIR=$(dirname "$NODE_BIN")
PATH="$NODE_DIR:$PATH" OPENCLAW_E2E_SKIP_BUILD=1 OPENCLAW_BUILD_PRIVATE_QA=1 OPENCLAW_ENABLE_PRIVATE_QA_CLI=1 \
  "$NODE_BIN" --import tsx scripts/run-node.mjs qa suite \
  --scenario session-streaming --provider-mode mock-openai --concurrency 1 \
  --allow-failures --fail-fast --output-dir .artifacts/session-streaming-real
```

The real sandbox run produced a passing `session-streaming` result on Node `v24.15.0` with `final_response_ms=72056` and a valid `qa-evidence.json`. The 360-degree evidence gate accepted that artifact with one observed scenario, 100% timing coverage and zero validation issues.

Operator workflows:

- Use the `openclaw-qa-testing` skill for QA Lab live lanes, Convex credential
  pool operations, and WhatsApp live credential setup/replacement.

Keep this folder in git. Add new scenarios here before wiring them into automation.
