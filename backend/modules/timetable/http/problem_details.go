package timetablehttp

import "github.com/moto-ogs/project-phoenix/sharedkernel/ident"

type CalendarPeriodOverlapDetails struct {
	IDs   []ident.ID `json:"overlapping_period_ids"`
	Names []string   `json:"overlapping_period_names"`
}

type CalendarPeriodShiftSeriesDetails struct {
	Count int `json:"staff_shift_series_count"`
}
