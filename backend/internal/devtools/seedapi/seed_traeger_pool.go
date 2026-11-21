package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// The Vertretungspool of the demo Träger (#4709): the school of this run
// blocks the first Springer next week at the first time no other school
// holds and the Springer works no shift, through the route its OGS-Leitung
// uses. Several demo schools seed
// the same Träger, so the week shows blocks of several schools.

// The refusals the seed passes over: another school holds the time, or the
// Springer works a shift at its own Einsatzort then.
const (
	seedCodePoolBlockTaken   = "workforce.pool_block_taken"
	seedCodePoolSpringerBusy = "workforce.pool_springer_busy"
)

// seedPoolSlots are the times the seed tries each day: a morning, and the
// late afternoon after the usual shifts, and the early morning before them.
var seedPoolSlots = [][2]string{{"08:00", "13:00"}, {"17:00", "19:00"}, {"06:30", "07:30"}}

type seedPoolWeek struct {
	Available bool `json:"available"`
	Springers []struct {
		RecordID apiID `json:"staff_record_id"`
		Blocks   []struct {
			Own bool `json:"own"`
		} `json:"blocks"`
	} `json:"springers"`
}

// seedTraegerPoolBlock blocks a Springer for the school and reports whether
// it blocked one. A school that already holds a block next week keeps it.
func seedTraegerPoolBlock(client *Client, school AuthRef) (bool, error) {
	monday := seedNextMonday(time.Now())
	raw, err := client.GetWithAuth(school, "/api/staff-pool/?week="+monday.Format("2006-01-02"))
	if err != nil {
		return false, fmt.Errorf("read the Vertretungspool of the school: %w", err)
	}
	var envelope struct {
		Data seedPoolWeek `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return false, fmt.Errorf("decode the Vertretungspool of the school: %w", err)
	}
	week := envelope.Data
	if !week.Available || len(week.Springers) == 0 {
		return false, nil
	}
	springer := week.Springers[0]
	for _, block := range springer.Blocks {
		if block.Own {
			return false, nil
		}
	}
	for day := range 5 {
		for _, slot := range seedPoolSlots {
			blocked, err := seedPoolBlockSlot(client, school, int64(springer.RecordID), monday.AddDate(0, 0, day), slot)
			if err != nil || blocked {
				return blocked, err
			}
		}
	}
	return false, nil
}

// seedPoolBlockSlot blocks one slot; a taken or busy slot is no error.
func seedPoolBlockSlot(client *Client, school AuthRef, recordID int64, day time.Time, slot [2]string) (bool, error) {
	_, err := client.PostWithAuth(school, "/api/staff-pool/blocks", map[string]any{
		"staff_record_id": fmt.Sprint(recordID), "date": day.Format("2006-01-02"),
		"start_time": slot[0], "end_time": slot[1],
	})
	var refused *APIError
	if errors.As(err, &refused) && (refused.Code == seedCodePoolBlockTaken || refused.Code == seedCodePoolSpringerBusy) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("block a Springer of the Vertretungspool: %w", err)
	}
	return true, nil
}
