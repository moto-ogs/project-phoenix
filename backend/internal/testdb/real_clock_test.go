package testdb

import (
	"testing"
	"time"
)

func TestRealNowRemovesTheFakeClockOffset(t *testing.T) {
	t.Parallel()

	moved := time.Date(2027, 11, 13, 0, 30, 0, 0, time.UTC)
	for offset, want := range map[string]time.Time{
		"":          moved,
		"not-a-num": moved,
		"86400":     moved.Add(-24 * time.Hour),
		"-3600":     moved.Add(time.Hour),
	} {
		if got := withoutFakeClockOffset(moved, offset); !got.Equal(want) {
			t.Errorf("offset %q: got %v, want %v", offset, got, want)
		}
	}
}
