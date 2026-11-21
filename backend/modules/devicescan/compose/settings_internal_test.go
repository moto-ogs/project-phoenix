package compose

import (
	"context"
	"errors"
	"testing"
)

type checkoutSettingsResolver struct {
	ScanSettings
	value string
	err   error
}

func (r checkoutSettingsResolver) DailyCheckoutTime(context.Context) (string, error) {
	return r.value, r.err
}

func TestCheckoutTimeUsesResolvedSettingWithoutFallback(t *testing.T) {
	t.Parallel()
	for _, value := range []string{"", "15:00", "00:00"} {
		t.Run(value, func(t *testing.T) {
			t.Parallel()
			resolved, err := (settings{settings: checkoutSettingsResolver{value: value}}).DailyCheckoutTime(context.Background())
			if err != nil || resolved != value {
				t.Fatalf("resolved checkout time = %q, %v; want %q unchanged", resolved, err, value)
			}
		})
	}
}

func TestCheckoutTimeDoesNotHideResolutionFailure(t *testing.T) {
	t.Parallel()
	failure := errors.New("settings unavailable")
	value, err := (settings{settings: checkoutSettingsResolver{err: failure}}).DailyCheckoutTime(context.Background())
	if value != "" || !errors.Is(err, failure) {
		t.Fatalf("resolution failure lost: value=%q err=%v", value, err)
	}
	_, err = (settings{}).DailyCheckoutTime(context.Background())
	if !errors.Is(err, errSettingsNotConfigured) {
		t.Fatalf("missing settings wiring accepted: %v", err)
	}
}

type feedbackSettingsResolver struct {
	ScanSettings
	enabled bool
}

func (r feedbackSettingsResolver) FeedbackEnabled(context.Context) (bool, error) {
	return r.enabled, nil
}

type moodStops struct {
	stopped map[int64]bool
	err     error
}

func (s moodStops) MoodCaptureStopped(_ context.Context, studentID int64) (bool, error) {
	return s.stopped[studentID], s.err
}

// TestFeedbackPromptFollowsTheChildsStop pins #3844 at the kiosk flag: only
// a child without a stop in a school that takes feedback gets the prompt; a
// stop that cannot be read, or missing stop wiring, offers none.
func TestFeedbackPromptFollowsTheChildsStop(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	stops := moodStops{stopped: map[int64]bool{7: true}}
	for _, tc := range []struct {
		name    string
		s       settings
		student int64
		want    bool
	}{
		{"tracked child", settings{settings: feedbackSettingsResolver{enabled: true}, stops: stops}, 8, true},
		{"stopped child", settings{settings: feedbackSettingsResolver{enabled: true}, stops: stops}, 7, false},
		{"feedback off", settings{settings: feedbackSettingsResolver{enabled: false}, stops: stops}, 8, false},
		{"unreadable stop", settings{settings: feedbackSettingsResolver{enabled: true}, stops: moodStops{err: errors.New("down")}}, 8, false},
		{"no stop wiring", settings{settings: feedbackSettingsResolver{enabled: true}}, 8, false},
	} {
		got, err := tc.s.FeedbackEnabledFor(ctx, tc.student)
		if err != nil || got != tc.want {
			t.Fatalf("%s: got %v, %v; want %v", tc.name, got, err, tc.want)
		}
	}
}
