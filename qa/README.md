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

Operator workflows:

- Use the `openclaw-qa-testing` skill for QA Lab live lanes, Convex credential
  pool operations, and WhatsApp live credential setup/replacement.

Keep this folder in git. Add new scenarios here before wiring them into automation.
