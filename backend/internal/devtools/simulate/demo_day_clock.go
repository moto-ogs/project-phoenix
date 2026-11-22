package simulate

import (
	"fmt"
	"strconv"
)

func blockMinutes(block demoBlock) (int, int, bool) {
	start, end := minutesOf(&block.StartTime), minutesOf(&block.EndTime)
	return start, end, start >= 0 && end > start
}

// minutesOf parses HH:MM or HH:MM:SS; -1 for nil or malformed.
func minutesOf(clock *string) int {
	if clock == nil || len(*clock) < 5 || (*clock)[2] != ':' {
		return -1
	}
	hours, errHours := strconv.Atoi((*clock)[:2])
	minutes, errMinutes := strconv.Atoi((*clock)[3:5])
	if errHours != nil || errMinutes != nil || hours > 23 || minutes > 59 {
		return -1
	}
	return hours*60 + minutes
}

func clockOf(minutes int) string {
	return fmt.Sprintf("%02d:%02d", minutes/60, minutes%60)
}
