package workerpool

import (
	"fmt"
	"math/rand"
)

// GenerateTasks creates a batch of simulated file processing tasks.
//
// Parameters:
//   - count: how many tasks to create
//   - failRate: fraction of tasks that should fail (0.0 to 1.0)
//
// In a real system, this would scan a directory and create a task for
// each file. Here we generate fake filenames and processing times.
func GenerateTasks(count int, failRate float64) []Task {
	// Go slices are like JavaScript arrays but with a fixed underlying
	// capacity. make([]Task, 0, count) creates an empty slice with room
	// for `count` elements. This avoids repeated memory allocation as
	// we append.
	tasks := make([]Task, 0, count)

	extensions := []string{".log", ".csv", ".json", ".xml", ".txt"}
	prefixes := []string{"access", "error", "audit", "metrics", "events", "transactions"}

	for i := 0; i < count; i++ {
		ext := extensions[rand.Intn(len(extensions))]
		prefix := prefixes[rand.Intn(len(prefixes))]

		task := Task{
			ID:       i + 1,
			Filename: fmt.Sprintf("%s_%04d%s", prefix, i+1, ext),
			SizeKB:   rand.Intn(500) + 10, // 10-510 KB
			// Processing time between 50ms and 300ms. This range makes
			// the demo run in a reasonable time while still showing
			// concurrency effects clearly.
			SimulateMs: rand.Intn(250) + 50,
			ShouldFail: rand.Float64() < failRate,
		}
		tasks = append(tasks, task)
	}

	return tasks
}
