package workerpool

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Pool is the concurrent worker pool. This is the core of the experiment.
//
// The architecture uses three channels:
//
//   tasks channel                    results channel
//   ┌──────────┐    ┌─────────┐    ┌──────────┐
//   │ producer │───>│ workers │───>│ collector│
//   └──────────┘    └─────────┘    └──────────┘
//                    (N goroutines)
//
// 1. The producer sends tasks into the tasks channel.
// 2. N worker goroutines read from the tasks channel and process them.
// 3. Each worker sends its result into the results channel.
// 4. The collector reads results and records them.
//
// The tasks channel has a buffer size (backpressure). If the buffer is
// full, the producer blocks until a worker picks up a task. This prevents
// the producer from flooding memory if it generates tasks faster than
// workers can process them.
//
// Key Go concepts at play:
// - goroutines: lightweight threads (the workers)
// - channels: typed pipes for communication between goroutines
// - sync.WaitGroup: a counter that blocks until N goroutines finish
// - context.Context: for cancellation and graceful shutdown
type Pool struct {
	workerCount    int
	bufferSize     int
	tasks          chan Task
	results        chan Result
	collectedResults []Result

	// mu protects collectedResults from concurrent writes.
	// In Go, if two goroutines access the same variable and at least
	// one writes to it, you need synchronization. A Mutex is the simplest
	// option. Lock() before writing, Unlock() after.
	mu sync.Mutex
}

// NewPool creates a worker pool.
//
// workerCount: how many goroutines process tasks concurrently.
// bufferSize: how many tasks can queue up before the producer blocks.
//
// Go convention: constructor functions are named New<Type> and return
// a pointer. There are no classes or `new` keyword. A pointer (*Pool)
// means "this function gives you a reference to a Pool, and you can
// modify it through that reference." Without the pointer, you'd get
// a copy and changes wouldn't stick.
func NewPool(workerCount, bufferSize int) *Pool {
	return &Pool{
		workerCount: workerCount,
		bufferSize:  bufferSize,
		// make(chan Task, bufferSize) creates a buffered channel.
		// A buffered channel can hold `bufferSize` items before
		// sends block. An unbuffered channel (make(chan Task))
		// blocks on every send until a receiver is ready.
		// The buffer is our backpressure mechanism.
		tasks:   make(chan Task, bufferSize),
		results: make(chan Result, bufferSize),
	}
}

// Run processes all tasks and returns the results.
//
// ctx is Go's standard cancellation mechanism. If someone calls
// cancel() on the context (like on Ctrl+C), all workers will
// notice and stop. This is how Go handles graceful shutdown
// without killing goroutines mid-work.
func (p *Pool) Run(ctx context.Context, taskList []Task, onResult func(Result)) []Result {
	startTime := time.Now()

	// sync.WaitGroup tracks how many goroutines are still working.
	// Add(N) sets the counter. Each worker calls Done() when finished.
	// Wait() blocks until the counter hits zero.
	var wg sync.WaitGroup

	// Start workers. Each worker is a goroutine that reads from the
	// tasks channel in a loop. When the channel is closed (meaning
	// no more tasks), the for-range loop exits and the goroutine ends.
	for i := 1; i <= p.workerCount; i++ {
		wg.Add(1)
		// `go` launches a goroutine. It's like calling a function but
		// it runs concurrently. The runtime schedules it across OS threads.
		// Unlike Node's worker_threads, goroutines are extremely cheap:
		// ~2KB of stack each. You can run millions of them.
		go p.worker(ctx, i, &wg)
	}

	// Start the result collector in its own goroutine.
	// It reads from the results channel and calls onResult for each one.
	var collectWg sync.WaitGroup
	collectWg.Add(1)
	go func() {
		defer collectWg.Done()
		for result := range p.results {
			p.mu.Lock()
			p.collectedResults = append(p.collectedResults, result)
			p.mu.Unlock()
			if onResult != nil {
				onResult(result)
			}
		}
	}()

	// Send tasks into the tasks channel. This is the producer.
	// If the buffer is full, this blocks until a worker picks one up.
	// That's backpressure in action.
	tasksSent := 0
	cancelled := false
	for _, task := range taskList {
		// Check if the context was cancelled (e.g., Ctrl+C)
		select {
		case <-ctx.Done():
			fmt.Printf("\n[pool] cancelled after sending %d/%d tasks\n", tasksSent, len(taskList))
			cancelled = true
		case p.tasks <- task:
			tasksSent++
		}
		if cancelled {
			break
		}
	}

	// Close the tasks channel. This signals to workers that no more
	// tasks are coming. Their for-range loops will exit after processing
	// whatever is left in the buffer.
	close(p.tasks)

	// Wait for all workers to finish processing.
	wg.Wait()

	// Close the results channel. This signals to the collector that
	// no more results are coming.
	close(p.results)

	// Wait for the collector to finish recording all results.
	collectWg.Wait()

	elapsed := time.Since(startTime)
	fmt.Printf("\n[pool] finished %d tasks in %s with %d workers\n",
		len(p.collectedResults), elapsed.Round(time.Millisecond), p.workerCount)

	return p.collectedResults
}

// worker is the function each goroutine runs. It reads tasks from the
// tasks channel, processes them, and sends results to the results channel.
//
// The for-range on a channel is idiomatic Go: it reads values until the
// channel is closed, then the loop exits. No need for manual "is there
// more data?" checks.
//
// defer wg.Done() means "call wg.Done() when this function returns."
// defer is Go's version of try/finally. It runs no matter how the
// function exits (normal return, panic, etc.)
func (p *Pool) worker(ctx context.Context, id int, wg *sync.WaitGroup) {
	defer wg.Done()

	for task := range p.tasks {
		// Check cancellation before processing. If the context is done,
		// stop picking up new tasks.
		select {
		case <-ctx.Done():
			return
		default:
			// Context is still active. Process the task.
		}

		result := task.ProcessTask(id)

		// Send the result. If the results channel buffer is full,
		// this blocks until the collector reads one. In practice the
		// collector is fast (just appends to a slice), so this rarely
		// blocks.
		p.results <- result
	}
}
