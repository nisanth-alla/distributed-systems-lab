package workerpool

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

// Reporter tracks progress and prints live updates as tasks complete.
//
// It's safe to call OnResult from multiple goroutines because we
// protect the counters with a mutex.
type Reporter struct {
	total     int
	succeeded int
	failed    int
	mu        sync.Mutex
	startTime time.Time
	// Track which workers are active to show utilization
	workerLastSeen map[int]time.Time
}

// NewReporter creates a reporter for tracking `total` tasks.
func NewReporter(total int) *Reporter {
	return &Reporter{
		total:          total,
		startTime:      time.Now(),
		workerLastSeen: make(map[int]time.Time),
	}
}

// OnResult is called each time a worker finishes a task.
// Pass this to Pool.Run as the onResult callback.
func (r *Reporter) OnResult(result Result) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if result.Success {
		r.succeeded++
	} else {
		r.failed++
	}
	r.workerLastSeen[result.WorkerID] = time.Now()

	completed := r.succeeded + r.failed
	pct := float64(completed) / float64(r.total) * 100
	elapsed := time.Since(r.startTime).Round(time.Millisecond)

	// Build a simple progress bar
	barWidth := 30
	filled := int(float64(barWidth) * float64(completed) / float64(r.total))
	bar := strings.Repeat("=", filled) + strings.Repeat(" ", barWidth-filled)

	status := "OK"
	if !result.Success {
		status = "FAIL"
	}

	// \r returns the cursor to the start of the line. This overwrites
	// the previous progress line, creating an animated progress bar
	// in the terminal. The \n after the detail line moves to a new line
	// so the progress bar stays at the bottom.
	fmt.Printf("  [%s] w%d %s (%dms)\n", status, result.WorkerID, result.Filename, result.DurationMs)
	fmt.Printf("\r  [%s] %3.0f%% (%d/%d) elapsed: %s", bar, pct, completed, r.total, elapsed)
}

// Summary prints the final results after all tasks are done.
func (r *Reporter) Summary() {
	r.mu.Lock()
	defer r.mu.Unlock()

	elapsed := time.Since(r.startTime)
	completed := r.succeeded + r.failed

	fmt.Print("\n\n")
	fmt.Println("Summary:")
	fmt.Printf("  Total:     %d tasks\n", r.total)
	fmt.Printf("  Succeeded: %d\n", r.succeeded)
	fmt.Printf("  Failed:    %d\n", r.failed)
	fmt.Printf("  Duration:  %s\n", elapsed.Round(time.Millisecond))

	if completed > 0 {
		throughput := float64(completed) / elapsed.Seconds()
		fmt.Printf("  Throughput: %.1f tasks/sec\n", throughput)
	}

	// Show unique workers that participated
	fmt.Printf("  Workers used: %d\n", len(r.workerLastSeen))
}
