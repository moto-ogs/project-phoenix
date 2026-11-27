package application

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

type recordingEngine struct {
	available bool
	replaced  mealplan.ReplaceDay
	// stored is the day the store reads; calls lists lock, read and write.
	stored []domain.Entry
	calls  []string
}

func (e *recordingEngine) Replace(_ context.Context, date string, dishes []mealplan.Dish) error {
	e.calls = append(e.calls, "write "+date)
	e.replaced = mealplan.ReplaceDay{Date: mealplan.Date(date), Dishes: dishes}
	return nil
}

func TestModuleRejectsWeekendWritesAtPublicSeam(t *testing.T) {
	t.Parallel()

	date, dateErr := mealplan.ParseDate("2026-09-05")
	if dateErr != nil {
		t.Fatal(dateErr)
	}
	module := newTestModule(&recordingEngine{available: true})
	_, err := module.ReplaceDay(context.Background(), mealplan.ReplaceDay{
		Date:   date,
		Dishes: []mealplan.Dish{{Dish: "Suppe"}},
	})

	if !errors.Is(err, mealplan.ErrInvalidMealDate) {
		t.Fatalf("ReplaceDay() error = %v, want ErrInvalidMealDate", err)
	}
}

func TestModuleNormalizesRegularParticipationWeekdays(t *testing.T) {
	t.Parallel()

	weekdays, ok := normalizeWeekdays([]mealplan.Weekday{mealplan.Friday, mealplan.Monday, mealplan.Friday})
	if !ok {
		t.Fatal("normalizeWeekdays() refused valid weekdays")
	}
	want := []mealplan.Weekday{mealplan.Monday, mealplan.Friday}
	if !slices.Equal(weekdays, want) {
		t.Fatalf("weekdays = %v, want %v", weekdays, want)
	}
	if _, ok := normalizeWeekdays([]mealplan.Weekday{mealplan.Monday, 6}); ok {
		t.Fatal("normalizeWeekdays() accepted a Saturday")
	}
}

func TestModuleRejectsWeekendParticipationOverride(t *testing.T) {
	t.Parallel()

	module := newTestModule(&recordingEngine{available: true})
	err := module.SetParticipationForDay(context.Background(), mealplan.SetParticipationDay{
		StudentID: 42, GuardianAccountID: 7, Date: "2026-09-05", Participating: true,
	})

	if !errors.Is(err, mealplan.ErrInvalidParticipation) {
		t.Fatalf("SetParticipationForDay() error = %v, want ErrInvalidParticipation", err)
	}
}

func TestModuleNormalizesDishesAtPublicSeam(t *testing.T) {
	t.Parallel()

	engine := &recordingEngine{available: true}
	module := newTestModule(engine)
	date, dateErr := mealplan.ParseDate("2026-09-07")
	if dateErr != nil {
		t.Fatal(dateErr)
	}
	note := "  vegetarisch  "
	_, err := module.ReplaceDay(context.Background(), mealplan.ReplaceDay{
		Date: date, ExpectedVersion: dayVersion(nil),
		Dishes: []mealplan.Dish{
			{Dish: "  Nudeln  ", Note: &note},
			{Dish: "   "},
		},
	})
	if err != nil {
		t.Fatalf("ReplaceDay() error = %v", err)
	}
	if len(engine.replaced.Dishes) != 1 || engine.replaced.Dishes[0].Dish != "Nudeln" {
		t.Fatalf("normalized dishes = %#v", engine.replaced.Dishes)
	}
	if engine.replaced.Dishes[0].Note == nil || *engine.replaced.Dishes[0].Note != "vegetarisch" {
		t.Fatalf("normalized note = %#v", engine.replaced.Dishes[0].Note)
	}
}

func TestModuleRefusesInvalidWeekChanges(t *testing.T) {
	t.Parallel()

	module := newTestModule(&recordingEngine{available: true})
	for _, command := range []mealplan.SetParticipationWeek{
		{StudentID: 0, GuardianAccountID: 7, WeekOf: "2026-09-10"},
		{StudentID: 42, GuardianAccountID: 0, WeekOf: "2026-09-10"},
		{StudentID: 42, GuardianAccountID: 7, WeekOf: "10.09.2026"},
	} {
		if _, err := module.SetParticipationForWeek(context.Background(), command); !errors.Is(err, mealplan.ErrInvalidParticipation) {
			t.Fatalf("SetParticipationForWeek(%+v) error = %v, want ErrInvalidParticipation", command, err)
		}
	}
}

func TestModuleRefusesInvalidSchoolChanges(t *testing.T) {
	t.Parallel()

	module := newTestModule(&recordingEngine{available: true})
	for _, command := range []mealplan.SchoolSchedule{
		{StudentID: 42, StaffAccountID: 9, Weekdays: []mealplan.Weekday{mealplan.Monday}},
		{StudentID: 42, StaffAccountID: 0, Weekdays: []mealplan.Weekday{mealplan.Monday}, EffectiveFrom: "2026-09-14"},
		{StudentID: 42, StaffAccountID: 9, Weekdays: []mealplan.Weekday{6}, EffectiveFrom: "2026-09-14"},
	} {
		if _, err := module.ReplaceScheduleBySchool(context.Background(), command); !errors.Is(err, mealplan.ErrInvalidParticipation) {
			t.Fatalf("ReplaceScheduleBySchool(%+v) error = %v, want ErrInvalidParticipation", command, err)
		}
	}
	for _, command := range []mealplan.SchoolChange{
		{StudentID: 0, StaffAccountID: 9, Date: "2026-09-10"},
		{StudentID: 42, StaffAccountID: 0, Date: "2026-09-10"},
		{StudentID: 42, StaffAccountID: 9, Date: "2026-09-12"},
	} {
		if err := module.SetParticipationBySchool(context.Background(), command); !errors.Is(err, mealplan.ErrInvalidParticipation) {
			t.Fatalf("SetParticipationBySchool(%+v) error = %v, want ErrInvalidParticipation", command, err)
		}
		if err := module.ClearParticipationBySchool(context.Background(), command); !errors.Is(err, mealplan.ErrInvalidParticipation) {
			t.Fatalf("ClearParticipationBySchool(%+v) error = %v, want ErrInvalidParticipation", command, err)
		}
	}
}

func TestModuleNormalizesAllergensAtPublicSeam(t *testing.T) {
	t.Parallel()

	engine := &recordingEngine{available: true}
	module := newTestModule(engine)
	_, err := module.ReplaceDay(context.Background(), mealplan.ReplaceDay{
		Date: "2026-09-07", ExpectedVersion: dayVersion(nil),
		Dishes: []mealplan.Dish{
			{Dish: "Fischstäbchen", Allergens: []mealplan.Allergen{mealplan.AllergenMilk, mealplan.AllergenFish, mealplan.AllergenGluten, mealplan.AllergenFish}},
			{Dish: "Obst"},
		},
	})
	if err != nil {
		t.Fatalf("ReplaceDay() error = %v", err)
	}
	want := []mealplan.Allergen{mealplan.AllergenGluten, mealplan.AllergenFish, mealplan.AllergenMilk}
	if got := engine.replaced.Dishes[0].Allergens; !slices.Equal(got, want) {
		t.Fatalf("normalized allergens = %v, want %v", got, want)
	}
	if got := engine.replaced.Dishes[1].Allergens; got == nil || len(got) != 0 {
		t.Fatalf("unmarked dish allergens = %#v, want an empty list", got)
	}
}

func TestModuleRejectsUnknownAllergensBeforeWriting(t *testing.T) {
	t.Parallel()

	engine := &recordingEngine{available: true}
	module := newTestModule(engine)
	_, err := module.ReplaceDay(context.Background(), mealplan.ReplaceDay{
		Date: "2026-09-07",
		// A blank dish does not hide an unknown code either.
		Dishes: []mealplan.Dish{{Dish: " ", Allergens: []mealplan.Allergen{"strawberry"}}},
	})
	if !errors.Is(err, mealplan.ErrInvalidAllergens) {
		t.Fatalf("ReplaceDay() error = %v, want ErrInvalidAllergens", err)
	}
	if engine.replaced.Date != "" {
		t.Fatalf("an invalid day reached the store: %#v", engine.replaced)
	}
}

// A save locks the day, reads it and checks the version its saver read
// before it writes: an outdated or missing version is refused without a
// write.
func TestModuleChecksTheReadVersionBeforeTheWrite(t *testing.T) {
	t.Parallel()

	date, dateErr := mealplan.ParseDate("2026-09-07")
	if dateErr != nil {
		t.Fatal(dateErr)
	}
	note := "mit Brot"
	stored := []domain.Entry{{Date: domain.Date(date), Dish: "Suppe", Note: &note, Allergens: []string{"gluten", "milk"}}}
	current := dayVersion(storedDishes(stored))
	written := []string{"lock 2026-09-07", "read 2026-09-07", "write 2026-09-07"}
	refused := []string{"lock 2026-09-07", "read 2026-09-07"}
	tests := []struct {
		name      string
		version   string
		wantErr   error
		wantCalls []string
	}{
		{"current version", current, nil, written},
		{"outdated version", dayVersion(nil), readstate.ErrChanged, refused},
		{"no version", "", readstate.ErrChanged, refused},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			engine := &recordingEngine{available: true, stored: stored}
			day, err := newTestModule(engine).ReplaceDay(context.Background(), mealplan.ReplaceDay{
				Date: date, Dishes: []mealplan.Dish{{Dish: " Nudeln "}}, ExpectedVersion: tc.version,
			})
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("ReplaceDay() error = %v, want %v", err, tc.wantErr)
			}
			if !slices.Equal(engine.calls, tc.wantCalls) {
				t.Fatalf("store calls = %v, want %v", engine.calls, tc.wantCalls)
			}
			if err == nil && day.Version != dayVersion([]mealplan.Dish{{Dish: "Nudeln", Allergens: []mealplan.Allergen{}}}) {
				t.Fatalf("answered version %q is not the version of the written day", day.Version)
			}
		})
	}
}

// Every weekday of the week read carries the version a save of it checks,
// an empty day too.
func TestModuleDaysCarryTheVersionTheSaveChecks(t *testing.T) {
	t.Parallel()

	stored := []domain.Entry{{Date: "2026-09-08", Dish: "Suppe", Allergens: []string{"milk"}}}
	engine := &recordingEngine{available: true, stored: stored}
	module := newTestModule(engine)
	days, err := module.Days(context.Background(), "2026-09-09")
	if err != nil {
		t.Fatalf("Days() error = %v", err)
	}
	if len(days) != 5 || days[0].Date != "2026-09-07" || days[1].Date != "2026-09-08" {
		t.Fatalf("days = %+v, want Monday to Friday of the week", days)
	}
	if days[0].Version != dayVersion(nil) || days[1].Version != dayVersion(storedDishes(stored)) {
		t.Fatalf("versions = %q, %q", days[0].Version, days[1].Version)
	}
	engine.stored = nil
	if _, err := module.ReplaceDay(context.Background(), mealplan.ReplaceDay{Date: "2026-09-07", Dishes: []mealplan.Dish{{Dish: "Obst"}}, ExpectedVersion: days[0].Version}); err != nil {
		t.Fatalf("a save with the read version of an empty day: %v", err)
	}
}
