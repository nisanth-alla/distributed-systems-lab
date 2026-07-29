# Concurrent File Processor

## Problem

You have 10,000 log files to parse. Or 5,000 images to resize. Or 2,000 CSV reports to generate. Processing them one at a time takes hours. Your machine has 8 CPU cores sitting idle.

This is a classic parallelization problem: the work units are independent (processing file A doesn't affect file B), so you can do many at once. But you can't just fire off 10,000 tasks simultaneously. You'll exhaust memory, overload the disk, and actually get *slower* because of context switching overhead.

What you need is a worker pool: a fixed number of goroutines that pull tasks from a queue, process them, and report results. The pool size controls the concurrency level. The queue provides backpressure so the producer can't flood the system.

This is exactly the kind of problem Go was designed for. Goroutines are cheap (2KB each), channels provide safe communication between them, and the runtime schedules them across OS threads automatically. The same thing in Node requires heavy worker_threads; in Java it's ExecutorService plus a bunch of boilerplate.

## What you'll learn

1. How goroutines work (lightweight threads, not OS threads)
2. How channels connect goroutines (typed pipes for sending data)
3. The fan-out/fan-in pattern (one producer, many workers, one collector)
4. Backpressure through buffered channels (prevent memory overflow)
5. Graceful shutdown through context cancellation (finish current work, don't get killed)
6. sync.WaitGroup for coordinating goroutine completion

## How to run

From the `experiments/go/` directory:

```bash
# Default: 4 workers, 100 tasks
go run ./cmd/worker-pool

# Customize
go run ./cmd/worker-pool -workers 8 -tasks 200 -buffer 20
```

### The comparison that matters

Run the same workload with different worker counts and compare:

```bash
# Sequential (1 worker, no concurrency)
go run ./cmd/worker-pool -workers 1 -tasks 50

# 4 workers
go run ./cmd/worker-pool -workers 4 -tasks 50

# 8 workers
go run ./cmd/worker-pool -workers 8 -tasks 50
```

Watch the total duration and throughput. With 1 worker processing tasks that take 50-300ms each, 50 tasks takes around 8-10 seconds. With 8 workers, it drops to about 1-2 seconds. That's the whole point.

### Backpressure demo

```bash
# Tight buffer: producer blocks after 1 queued task
go run ./cmd/worker-pool -workers 2 -tasks 50 -buffer 1

# Large buffer: producer can queue 50 ahead
go run ./cmd/worker-pool -workers 2 -tasks 50 -buffer 50
```

The throughput is similar, but with buffer 1, the producer spends more time blocked waiting for workers. With buffer 50, the producer finishes instantly and workers drain the queue.

### Failure handling

```bash
# 20% of tasks fail (default)
go run ./cmd/worker-pool -tasks 50

# 50% failure rate
go run ./cmd/worker-pool -tasks 50 -fail 0.5
```

Failed tasks produce a result with `Success: false` and the error message. The pool keeps going. No one failure takes down the pipeline.

### Graceful shutdown

Start a long run and press Ctrl+C:

```bash
go run ./cmd/worker-pool -workers 2 -tasks 500
# Press Ctrl+C after a few seconds
```

Workers finish their current task, then exit. The summary shows how many completed before shutdown. No goroutine gets killed mid-processing.

## What to watch for

1. **Diminishing returns.** Going from 1 to 4 workers gives roughly 4x speedup. Going from 4 to 8 gives less than 2x. Going from 8 to 16 might give almost nothing. The bottleneck shifts from processing to coordination overhead.

2. **Worker utilization.** With 8 workers and 10 tasks, some workers only process 1 task while others process 2. With 8 workers and 1000 tasks, the distribution evens out.

3. **Output interleaving.** Workers print results as they finish. With multiple workers, the output interleaves. Worker 3 might print between two of worker 1's results. This is what concurrent output looks like in practice.

4. **Graceful shutdown timing.** When you Ctrl+C, the shutdown message appears, then workers finish their current tasks. If a task has 200ms left, you wait 200ms. The "finishing current tasks..." message is not instant.

## Edge cases worth trying

**More workers than tasks.** `go run ./cmd/worker-pool -workers 20 -tasks 5`. Some workers never get a task. The summary shows "Workers used: 5" even though 20 were started.

**Zero buffer.** Not directly supported (minimum is 1 in the code), but conceptually: an unbuffered channel means every send blocks until a receiver is ready. Maximum backpressure, no queuing at all.

**Very fast tasks.** `go run ./cmd/worker-pool -tasks 1000`. With simulated times of 50-300ms, 1000 tasks with 4 workers finishes in about 40 seconds. The throughput number stays steady because the workers are always busy.

## Go concepts in this codebase

If you're new to Go, here's where each concept shows up:

| Concept | Where to look | What it does |
|---|---|---|
| Goroutines | `pool.go:96` | `go p.worker(...)` launches a worker |
| Channels | `pool.go:68-69` | `tasks` and `results` channels connect producer/workers/collector |
| Buffered channels | `pool.go:68` | `make(chan Task, bufferSize)` creates a channel with a buffer |
| for-range on channel | `pool.go:167` | `for task := range p.tasks` reads until channel is closed |
| close(channel) | `pool.go:135` | Signals "no more data" to receivers |
| sync.WaitGroup | `pool.go:85-91` | Tracks when all workers are done |
| sync.Mutex | `pool.go:46`, `reporter.go:18` | Protects shared state from concurrent access |
| context.Context | `pool.go:79`, `main.go:69` | Propagates cancellation for graceful shutdown |
| defer | `pool.go:165` | `defer wg.Done()` runs when the function returns |
| Struct methods | `task.go:64` | `func (t Task) ProcessTask(...)` is a method on Task |
| Pointers | `pool.go:59` | `*Pool` means "pointer to Pool" |
| Slices | `generator.go:21` | `make([]Task, 0, count)` creates a dynamic array |

## Lessons learned

1. The speedup from adding workers isn't linear forever. Going from 1 to 4 gives close to 4x improvement. Going from 8 to 16 gives almost nothing because the simulated work is short enough that coordination overhead starts to matter. In a real system, the bottleneck would shift from CPU to disk I/O or network well before you hit 16 workers.

2. Channel buffer size is a tuning parameter, not a set-and-forget value. Buffer too small and the producer spends time blocked. Buffer too large and you're queuing work in memory that might never get processed if the program shuts down. For this experiment, 10 was a good default, but the right number depends on your task size and processing time.

3. `context.Context` for cancellation felt like overhead at first but proved its value immediately. Without it, Ctrl+C would kill goroutines mid-work. With it, workers finish their current task and exit cleanly. The two lines of code to wire it up (`context.WithCancel` + `signal.Notify`) save you from data corruption in any real system.

4. The `for task := range channel` pattern is one of those things that makes Go click. The channel closes, the loop exits, the goroutine ends. No polling, no "are we done yet?" checks, no cleanup. The control flow is implicit in the channel lifecycle.

See [docs/design-decisions.md](docs/design-decisions.md) for the reasoning behind the architecture.
