# Design Decisions: Concurrent File Processor

## Why Go for this experiment?

This experiment is about parallel processing with backpressure and graceful shutdown. Go's concurrency model (goroutines + channels) maps directly to the problem. A worker pool in Go is about 100 lines. The same thing in Node requires worker_threads (heavy, limited), a thread pool library, or clustering. In Java it's ExecutorService plus CompletableFuture plus try-with-resources boilerplate.

Go goroutines cost about 2KB of stack each. You can start 100,000 of them without thinking about it. Node worker_threads are actual OS threads and cost megabytes each. That's why Go is the natural choice when the core problem is "do many things at the same time."

## Channel-based architecture

The pool uses three components connected by two channels:

```
producer  --[tasks channel]-->  workers  --[results channel]-->  collector
```

The alternative would be a shared task queue protected by a mutex. Workers lock the queue, grab a task, unlock it. This works but has a problem: lock contention. Under heavy load, workers spend time waiting for the lock instead of doing work.

Channels avoid this. The Go runtime handles the synchronization internally, and the semantics are cleaner: "send a task into the pipe" instead of "lock the queue, check if empty, pop, unlock."

## Buffered channels for backpressure

The tasks channel has a configurable buffer size. If you set it to 10, the producer can queue up 10 tasks ahead of the workers. Once the buffer is full, the producer blocks until a worker picks something up.

Why this matters: without backpressure, a fast producer could generate millions of tasks and fill up memory before workers process any of them. The buffer bounds the memory usage. In a real system, this is the difference between a stable pipeline and an OOM crash.

Try `go run ./cmd/worker-pool -workers 2 -tasks 100 -buffer 1` to see tight backpressure. The producer can only add one task at a time, so it's always waiting for workers.

## Fan-out / fan-in pattern

This is a named concurrency pattern:

- **Fan-out:** One producer sends tasks to N workers. Work is distributed.
- **Fan-in:** N workers send results to one collector. Results are gathered.

The pattern is general. It works for file processing, HTTP request handling, data pipeline stages, image processing, and anything where units of work are independent.

## Graceful shutdown via context

Go's `context.Context` is the standard way to propagate cancellation. When the user presses Ctrl+C, the signal handler calls `cancel()`, which closes the context's `Done()` channel. Every worker checks this channel before starting a new task.

The key property: workers finish their current task before exiting. No goroutine gets killed mid-processing. This matters when the "processing" involves writing to a database or an external API. Killing mid-write leaves inconsistent state.

The alternative (just calling `os.Exit()`) is simpler but dangerous in production. Any in-progress I/O gets abandoned.

## sync.WaitGroup for coordination

WaitGroup is Go's simplest coordination primitive. It's a counter:
- `Add(1)` increments it (before starting a goroutine)
- `Done()` decrements it (when the goroutine finishes)
- `Wait()` blocks until the counter reaches zero

This is how the pool knows all workers have finished. Without it, the main function might return (and the program would exit) before workers are done.

## What I'd add next

1. **Dynamic worker scaling.** Monitor the task queue depth. If it's consistently full, add workers. If workers are idle, remove some. This is what Kubernetes HPA does at the container level.
2. **Real file processing.** Replace the simulated delay with actual file I/O. Go's `io` and `os` packages make this straightforward. The interesting part is whether the bottleneck shifts from CPU to disk I/O.
3. **Retry failed tasks.** Currently, failed tasks produce a result and move on. A retry queue that re-processes failed tasks (with a limit) would be more realistic.
4. **Metrics and monitoring.** Export throughput, error rate, and queue depth as Prometheus metrics.
