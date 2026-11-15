package owners

import (
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
		week         []*careplan.PickupSchedule
		days, pickup string
	}{
		"no plan": {nil, "", ""},
		"one day": {[]*careplan.PickupSchedule{letterPickup(3, 15, 0)}, "Mittwoch", "15:00 Uhr"},
		"same time": {[]*careplan.PickupSchedule{letterPickup(4, 15, 30), letterPickup(1, 15, 30), letterPickup(2, 15, 30)},
			"Montag, Dienstag und Donnerstag", "15:30 Uhr"},
		"times differ": {[]*careplan.PickupSchedule{letterPickup(1, 15, 0), letterPickup(5, 13, 45)},
			"Montag und Freitag", "Mo 15:00 Uhr, Fr 13:45 Uhr"},
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

func TestEmbeddableLetterLogoAcceptsOnlyPNGAndJPEG(t *testing.T) {
	t.Parallel()
	if !embeddableLetterLogo([]byte("\x89PNG\r\n\x1a\nrest")) || !embeddableLetterLogo([]byte("\xff\xd8\xff\xe0")) {
		t.Fatal("PNG and JPEG must be embeddable")
	}
	if embeddableLetterLogo([]byte("RIFF....WEBP")) || embeddableLetterLogo(nil) {
		t.Fatal("WebP and empty files must print without a logo")
	}
}
