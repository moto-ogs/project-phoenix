package careplanhttp

import careplan "github.com/moto-ogs/project-phoenix/modules/careplan"

// careExitConfirmedResponse counts what a confirmed care exit changed.
type careExitConfirmedResponse struct {
	StudentsEnded     int `json:"students_ended"`
	RosterRowsRemoved int `json:"roster_rows_removed"`
	BookingsEnded     int `json:"bookings_ended"`
}

func newCareExitConfirmedResponse(result *careplan.CareExitResult) careExitConfirmedResponse {
	return careExitConfirmedResponse{
		StudentsEnded: result.StudentsEnded, RosterRowsRemoved: result.RosterRowsRemoved, BookingsEnded: result.BookingsEnded,
	}
}

// careExitCancelledResponse counts the planned exits a cancel withdrew.
type careExitCancelledResponse struct {
	StudentsCancelled int `json:"students_cancelled"`
}

// careResumedResponse confirms a resumed care and its new first day.
type careResumedResponse struct {
	Resumed  bool   `json:"resumed"`
	NewStart string `json:"new_start"`
}

// careWithdrawalPageResponse is one page of withdrawal tasks.
type careWithdrawalPageResponse struct {
	Items    []careWithdrawalResponse `json:"items"`
	Total    int                      `json:"total"`
	Page     int                      `json:"page"`
	PageSize int                      `json:"page_size"`
}

// endedCarePageResponse is one page of the ended-care archive.
type endedCarePageResponse struct {
	Items    []endedCareResponse `json:"items"`
	Total    int                 `json:"total"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"page_size"`
}
