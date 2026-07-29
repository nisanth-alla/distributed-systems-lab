// Package workerpool implements a concurrent file processor using Go's
// goroutines and channels.
//
// If you're coming from Node/TypeScript, here's the mental model shift:
//
// In Node, you have one thread and everything is async/await. Concurrency
// happens through the event loop: while one I/O operation waits, another
// can run. But CPU-bound work blocks everything because there's only one
// thread.
//
// In Go, goroutines are lightweight threads managed by the Go runtime.
// You can spin up thousands of them cheaply. They communicate through
// channels (typed pipes that goroutines send to and receive from).
// This "don't share memory, share by communicating" model is what makes
// Go's concurrency different from traditional threading with mutexes.
package workerpool

import (
	"fmt"
	"math/rand"
	"time"
)

// Task represents a unit of work. In a real system this would be a file
// path to process, an image to resize, a log entry to parse, etc.
//
// Go uses structs instead of classes. No inheritance, no constructors.
// You define fields, and methods are functions with a receiver.
type Task struct {
	ID       int
	Filename string
	SizeKB   int
	// SimulateMs controls how long "processing" takes. In a real system
	// this would be actual I/O time. Here we fake it to demonstrate
	// concurrency behavior without needing real files.
	SimulateMs int
	// ShouldFail lets us inject failures into specific tasks to test
	// error handling in the worker pool.
	ShouldFail bool
}

// Result is what a worker produces after processing a task.
// Every task produces exactly one result, whether it succeeded or failed.
type Result struct {
	TaskID     int
	Filename   string
	WorkerID   int
	Success    bool
	Message    string
	DurationMs int64
	StartedAt  time.Time
	FinishedAt time.Time
}

// ProcessTask simulates processing a file. In a real system this might be:
// - Parsing a log file and extracting metrics
// - Resizing an image to multiple sizes
// - Compressing a file
// - Running a validation check
//
// The method signature: func (t Task) ProcessTask(workerID int) Result
// means "ProcessTask is a method on Task." The (t Task) part is called
// a "receiver." It's like `this` in TypeScript, but explicit.
func (t Task) ProcessTask(workerID int) Result {
	start := time.Now()

	// Simulate processing time. time.Sleep pauses the current goroutine
	// but doesn't block other goroutines. This is a key difference from
	// Node's synchronous sleep (which blocks the event loop). Each goroutine
	// has its own stack and can sleep independently.
	processingTime := time.Duration(t.SimulateMs) * time.Millisecond

	// Add some jitter so processing times aren't perfectly uniform.
	// rand.Intn returns a random int in [0, n). This makes the demo
	// output more realistic.
	jitter := time.Duration(rand.Intn(50)) * time.Millisecond
	time.Sleep(processingTime + jitter)

	if t.ShouldFail {
		return Result{
			TaskID:     t.ID,
			Filename:   t.Filename,
			WorkerID:   workerID,
			Success:    false,
			Message:    fmt.Sprintf("failed to process %s: simulated I/O error", t.Filename),
			DurationMs: time.Since(start).Milliseconds(),
			StartedAt:  start,
			FinishedAt: time.Now(),
		}
	}

	return Result{
		TaskID:     t.ID,
		Filename:   t.Filename,
		WorkerID:   workerID,
		Success:    true,
		Message:    fmt.Sprintf("processed %s (%d KB)", t.Filename, t.SizeKB),
		DurationMs: time.Since(start).Milliseconds(),
		StartedAt:  start,
		FinishedAt: time.Now(),
	}
}
