# Roadmap

Phased plan for the lab. Each phase adds one experiment and its documentation. The interactive site comes after the experiments exist, so the visualizations have real systems to animate.

## Phase 1: Rate Limiter (TypeScript)

Protect an API from abuse without blocking legitimate users.

- [x] Token bucket implementation
- [x] Sliding window counter implementation
- [x] Switchable middleware (swap strategies at runtime)
- [x] Load test scripts (burst and sustained traffic)
- [x] WebSocket event broadcaster (for future visualization)
- [x] Design decisions document
- [ ] Edge case: distributed rate limiting across multiple server instances

## Phase 2: Event-Driven Order Pipeline (TypeScript)

Model an e-commerce order that flows through payment, inventory, shipping, and notification stages via an event bus.

- [x] Event bus with pub/sub
- [x] Order saga with compensation logic
- [x] Deliberate failure injection (shipping fails after payment succeeds)
- [x] Compensation handler (refund on downstream failure)
- [ ] Dead letter queue for unprocessable events
- [x] Design decisions: choreography vs orchestration

## Phase 3: Concurrent File Processor (Go)

Process thousands of files in parallel using goroutines and channels.

- [x] Worker pool with configurable concurrency
- [x] Fan-out / fan-in pattern
- [x] Backpressure via bounded channels
- [x] Graceful shutdown on SIGINT
- [x] Progress reporting
- [x] Design decisions: why Go's concurrency model fits this problem

## Phase 4: Health Check & Service Registry (Go)

Services register themselves, send heartbeats, and get removed when they stop responding.

- [ ] Service registration and heartbeat endpoint
- [ ] TTL-based health expiry
- [ ] Service discovery (query healthy instances)
- [ ] Deliberate failure: kill a service, watch deregistration
- [ ] Design decisions: the problem this solves before you reach for Consul or Kubernetes

## Phase 5: Interactive Learning Site

A single-page app with animated visualizations for each experiment.

- [ ] Site scaffold (Vite + React + TypeScript)
- [ ] Rate limiter visualization (requests flowing, getting accepted/rejected)
- [ ] Order pipeline visualization (events flowing through stages, failure + compensation)
- [ ] File processor visualization (goroutines, channels, work distribution)
- [ ] Service registry visualization (heartbeats, timeouts, deregistration)
- [ ] Deploy to GitHub Pages
- [ ] Link from portfolio

## Future ideas (not committed)

- Cross-experiment comparisons ("when would you pick X over Y?")
- Chaos engineering experiments (network partitions, clock skew)
- Distributed consensus (Raft, simplified)
- Load balancer strategies (round robin, least connections, consistent hashing)
