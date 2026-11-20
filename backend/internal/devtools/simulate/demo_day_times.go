package simulate

import (
	"encoding/json"
	"fmt"
	"strings"
)

// demoDayChildTime is one child of the list with today's planned times.
type demoDayChildTime struct {
	ID                 json.Number `json:"id"`
	ArrivalTime        *string     `json:"arrival_time"`
	ArrivalIsException bool        `json:"arrival_is_exception"`
	ArrivalNotes       string      `json:"arrival_notes"`
	PickupTime         *string     `json:"pickup_time"`
	PickupIsException  bool        `json:"pickup_is_exception"`
	PickupNotes        string      `json:"pickup_notes"`
}

// demoDayChildPageSize keeps a school in one or two pages.
const demoDayChildPageSize = 500

func demoDayChildTimes(client Client) ([]demoDayChildTime, error) {
	var all []demoDayChildTime
	for page := 1; ; page++ {
		raw, err := client.Get(fmt.Sprintf("/api/students?page=%d&page_size=%d&include_arrival_times=true&include_pickup_times=true", page, demoDayChildPageSize))
		if err != nil {
			return nil, fmt.Errorf("read demo day times: %w", err)
		}
		var envelope struct {
			Data       []demoDayChildTime `json:"data"`
			Pagination struct {
				TotalPages int `json:"total_pages"`
			} `json:"pagination"`
		}
		if err := json.Unmarshal(raw, &envelope); err != nil {
			return nil, fmt.Errorf("decode demo day times: %w", err)
		}
		all = append(all, envelope.Data...)
		if len(envelope.Data) == 0 || page >= envelope.Pagination.TotalPages {
			return all, nil
		}
	}
}

// demoDayNote reports whether the notes of a time exception start with the
// demo's own reason; the list appends the day's notes after it.
func demoDayNote(notes string) bool {
	return notes == demoDayReason || strings.HasPrefix(notes, demoDayReason+", ")
}
