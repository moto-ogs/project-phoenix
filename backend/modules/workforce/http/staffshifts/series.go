package staffshifts

import (
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// SeriesRequest is the create payload for a recurring shift series (#1889).
// Weekdays are ISO (1=Monday … 7=Sunday); week_pattern is 0 = every week,
// 1 = week A, 2 = week B. valid_from/valid_until bound the series within its
// calendar period (valid_until exclusive; omitted = until period end). The
// split payload reuses this shape plus effective_date; staff_id, the period,
// and the validity bounds stay with the series lineage there.
type SeriesRequest struct {
	// WorkingTimeRequest confirms the working-time warnings (#4708).
	WorkingTimeRequest
	StaffID          ident.ID   `json:"staff_id"`
	Weekdays         []int      `json:"weekdays"` // omitted on split = keep predecessor weekdays
	StartTime        string     `json:"start_time" contract:"clock"`
	EndTime          string     `json:"end_time" contract:"clock"`
	BreakMinutes     int        `json:"break_minutes"`
	ShiftTypeID      OptionalID `json:"shift_type_id"`
	Notes            *string    `json:"notes"`
	CalendarPeriodID ident.ID   `json:"calendar_period_id"`
	WeekPattern      *int       `json:"week_pattern"` // omitted: create = every week, split = keep predecessor
	ValidFrom        string     `json:"valid_from" contract:"date"`
	// ValidUntil is presence-aware on split (#2028): an omitted key keeps the
	// predecessor's end, an explicit null lets the series run to the period end.
	ValidUntil    OptionalString `json:"valid_until"`
	EffectiveDate string         `json:"effective_date" contract:"date"`
	// OccurrenceShiftID is the concrete row opened by the planner. For a
	// permanent edit effective today it is updated in place before the series
	// is re-planned from tomorrow.
	OccurrenceShiftID ident.ID `json:"occurrence_shift_id"`
	// IncludeSchoolBreaks also plans the series in the Ferien and on closing
	// days (#3820); statutory holidays stay free. Omitted: create = false,
	// split = keep the predecessor's choice.
	IncludeSchoolBreaks *bool `json:"include_school_breaks"`
}

// SeriesSplitRequest is the split payload: the series fields plus the
// version of the series the planner edited (ADR 0311). The split refuses a
// series changed since that read with general.changed_since_read.
type SeriesSplitRequest struct {
	SeriesRequest
	ExpectedVersion string `json:"expected_version"`
	// ExpectedOccurrenceVersion is the version of the opened occurrence
	// (occurrence_shift_id). A split effective today rewrites it in place and
	// refuses it when it changed since that read.
	ExpectedOccurrenceVersion string `json:"expected_occurrence_version,omitempty"`
}

// SeriesResponse is the wire format for series create/split/end results.
// Skipped dates are days the series left out because an existing shift of
// the same person would overlap there.
type SeriesResponse struct {
	// Keep bigint identifiers as strings on the wire. The frontend needs to
	// carry them through a subsequent split request without JavaScript rounding.
	SeriesID     ident.ID `json:"series_id"`
	OldSeriesID  ident.ID `json:"old_series_id,omitempty"`
	Created      int      `json:"created"`
	Deleted      int      `json:"deleted"`
	SkippedDates []string `json:"skipped_dates"`
	// SkippedNonWorkingDays counts occurrences left out on statutory
	// holidays, Ferien days and closing days (#3820).
	SkippedNonWorkingDays int `json:"skipped_non_working_days"`
}

func toSeriesResponse(result workforce.StaffShiftSeriesResult) SeriesResponse {
	skipped := result.SkippedDates
	if skipped == nil {
		skipped = []string{}
	}
	return SeriesResponse{
		SeriesID:              ident.ID(result.SeriesID),
		OldSeriesID:           ident.ID(result.OldSeriesID),
		Created:               result.Created,
		Deleted:               int(result.Deleted),
		SkippedDates:          skipped,
		SkippedNonWorkingDays: result.SkippedNonWorkingDays,
	}
}

func toWeekdays(values []int) ([]int, error) {
	if values == nil {
		return nil, nil // split: keep predecessor weekdays
	}
	out := make([]int, 0, len(values))
	for _, v := range values {
		// Bounds check here so an out-of-range value never reaches the plan.
		if v < 1 || v > 7 {
			return nil, errors.New("weekdays must be between 1 (Monday) and 7 (Sunday)")
		}
		out = append(out, v)
	}
	return out, nil
}

// SeriesDetailResponse is the stored rule behind a shift: what the series
// editor loads before writing the change back through the split (#2028). Times are "HH:MM"
// wall-clock, dates "YYYY-MM-DD"; valid_until is exclusive, as everywhere in
// the series API.
type SeriesDetailResponse struct {
	ID               ident.ID  `json:"id"`
	StaffID          ident.ID  `json:"staff_id"`
	Weekdays         []int     `json:"weekdays"`
	StartTime        string    `json:"start_time"`
	EndTime          string    `json:"end_time"`
	BreakMinutes     int       `json:"break_minutes"`
	ShiftTypeID      *ident.ID `json:"shift_type_id"`
	Notes            string    `json:"notes,omitempty"`
	CalendarPeriodID ident.ID  `json:"calendar_period_id"`
	WeekPattern      int       `json:"week_pattern"`
	ValidFrom        string    `json:"valid_from"`
	ValidUntil       *string   `json:"valid_until"`
	// IncludeSchoolBreaks: the series is also planned in the Ferien and on
	// closing days (#3820).
	IncludeSchoolBreaks bool `json:"include_school_breaks"`
	// Version is the token of the stored series; the split sends it back as
	// expected_version (ADR 0311).
	Version string `json:"version"`
}

func toSeriesDetailResponse(series workforce.StaffShiftSeries) SeriesDetailResponse {
	weekdays := make([]int, 0, len(series.Weekdays))
	weekdays = append(weekdays, series.Weekdays...)
	resp := SeriesDetailResponse{
		ID:                  ident.ID(series.ID),
		StaffID:             ident.ID(series.StaffID),
		Weekdays:            weekdays,
		StartTime:           FormatWallClock(series.StartTime),
		EndTime:             FormatWallClock(series.EndTime),
		BreakMinutes:        series.BreakMinutes,
		ShiftTypeID:         (*ident.ID)(series.ShiftTypeID),
		Notes:               series.Notes,
		CalendarPeriodID:    ident.ID(series.CalendarPeriodID),
		WeekPattern:         series.WeekPattern,
		ValidFrom:           series.ValidFrom,
		IncludeSchoolBreaks: series.IncludeSchoolBreaks,
		Version:             series.Version,
	}
	if series.ValidUntil != "" {
		until := series.ValidUntil
		resp.ValidUntil = &until
	}
	return resp
}

// parseOptionalValidUntil turns the presence-aware payload field into a date.
// An absent key and an explicit null both mean "no end date" here; the split
// handler additionally reads Present to tell "clear the end" from "keep the
// predecessor's end".
func parseOptionalValidUntil(raw OptionalString) (string, error) {
	if raw.Value == nil || *raw.Value == "" {
		return "", nil
	}
	parsed, ok := parseDate(*raw.Value)
	if !ok {
		return "", errors.New("valid_until must be YYYY-MM-DD")
	}
	return parsed, nil
}

func buildSeries(req SeriesRequest) (workforce.StaffShiftSeriesInput, error) {
	validFrom, ok := parseDate(req.ValidFrom)
	if !ok {
		return workforce.StaffShiftSeriesInput{}, errors.New("valid_from must be YYYY-MM-DD")
	}
	validUntil, err := parseOptionalValidUntil(req.ValidUntil)
	if err != nil {
		return workforce.StaffShiftSeriesInput{}, err
	}
	start, end, err := parseShiftTimes(req.StartTime, req.EndTime)
	if err != nil {
		return workforce.StaffShiftSeriesInput{}, err
	}
	notes := ""
	if req.Notes != nil {
		notes = *req.Notes
	}
	weekPattern := workforce.WeekPatternEvery
	if req.WeekPattern != nil {
		weekPattern = *req.WeekPattern
	}
	weekdays, err := toWeekdays(req.Weekdays)
	if err != nil {
		return workforce.StaffShiftSeriesInput{}, err
	}
	return workforce.StaffShiftSeriesInput{
		StaffID:             req.StaffID.Int64(),
		Weekdays:            weekdays,
		StartTime:           start,
		EndTime:             end,
		BreakMinutes:        req.BreakMinutes,
		ShiftTypeID:         (*int64)(req.ShiftTypeID.Value),
		Notes:               notes,
		CalendarPeriodID:    req.CalendarPeriodID.Int64(),
		WeekPattern:         weekPattern,
		ValidFrom:           validFrom,
		ValidUntil:          validUntil,
		IncludeSchoolBreaks: req.IncludeSchoolBreaks != nil && *req.IncludeSchoolBreaks,
	}, nil
}

func buildSplit(id int64, req SeriesRequest) (workforce.SplitStaffShiftSeries, error) {
	effective, ok := parseDate(req.EffectiveDate)
	if !ok {
		return workforce.SplitStaffShiftSeries{}, errors.New("effective_date must be YYYY-MM-DD")
	}
	start, end, err := parseShiftTimes(req.StartTime, req.EndTime)
	if err != nil {
		return workforce.SplitStaffShiftSeries{}, err
	}
	weekdays, err := toWeekdays(req.Weekdays)
	if err != nil {
		return workforce.SplitStaffShiftSeries{}, err
	}
	validUntil, err := parseOptionalValidUntil(req.ValidUntil)
	if err != nil {
		return workforce.SplitStaffShiftSeries{}, err
	}
	return workforce.SplitStaffShiftSeries{
		SeriesID:            id,
		EffectiveDate:       effective,
		OccurrenceShiftID:   req.OccurrenceShiftID.Int64(),
		Weekdays:            weekdays,
		StartTime:           start,
		EndTime:             end,
		BreakMinutes:        req.BreakMinutes,
		ShiftTypeID:         (*int64)(req.ShiftTypeID.Value),
		ShiftTypeIDSet:      req.ShiftTypeID.Present,
		Notes:               req.Notes,
		ValidUntil:          validUntil,
		ValidUntilSet:       req.ValidUntil.Present,
		WeekPattern:         req.WeekPattern,
		IncludeSchoolBreaks: req.IncludeSchoolBreaks,
	}, nil
}

func (rs *Resource) createSeries(w http.ResponseWriter, r *http.Request) {
	var req SeriesRequest
	if err := wire.DecodeAndDrain(r.Body, &req); err != nil {
		rs.invalid(w, r, err)
		return
	}
	input, err := buildSeries(req)
	if err != nil {
		rs.invalid(w, r, err)
		return
	}
	actor, ok := rs.actor(w, r)
	if !ok {
		return
	}
	input.ActorStaffID = actor.StaffID
	input.TraegerAccountID = actor.traegerAccountID()
	input.WorkingTime = req.Confirmation()

	result, err := rs.planning.CreateSeries(r.Context(), workforce.CreateStaffShiftSeries{StaffShiftSeriesInput: input})
	if err != nil {
		rs.renderError(w, r, err)
		return
	}
	rs.runtime.Success(w, r, http.StatusCreated, toSeriesResponse(result), "Staff shift series created")
}

func (rs *Resource) splitSeries(w http.ResponseWriter, r *http.Request) {
	id, err := rs.runtime.ParseID(r)
	if err != nil {
		rs.invalid(w, r, err)
		return
	}
	var req SeriesSplitRequest
	if err := wire.DecodeAndDrain(r.Body, &req); err != nil {
		rs.invalid(w, r, err)
		return
	}
	input, err := buildSplit(id, req.SeriesRequest)
	if err != nil {
		rs.invalid(w, r, err)
		return
	}
	input.ExpectedVersion = req.ExpectedVersion
	input.ExpectedOccurrenceVersion = req.ExpectedOccurrenceVersion
	actor, ok := rs.actor(w, r)
	if !ok {
		return
	}
	input.ActorStaffID = actor.StaffID
	input.TraegerAccountID = actor.traegerAccountID()
	input.WorkingTime = req.Confirmation()
	result, err := rs.planning.SplitSeries(r.Context(), input)
	if err != nil {
		rs.renderError(w, r, err)
		return
	}
	rs.runtime.Success(w, r, http.StatusOK, toSeriesResponse(result), "Staff shift series split")
}

// getSeries returns the rule behind a shift so the planner can edit the whole
// series (weekdays, rhythm, validity), not just one occurrence (#2028).
func (rs *Resource) getSeries(w http.ResponseWriter, r *http.Request) {
	id, err := rs.runtime.ParseID(r)
	if err != nil {
		rs.invalid(w, r, err)
		return
	}
	series, err := rs.planning.GetSeries(r.Context(), id)
	if err != nil {
		rs.renderError(w, r, err)
		return
	}
	rs.runtime.Success(w, r, http.StatusOK, toSeriesDetailResponse(series), "Staff shift series retrieved")
}

func (rs *Resource) endSeries(w http.ResponseWriter, r *http.Request) {
	id, err := rs.runtime.ParseID(r)
	if err != nil {
		rs.invalid(w, r, err)
		return
	}
	fromStr := r.URL.Query().Get("from")
	if fromStr == "" {
		rs.invalid(w, r, errors.New("from query parameter is required"))
		return
	}
	from, ok := parseDate(fromStr)
	if !ok {
		rs.invalid(w, r, errors.New("invalid from date format, expected YYYY-MM-DD"))
		return
	}
	if _, ok := rs.actor(w, r); !ok {
		return
	}
	result, err := rs.planning.EndSeries(r.Context(), id, from)
	if err != nil {
		rs.renderError(w, r, err)
		return
	}
	rs.runtime.Success(w, r, http.StatusOK, toSeriesResponse(result), "Staff shift series ended")
}
