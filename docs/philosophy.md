# Philosophy

## Build to understand

The premise of this lab is simple: you don't actually understand a distributed systems concept until you've built a small version of it and watched it fail.

Reading is necessary but insufficient. I can read ten articles about rate limiting and nod along. The understanding happens when I send 100 concurrent requests at the boundary of a token refill window and realize my counter went negative because I forgot about race conditions.

## How experiments are chosen

An experiment earns a spot here when:

1. The concept shows up in real systems (not academic curiosities)
2. There's a failure mode worth seeing, not just reading about
3. Building it small still teaches the core lesson
4. The theory-to-practice gap is big enough to be interesting

If a concept is better explained than demonstrated (like CAP theorem trade-offs in the abstract), it belongs in the [notes repo](https://github.com/nisanth-alla/system-design-notes), not here.

## The learning loop

Every experiment follows the same cycle:

```
Define the problem
    ↓
Research how production systems solve it
    ↓
Design a minimal version
    ↓
Build it
    ↓
Test the happy path
    ↓
Break it (on purpose)
    ↓
Understand why it broke
    ↓
Fix it
    ↓
Write down what was surprising
```

The "write down what was surprising" step is the most important one. That's where the understanding lives. The code is just the vehicle.

## Two languages, different strengths

Experiments use TypeScript or Go depending on the problem:

- **TypeScript** when the lesson is about patterns, protocols, or architecture. The async model is good for simulating network behavior, event-driven systems, and API-level concerns. Also the language I know deeply, so I can focus on the distributed systems problem instead of fighting syntax.

- **Go** when the lesson is about concurrency, performance, or systems-level behavior. Goroutines and channels map naturally to worker pools, service health checks, and parallel processing. I'm learning Go alongside building these experiments, so the Go sections also document the language learning process.

The choice is never "let me show the same thing in two languages." Each experiment picks the tool that fits the problem.

## Connection to other projects

This lab doesn't exist in isolation:

- **[System Design Notes](https://github.com/nisanth-alla/system-design-notes)** covers the theory: what caching is, when to use queues, how consistency models differ. Those notes give you the vocabulary. This lab gives you the intuition.

- **[Reliable Job Platform](https://github.com/nisanth-alla/reliable-job-platform)** is where these lessons scale up. It's a production-style job processing system that applies rate limiting, retry strategies, idempotency, and queue management at project scale. The lab experiments informed its design.

## Learning in public

Everything here is published as I learn it. Some experiments will have rough edges. Some design decisions might be wrong and get revised later. That's the point. A polished result with no visible process doesn't teach anyone anything.

If you spot something wrong, an edge case I missed, or a better approach, open an issue. That kind of feedback makes the next version of the experiment better.
