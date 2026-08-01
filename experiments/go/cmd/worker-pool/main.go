// Command worker-pool runs the concurrent file processor experiment.
//
// Usage:
//
//	go run ./cmd/worker-pool
//	go run ./cmd/worker-pool -workers 8 -tasks 200 -buffer 20
//	go run ./cmd/worker-pool -workers 1 -tasks 50     (sequential baseline)
//	go run ./cmd/worker-pool -workers 16 -tasks 500    (high concurrency)
//	go run ./cmd/worker-pool -fail 0.2                 (20% failure rate)
//
// The interesting comparison is changing the worker count.
// With 1 worker, tasks process sequentially. With 4 or 8, you'll see
// the total time drop proportionally (until you hit diminishing returns).
//
// Try it:
//
//	go run ./cmd/worker-pool -workers 1 -tasks 50
//	go run ./cmd/worker-pool -workers 4 -tasks 50
//	go run ./cmd/worker-pool -workers 8 -tasks 50
//
// Compare the throughput numbers.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	workerpool "github.com/nisanth-alla/distributed-systems-lab/experiments/go/worker-pool"
)

func main() {
	// flag is Go's built-in CLI argument parser. Each flag.Int/Float64
	// returns a pointer. The arguments are: flag name, default value,
	// help text. After flag.Parse(), the pointers point to the actual values.
	workers := flag.Int("workers", 4, "number of concurrent workers")
	tasks := flag.Int("tasks", 100, "number of files to process")
	buffer := flag.Int("buffer", 10, "task channel buffer size (backpressure)")
	failRate := flag.Float64("fail", 0.1, "fraction of tasks that fail (0.0 to 1.0)")

	flag.Parse()

	fmt.Println("Concurrent File Processor")
	fmt.Println("=========================")
	fmt.Printf("  Workers:    %d\n", *workers)
	fmt.Printf("  Tasks:      %d\n", *tasks)
	fmt.Printf("  Buffer:     %d\n", *buffer)
	fmt.Printf("  Fail rate:  %.0f%%\n", *failRate*100)
	fmt.Println()

	// Generate tasks
	taskList := workerpool.GenerateTasks(*tasks, *failRate)

	// Set up graceful shutdown.
	//
	// context.WithCancel gives us a ctx and a cancel function.
	// When cancel() is called, ctx.Done() returns a closed channel,
	// which unblocks any goroutine waiting on it (like our workers).
	//
	// os/signal.Notify routes OS signals (Ctrl+C = SIGINT, kill = SIGTERM)
	// to a channel. When we receive one, we call cancel().
	//
	// This is the standard Go pattern for graceful shutdown. Workers
	// finish their current task, then exit. No goroutine gets killed
	// mid-work.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Launch signal handler in a goroutine. If Ctrl+C is pressed,
	// it calls cancel() which propagates to all workers through the
	// context.
	go func() {
		sig := <-sigChan
		fmt.Printf("\n\n[shutdown] received %s, finishing current tasks...\n", sig)
		cancel()
	}()

	// Create and run the pool
	pool := workerpool.NewPool(*workers, *buffer)
	reporter := workerpool.NewReporter(len(taskList))

	fmt.Println("Processing:")
	pool.Run(ctx, taskList, reporter.OnResult)

	reporter.Summary()

	fmt.Println()
	fmt.Println("Things to try:")
	fmt.Println("  go run ./cmd/worker-pool -workers 1 -tasks 50   # sequential baseline")
	fmt.Println("  go run ./cmd/worker-pool -workers 8 -tasks 50   # 8x concurrency")
	fmt.Println("  go run ./cmd/worker-pool -workers 4 -buffer 1   # tight backpressure")
	fmt.Println("  go run ./cmd/worker-pool -fail 0.5              # 50% failure rate")
	fmt.Println("  Press Ctrl+C during a run to test graceful shutdown")
}
