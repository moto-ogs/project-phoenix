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
	err := module.ReplaceDay(context.Background(), mealplan.ReplaceDay{
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
	err := module.ReplaceDay(context.Background(), mealplan.ReplaceDay{
		Date: date,
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
	err := module.ReplaceDay(context.Background(), mealplan.ReplaceDay{
		Date: "2026-09-07",
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
	err := module.ReplaceDay(context.Background(), mealplan.ReplaceDay{
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

// A save with the day as its saver read it locks the day, compares the
// stored day in stored form and refuses a day changed since; without a read
// state it takes no lock and writes unchecked.
func TestModuleComparesTheReadDayBeforeTheWrite(t *testing.T) {
	t.Parallel()

	date, dateErr := mealplan.ParseDate("2026-09-07")
	if dateErr != nil {
		t.Fatal(dateErr)
	}
	note := "mit Brot"
	stored := []domain.Entry{{Date: domain.Date(date), Dish: "Suppe", Note: &note, Allergens: []string{"gluten", "milk"}}}
	spaced := " mit Brot "
	asRead := []mealplan.Dish{{Dish: " Suppe ", Note: &spaced, Allergens: []mealplan.Allergen{"milk", "gluten"}}, {Dish: " "}}
	empty := []mealplan.Dish{}
	tests := []struct {
		name      string
		expected  *[]mealplan.Dish
		wantErr   error
		wantCalls []string
	}{
		{"matching read state", &asRead, nil, []string{"lock 2026-09-07", "read 2026-09-07", "write 2026-09-07"}},
		{"changed since read", &empty, readstate.ErrChanged, []string{"lock 2026-09-07", "read 2026-09-07"}},
		{"no read state", nil, nil, []string{"read 2026-09-07", "write 2026-09-07"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			engine := &recordingEngine{available: true, stored: stored}
			err := newTestModule(engine).ReplaceDay(context.Background(), mealplan.ReplaceDay{
				Date: date, Dishes: []mealplan.Dish{{Dish: "Nudeln"}}, Expected: tc.expected,
			})
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("ReplaceDay() error = %v, want %v", err, tc.wantErr)
			}
			if !slices.Equal(engine.calls, tc.wantCalls) {
				t.Fatalf("store calls = %v, want %v", engine.calls, tc.wantCalls)
			}
		})
	}
}
