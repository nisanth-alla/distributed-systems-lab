# Contributing

How experiments are structured in this repo. If you want to add one, follow this template.

## Experiment directory layout

TypeScript experiments share a single `package.json` and `tsconfig.json` at `experiments/ts/`. Go experiments share a single `go.mod` at `experiments/go/`. Individual experiments contain only source code, scripts, and docs:

```
experiments/ts/
├── package.json               # shared deps for all TS experiments
├── tsconfig.json              # shared config
├── rate-limiter/
│   ├── README.md
│   ├── src/
│   ├── scripts/
│   └── docs/
│       └── design-decisions.md
└── order-pipeline/
    ├── README.md
    ├── src/
    ├── scripts/
    └── docs/
        └── design-decisions.md

experiments/go/
├── go.mod                     # shared module for all Go experiments
├── cmd/
│   └── worker-pool/
│       └── main.go            # entry point (package main)
└── worker-pool/
    ├── README.md
    ├── *.go                   # library code (package workerpool)
    └── docs/
        └── design-decisions.md
```

## README template

Every experiment README should have these sections, in this order:

### Problem
What real-world situation creates the need for this? Not "I want to learn X" but "A system is doing Y and it breaks because of Z." Ground it in something concrete.

### Approach
How you chose to solve it. What alternatives you considered and why you picked this one. This section should exist *before* the code, because the thinking matters more than the implementation.

### How to run
Exact commands. Someone should be able to copy-paste and see results in under a minute.

### What to expect
What does the output look like? What should the reader watch for?

### Edge cases
The interesting stuff. What happens at boundaries? What breaks if you change an assumption? This is where the experiment earns its keep.

### Lessons learned
What surprised you. What the theory didn't cover. What you'd do differently at scale.

## Design decisions document

Each experiment also has a `docs/design-decisions.md` that covers:

1. What alternatives existed
2. Why you picked this approach
3. What you give up with this choice
4. When the other option would be better
5. What changes if this runs in production at scale

This is separate from the README because the README is about the experiment. The design doc is about the thinking.

## Code standards

**TypeScript experiments:**
- Strict mode, no `any`
- Express for HTTP when needed
- `ws` for WebSocket broadcasting (for future visualizations)
- `ts-node` for running directly, no build step needed

**Go experiments:**
- Standard library first. External dependencies only when the standard library genuinely doesn't cover it.
- `go fmt` and `go vet` clean
- Document the Go-specific learning in the README if it's relevant

## What makes a good experiment

A concept gets an experiment when:

1. There's a failure mode worth *seeing*, not just reading about
2. Building it small still teaches the core lesson
3. The gap between "I read about this" and "I tried it" is meaningful
4. It solves a real problem, not an academic exercise

If the concept is better explained than demonstrated, it probably belongs in [system-design-notes](https://github.com/nisanth-alla/system-design-notes) as a written note instead.
