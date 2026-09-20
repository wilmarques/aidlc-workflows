# Jev Integration Proposal for AI-DLC

## Summary

Integrate TypeSafe's Jev (System One model) as a calibrated intelligence layer in AI-DLC, providing typed judgments (Choice, Noul, Score) with probabilities at key decision points — while keeping the deterministic engine in full control.

## Problem

AI-DLC currently relies on heuristic-based judgment for several decisions that would benefit from calibrated, typed AI intelligence:

1. **Composer ARS estimation** — The `aidlc-composer-agent` scores 5 components (IAE, CSU, VE, R, UA) using subjective heuristics. These scores feed the gate tables but are uncalibrated priors.
2. **Intent classification and complexity assessment** — The `intent-capture` stage manually classifies requests; there is no structured judgment layer.
3. **Requirements completeness analysis** — Gap detection across 6 dimensions is currently a manual review process.
4. **Plan quality assessment** — Pre-approval quality checks are limited to deterministic sensors (linter, type-check) that cannot evaluate semantic completeness.
5. **Review depth determination** — Reviewer agents use fixed review depth rather than confidence-gated adaptive review.
6. **Incident severity/operation classification** — Operation stages classify incidents and drift manually.

## Design Principle

**Jev provides inputs, code makes decisions.** The existing deterministic layer (orchestrate, sensors, state machine) remains untouched. A new `aidlc-jev.ts` tool in `core/tools/` shells out to the Jev API with retry/backoff, and stages consume the typed responses at their decision gates.

This follows TypeSafe's core philosophy from [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md):

- Keep deterministic work in code
- Break broad judgments into narrow, typed questions
- Ask independent questions together (parallel evaluation)
- Route on uncertainty (confidence-gated decisions)

## Integration Points

### 1. Composer Agent — ARS Scoring Augmentation

The `aidlc-composer-agent` scores 5 ARS components using heuristic judgment. Jev replaces this with calibrated parallel scores.

**API call:**

```typescript
POST https://api.typesafe.ai/v1/systemone
{
  "model": "jev-latest",
  "state": {
    "task": "<task prompt>",
    "workspace": { "languages": [...], "frameworks": [...], "projectType": "<greenfield|brownfield>" },
    "codekb": { "componentsIndexed": <n>, "spacesCovered": <n> }
  },
  "questions": {
    "intentAmbiguity": {
      "type": "score",
      "instructions": "Rate the ambiguity of the user's intent on a scale from 0 (crystal clear) to 1 (completely vague)",
      "criteria": ["0.0-0.3: Specific, testable acceptance criteria", "0.3-0.7: Some ambiguity, multiple reasonable interpretations", "0.7-1.0: Vague verbs, no clear scope"]
    },
    "structuralUncertainty": {
      "type": "score",
      "instructions": "Rate the structural uncertainty of the affected codebase",
      "criteria": ["Low: Single package, well-documented, clear ownership", "Medium: 2-3 packages, moderate coupling", "High: 5+ packages, high coupling, undocumented legacy"]
    },
    "verificationEntropy": {
      "type": "score",
      "instructions": "Rate the weakness of existing verification evidence",
      "criteria": ["Low: Strong test suite, enforced thresholds, CI per PR", "Medium: Tests exist but uneven coverage", "High: No tests, no coverage config, no CI"]
    },
    "blastRadius": {
      "type": "score",
      "instructions": "Rate the blast radius if the change goes wrong",
      "criteria": ["Low: Internal tool, no external impact, easily reverted", "Medium: Customer-visible but non-financial, reversible", "High: Money, compliance, security, irreversibility"]
    },
    "unresolvedAssumptions": {
      "type": "score",
      "instructions": "Rate how many implicit decisions the system would silently make",
      "criteria": ["Low: Self-contained, few implicit decisions", "Medium: Some gaps identifiable, some inferable", "High: Many implicit decisions, no documented answers"]
    }
  }
}
```

**Code consumption:**

```typescript
const answers = response.answers;
const iae = answers.intentAmbiguity.score;
const csu = answers.structuralUncertainty.score;
// Feed into existing ARS formula: ARS = 100 × [0.20·IAE + 0.30·CSU + 0.25·VE + 0.15·R + 0.10·UA]
```

### 2. Intent Capture — Classification Before Stage Selection

Classify the user's request before the composer selects stages, enabling more accurate stage filtering.

```typescript
{
  "state": { "userRequest": "<raw description>", "document": "<pasted content if any>" },
  "questions": {
    "requestType": {
      "type": "choice",
      "instructions": "What type of initiative is this?",
      "criteria": {
        "newFeature": "Building something that doesn't exist",
        "enhancement": "Improving an existing feature or system",
        "refactoring": "Restructuring existing code without changing behavior",
        "bugfix": "Fixing a defect or regression",
        "migration": "Moving from one platform/technology to another",
        "infrastructure": "Setting up tooling, CI/CD, or platform",
        "securityPatch": "Addressing a vulnerability or compliance gap",
        "investigation": "Exploring a problem without a clear solution path"
      }
    },
    "complexityLevel": {
      "type": "choice",
      "instructions": "How complex is this initiative?",
      "criteria": {
        "simple": "Single component, well-understood domain",
        "moderate": "Multiple stakeholders, some unknowns",
        "complex": "Large scope, significant unknowns, cross-cutting concerns"
      }
    },
    "requiresMarketResearch": {
      "type": "noul",
      "instructions": "Does this initiative require market research or competitive analysis?",
      "criteria": {
        "true": "Building for an unknown or competitive market",
        "false": "Internal tool, known market, or well-defined need"
      }
    }
  }
}
```

**Code consumption:** `requestType.choice` and `complexityLevel.choice` feed directly into the composer's stage-to-ARS mapping. `requiresMarketResearch.noul > 0.7` triggers `market-research` stage inclusion.

### 3. Requirements Analysis — Gap Detection

Parallel evaluation of completeness across 6 dimensions replaces manual analysis.

```typescript
{
  "state": {
    "requirements": requirementsText,
    "functionalReqs": functionalRequirements,
    "nfrTargets": nfrRequirements,
    "constraints": businessConstraints,
    "stakeholders": stakeholderList
  },
  "questions": {
    "functionalGap": {
      "type": "noul",
      "instructions": "Are there gaps in the functional requirements — behaviors or use cases not covered?",
      "criteria": {
        "true": "Missing functional behavior, orphan use cases, or undefined acceptance criteria",
        "false": "All core behaviors covered with clear acceptance criteria"
      }
    },
    "nfrGap": {
      "type": "noul",
      "instructions": "Are non-functional requirements missing or underspecified?",
      "criteria": {
        "true": "No measurable NFR targets or vague statements like 'should be fast'",
        "false": "Specific measurable targets for each NFR dimension"
      }
    },
    "constraintCompleteness": {
      "type": "noul",
      "instructions": "Are technical, business, and organizational constraints fully documented?",
      "criteria": {
        "true": "Missing constraints, unstated assumptions about environment or resources",
        "false": "All constraints explicitly listed with rationale"
      }
    },
    "edgeCaseCoverage": {
      "type": "noul",
      "instructions": "Are error scenarios and edge cases addressed in the requirements?",
      "criteria": {
        "true": "No error scenarios, missing edge cases, or undefined fallback behavior",
        "false": "Error scenarios and edge cases are explicitly covered"
      }
    }
  }
}
```

**Code consumption:** Each `noul` score maps to a specific dimension in the completeness analysis. Low scores trigger follow-up questions before proceeding.

### 4. Code Generation — Pre-Approval Quality Gate

Evaluate the code generation plan for quality before presenting it to the user for approval.

```typescript
{
  "state": {
    "plan": codeGenerationPlan,
    "requirements": requirementsText,
    "testingContract": testingContract,
    "unitOfWork": unitDefinition,
    "projectContext": { languages, frameworks, conventions }
  },
  "questions": {
    "planCompleteness": {
      "type": "noul",
      "instructions": "Does the plan cover all requirements without omissions?",
      "criteria": {
        "true": "Every requirement maps to a plan step",
        "false": "Missing implementation steps or untracked requirements"
      }
    },
    "testStrategyAppropriate": {
      "type": "noul",
      "instructions": "Is the test methodology appropriate for this unit's complexity?",
      "criteria": {
        "true": "Test methodology matches the unit's complexity and the active posture",
        "false": "Mismatch between test methodology and unit characteristics"
      }
    },
    "traceabilitySound": {
      "type": "noul",
      "instructions": "Does every plan step trace back to a specific requirement or story?",
      "criteria": {
        "true": "Each step has explicit story-to-code mapping",
        "false": "Steps exist without clear requirement provenance"
      }
    },
    "nfrCoverage": {
      "type": "noul",
      "instructions": "Does the plan address the non-functional requirements?",
      "criteria": {
        "true": "NFR targets have concrete implementation steps",
        "false": "NFRs mentioned but not addressed in implementation steps"
      }
    }
  }
}
```

**Code consumption:** If any `noul` is below threshold (e.g., `< 0.7`), the plan is flagged and the composer revises before presenting to the user.

### 5. Review Depth Classification

Determine appropriate review depth based on artifact complexity and risk.

```typescript
{
  "state": {
    "artifact": reviewTarget,
    "artifactType": "code-generation-plan" | "requirements" | "intent-statement",
    "priorReviewFindings": previousReviews
  },
  "questions": {
    "reviewDepth": {
      "type": "choice",
      "instructions": "What depth of review is warranted?",
      "criteria": {
        "light": "Minor formatting or style issues only",
        "standard": "Content accuracy and completeness needs checking",
        "deep": "Substantive issues likely — requires thorough adversarial review"
      }
    },
    "escalationRequired": {
      "type": "noul",
      "instructions": "Does this artifact contain issues serious enough to warrant escalation?",
      "criteria": {
        "true": "Critical gaps, contradictions, or unresolved high-risk findings",
        "false": "Issues are fixable by the generating agent"
      }
    }
  }
}
```

### 6. Incident Response — Severity Classification

In `operation/incident-response`, classify incidents and determine response protocol.

```typescript
{
  "state": {
    "incidentDescription": "<description>",
    "monitoringData": { "sloStatus": "...", "errorRate": ... },
    "affectedServices": [...],
    "recentChanges": [...]
  },
  "questions": {
    "severity": {
      "type": "score",
      "instructions": "Rate the severity of this incident",
      "criteria": ["P1: System down, revenue impact", "P2: Degraded performance, partial impact", "P3: Minor issue, workaround exists", "P4: Informational, no user impact"]
    },
    "category": {
      "type": "choice",
      "instructions": "What category does this incident fall into?",
      "criteria": {
        "outage": "Complete service unavailability",
        "performance": "SLO breach or latency degradation",
        "dataCorruption": "Data integrity issue",
        "security": "Security breach or vulnerability exploitation",
        "configuration": "Misconfiguration causing issues",
        "deployment": "Deployment-related failure"
      }
    },
    "runbookExists": {
      "type": "noul",
      "instructions": "Does a suitable runbook already exist for this type of incident?",
      "criteria": {
        "true": "A relevant runbook exists and is current",
        "false": "No runbook exists or it is outdated"
      }
    }
  }
}
```

## Implementation Plan

### Phase 1: Tool Layer

Create `core/tools/aidlc-jev.ts`:

- HTTP client wrapper for `POST https://api.typesafe.ai/v1/systemone`
- Retry with exponential backoff (handles 429/529)
- Timeout handling (default 30s per question batch)
- Auth via `TYPESAFE_API_KEY` env var
- Structured error types matching the Jev API error schema

```typescript
export async function evaluate(
  state: object,
  questions: Record<string, Question>,
  model?: string
): Promise<JevResponse>
```

### Phase 2: Unit Tests

- Test the HTTP client (mock API, test retries, timeouts)
- Test question serialization and response parsing
- Test rate limit handling
- Add to existing test suite (`tests/unit/`)

### Phase 3: Stage Integration

1. **Composer** — Add Jev evaluation before `{{INVOKE}} engine graph ars`
2. **Intent Capture** — Add classification questions in Step 2
3. **Requirements Analysis** — Add gap detection in Step 5
4. **Code Generation** — Add quality gate in Step 3 (before plan approval)
5. **Operation stages** — Add classification in relevant steps

### Phase 4: Documentation

- Add to `docs/reference/research/jev/`
- Update `docs/harness-engineering/` guides
- Add to `aidlc-knowledge/` agent memory files

## What Jev Would NOT Replace

| Existing Component | Why It Stays |
|---|---|
| `aidlc-orchestrate.ts` | Deterministic routing stays in code |
| `aidlc-sensor.ts` + sensors | Linting, type-checking, claim-source validation are reliable and cheap |
| `aidlc-utility.ts` | Project description, document input — deterministic reads |
| `aidlc-graph.ts` | Stage graph compilation — pure computation |
| Stage transitions | Controlled by `report` command, never by Jev |
| `aidlc-state.ts` | State management — deterministic |

## Dependencies

- TypeSafe API key via `TYPESAFE_API_KEY` env var (consistent with existing `bun run` tool patterns)
- Network access to `api.typesafe.ai`
- One new TypeScript dependency: `@typesafe/sdk` or raw `fetch` (no new dependency if using native `fetch`)

## Benefits

1. **Calibrated uncertainty** — Jev's probability distributions enable confidence-gated routing (`if (answers.escalationRequired.noul > 0.8) → escalate`)
2. **Parallel evaluation** — Multiple judgments in one API call (~100ms), no serial round trips
3. **Typed outputs** — Code consumes structured JSON, never parses prose
4. **Reversible** — If Jev proves unreliable, the integration is a thin layer that can be removed
5. **Composable** — Each stage independently opts into Jev questions; no monolithic change
6. **Cost-effective** — Target >100× intelligence-to-speed-and-cost ratio per TypeSafe's design

## Concerns to Address

- **External API dependency** — The Jev API is a third-party service. Mitigation: the tool has timeouts, retries, and degrades gracefully. If the API is unavailable, stages fall back to heuristic scoring.
- **Cost at scale** — Multiple Jev calls per workflow could add up. Mitigation: parallel evaluation means one API call per stage, and stages can be configured to only call Jev when needed.
- **Model calibration** — Jev's probabilities are calibrated on average, not guaranteed per prediction. Mitigation: confidence thresholds can be tuned based on actual performance in the AI-DLC domain.
- **Determinism concerns** — AI-DLC values deterministic reproducibility. Mitigation: Jev scores are advisory inputs to the ARS formula; they don't replace the deterministic engine.

## References

- [TypeSafe System One Documentation](https://docs.typesafe.ai/concepts/system-one.md)
- [How to Build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md)
- [Jev API Reference](https://docs.typesafe.ai/api.md)
- [TypeSafe Primitives](https://docs.typesafe.ai/primitives.md)
- [Confidence](https://docs.typesafe.ai/confidence.md)
- [AI-DLC Project Structure](AGENTS.md)
