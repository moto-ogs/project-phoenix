package owners

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
)

func letterPickup(weekday, hour, minute int) *careplan.PickupSchedule {
	return &careplan.PickupSchedule{Weekday: weekday, PickupTime: time.Date(2000, 1, 1, hour, minute, 0, 0, time.UTC)}
}

// A letter names the booked days and the pickup time the way a school says
// them, from the weekly pickup plan (#4813).
func TestLetterCareWeekWritesDaysAndPickupTime(t *testing.T) {
	t.Parallel()
	cases := map[string]struct {
		week         letterCareWeekPlan
		days, pickup string
	}{
		"no plan": {letterCareWeekPlan{}, "", ""},
		"one day": {letterCareWeekPlan{pickups: []*careplan.PickupSchedule{letterPickup(3, 15, 0)}}, "Mittwoch", "15:00 Uhr"},
		"same time": {letterCareWeekPlan{pickups: []*careplan.PickupSchedule{letterPickup(4, 15, 30), letterPickup(1, 15, 30), letterPickup(2, 15, 30)}},
			"Montag, Dienstag und Donnerstag", "15:30 Uhr"},
		"times differ": {letterCareWeekPlan{pickups: []*careplan.PickupSchedule{letterPickup(1, 15, 0), letterPickup(5, 13, 45)}},
			"Montag und Freitag", "Mo 15:00 Uhr, Fr 13:45 Uhr"},
		// Care Plan counts a weekday with only an arrival as booked.
		"arrival only day": {letterCareWeekPlan{pickups: []*careplan.PickupSchedule{letterPickup(1, 15, 0)}, arrivalDays: []int{1, 3}},
			"Montag und Mittwoch", "15:00 Uhr"},
		"arrivals without pickups": {letterCareWeekPlan{arrivalDays: []int{2}}, "Dienstag", ""},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			days, pickup := letterCareWeek(tc.week)
			if days != tc.days || pickup != tc.pickup {
				t.Fatalf("letterCareWeek = %q, %q; want %q, %q", days, pickup, tc.days, tc.pickup)
			}
		})
	}
}

func TestLetterLogoImageEmbedsPNGJPEGAndConvertsWebP(t *testing.T) {
	t.Parallel()
	for _, image := range [][]byte{[]byte("\x89PNG\r\n\x1a\nrest"), []byte("\xff\xd8\xff\xe0")} {
		if got := letterLogoImage(image); string(got) != string(image) {
			t.Fatalf("PNG and JPEG print as uploaded, got %q", got)
		}
	}
	// A 1×1 lossless WebP, as the login image upload keeps it.
	webp, err := base64.StdEncoding.DecodeString("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
	if err != nil {
		t.Fatal(err)
	}
	if got := letterLogoImage(webp); !strings.HasPrefix(string(got), "\x89PNG\r\n\x1a\n") {
		t.Fatalf("a WebP logo prints as PNG, got %q", got)
	}
	if letterLogoImage([]byte("RIFF....WEBP")) != nil || letterLogoImage(nil) != nil {
		t.Fatal("broken and empty files print without a logo")
	}
}
