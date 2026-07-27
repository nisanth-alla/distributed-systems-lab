# Distributed Systems Lab

Hands-on experiments in distributed systems. Each one isolates a real problem (rate limiting, event pipelines, concurrent processing, service discovery), builds a working solution, breaks it on purpose, and documents what happened.

Not a tutorial collection. Every experiment starts with a problem, builds something small to solve it, triggers the failure modes that matter, and records the gap between what you expect and what actually happens.

## Why this exists

I kept reading about distributed systems concepts and thinking I understood them. Token bucket rate limiting made total sense until I tried to handle burst traffic at the edge of a refill window. The saga pattern was clear until I had to decide what "compensate a failed shipping step after payment already succeeded" actually looks like in code.

This lab is where I build the small versions and find out what the theory didn't mention. If you're studying distributed systems or prepping for system design interviews, the experiments are meant to be useful for you too.

## How experiments work

Every experiment follows the same shape:

1. **Problem** — a real scenario that needs this system
2. **Approach** — the design, with tradeoffs decided before writing code
3. **Build** — working code you can run locally
4. **Break** — deliberate failure injection to see what goes wrong
5. **Fix** — the improvement, with before/after comparison
6. **Document** — what I learned, edge cases, and what changes at scale

Each one has its own README, runnable code, and a design decisions doc that explains the *why*.

## Experiments

| Experiment | Language | Problem | Status |
|---|---|---|---|
| [Rate Limiter](experiments/ts/rate-limiter/) | TypeScript | Protecting an API from burst and sustained overload | Active |
| Event-Driven Order Pipeline | TypeScript | Order processing with saga pattern and failure compensation | Planned |
| Concurrent File Processor | Go | Processing thousands of files in parallel with backpressure | Planned |
| Health Check & Service Registry | Go | How services find each other and detect failures | Planned |

## Connected projects

This lab is part of a bigger picture:

- **[Reliable Job Platform](https://github.com/nisanth-alla/reliable-job-platform)** — the full-scale project that grew out of these experiments. Production-style job processing with queuing, retries, idempotency, and monitoring. Design decisions here fed directly into that system.
- **[System Design Notes](https://github.com/nisanth-alla/system-design-notes)** — the theory side. Structured notes on caching, queues, consistency, retries, and more, with runnable demos and interactive visualizations. Where this lab is "build and break," the notes are "explain and organize."

Experiments here test ideas in practice. Notes document the concepts. The job platform applies them at project scale.

## Roadmap

- [x] Repo structure and documentation
- [x] Rate limiter experiment (TypeScript)
- [ ] Event-driven order pipeline (TypeScript)
- [ ] Concurrent file processor (Go)
- [ ] Service registry and health checks (Go)
- [ ] Interactive learning site with animated visualizations

See [docs/roadmap.md](docs/roadmap.md) for the detailed plan.

## Repo structure

```
distributed-systems-lab/
├── docs/
│   ├── philosophy.md         # Why this lab exists
│   └── roadmap.md            # Phased plan with milestones
├── experiments/
│   ├── ts/                   # TypeScript experiments
│   │   └── rate-limiter/     # API rate limiting (two strategies)
│   └── go/                   # Go experiments (coming)
├── site/                     # Interactive learning site (coming)
├── CONTRIBUTING.md           # How experiments are structured
└── README.md
```

## Running an experiment

Each experiment is self-contained. Go to its directory, install, and follow the README:

```bash
cd experiments/ts/rate-limiter
npm install
npm run dev

# In another terminal:
npm run burst      # 100 requests in 1 second
npm run sustained  # Steady 10 req/sec for 30 seconds
```

Every experiment README tells you what to expect and what edge cases are worth trying.

## License

MIT
