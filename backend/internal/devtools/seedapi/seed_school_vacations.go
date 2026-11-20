package api

import (
	"context"
	"fmt"
	"time"
)

// SchoolVacationWindow is one seeded vacation, the same for every state.
type SchoolVacationWindow struct {
	Name      string `json:"name"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
}

// SchoolVacationWriter stores the seeded vacations of every federal state.
// The dev tools bind it to School Calendar's seed directly, or, in the
// public demo, to the operator route only its server mounts (ADR 0298).
type SchoolVacationWriter func(ctx context.Context, vacations []SchoolVacationWindow) (int, error)

// seedSchoolVacationsStep stores the school vacations of the school year for
// every federal state (#5345). The real vacations come from the daily worker
// sync with the OpenHolidays API; the seed never asks it, so a seeded stack
// shows vacations offline. The first vacation is next week, inside the two
// weeks the planning demo materializes, so the Betreuungsplan shows the
// vacation hint for its Regeltermine.
type seedSchoolVacationsStep struct{ seeder *Seeder }

func (seedSchoolVacationsStep) Name() string { return "Seeding school vacations" }

func (s seedSchoolVacationsStep) Run(ctx context.Context, rt *Runtime) error {
	write := schoolVacationWriterFor(s.seeder.options, rt)
	if write == nil {
		fmt.Println("  no database for the school vacations, the stored vacations stay as synced")
		return nil
	}
	vacations := seedSchoolVacationWindows(todaySeedDate())
	if _, err := write(ctx, vacations); err != nil {
		return fmt.Errorf("seed school vacations: %w", err)
	}
	fmt.Printf("  %d school vacations stored for every federal state\n", len(vacations))
	return nil
}

// schoolVacationWriterFor picks the bound writer, else the demo's operator
// route when the options ask for it; nil stores no vacations.
func schoolVacationWriterFor(options SeedOptions, rt *Runtime) SchoolVacationWriter {
	if options.SchoolVacations != nil {
		return options.SchoolVacations
	}
	if options.PresenceHistoryRoute {
		return func(_ context.Context, vacations []SchoolVacationWindow) (int, error) {
			raw, err := rt.Client.PostWithAuth(rt.OperatorAuth, "/operator/demo-school-vacations", map[string]any{"vacations": vacations})
			if err != nil {
				return 0, err
			}
			var response struct {
				Data struct {
					Stored int `json:"stored"`
				} `json:"data"`
			}
			if err := parseJSON(raw, &response); err != nil {
				return 0, fmt.Errorf("read stored school vacations: %w", err)
			}
			return response.Data.Stored, nil
		}
	}
	return nil
}

// seedSchoolVacationWindows names a one-week vacation from next Monday and
// the Christmas, Easter and summer vacations after it, with the dates the
// NRW vacations usually have.
func seedSchoolVacationWindows(today seedDate) []SchoolVacationWindow {
	autumnStart := seedDate{Time: nextWeekday(today.AddDays(1).UTCMidnight(), time.Monday)}
	autumnEnd := autumnStart.AddDays(4)
	year := autumnEnd.Year()
	if !autumnEnd.Before(time.Date(year, time.December, 23, 0, 0, 0, 0, time.UTC)) {
		year++
	}
	window := func(name string, start, end time.Time) SchoolVacationWindow {
		return SchoolVacationWindow{Name: name, StartDate: start.Format(seedDateLayout), EndDate: end.Format(seedDateLayout)}
	}
	return []SchoolVacationWindow{
		window("Herbstferien", autumnStart.Time, autumnEnd.Time),
		window("Weihnachtsferien", time.Date(year, time.December, 23, 0, 0, 0, 0, time.UTC), time.Date(year+1, time.January, 6, 0, 0, 0, 0, time.UTC)),
		window("Osterferien", time.Date(year+1, time.March, 29, 0, 0, 0, 0, time.UTC), time.Date(year+1, time.April, 10, 0, 0, 0, 0, time.UTC)),
		window("Sommerferien", time.Date(year+1, time.July, 12, 0, 0, 0, 0, time.UTC), time.Date(year+1, time.August, 24, 0, 0, 0, 0, time.UTC)),
	}
}
