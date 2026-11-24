package common

import (
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Shared refusal values used by more than one HTTP adapter.
type SizeLimitDetails struct {
	MaxMB int64 `json:"max_mb" contract:"number"`
}

type PermissionDetails struct {
	Permission string `json:"permission"`
}

// PartialImportDetails uses the response type of the route's PartialError.
// An optional business refusal uses the details type of its own code.
type PartialImportDetails struct {
	Result    any                     `json:"result"`
	Rejection *PartialImportRejection `json:"rejection,omitempty"`
}

type PartialImportRejection struct {
	Code    string `json:"code"`
	Details any    `json:"details"`
}

type PlaceholderDetails struct {
	Placeholders string `json:"placeholders"`
}

type InputLimitDetails struct {
	Min      int `json:"min,omitempty"`
	Max      int `json:"max,omitempty"`
	MaxBytes int `json:"max_bytes,omitempty"`
}

type HolidayChildDayLimitDetails struct {
	Limit     int `json:"limit"`
	Days      int `json:"days"`
	Elsewhere int `json:"elsewhere"`
	Child     int `json:"child"`
}

type HolidayWeekNoCareDetails struct {
	Week    int           `json:"week"`
	WeekID  ident.ID      `json:"week_id"`
	Date    string        `json:"date"`
	ISODate calendar.Date `json:"iso_date"`
	Kind    string        `json:"kind"`
	Name    string        `json:"name"`
}
