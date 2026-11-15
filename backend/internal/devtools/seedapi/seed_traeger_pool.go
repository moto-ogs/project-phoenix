package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// The Vertretungspool of the demo Träger (#4709): the school of this run
// blocks the first Springer next week on the first morning no other school
// holds, through the route its OGS-Leitung uses. Several demo schools seed
// the same Träger, so the week shows blocks of several schools.

const seedCodePoolBlockTaken = "workforce.pool_block_taken"

type seedPoolWeek struct {
	Available bool `json:"available"`
	Springers []struct {
		RecordID int64 `json:"staff_record_id"`
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
		_, err := client.PostWithAuth(school, "/api/staff-pool/blocks", map[string]any{
			"staff_record_id": fmt.Sprint(springer.RecordID), "date": monday.AddDate(0, 0, day).Format("2006-01-02"),
			"start_time": "08:00", "end_time": "13:00",
		})
		var refused *APIError
		if errors.As(err, &refused) && refused.Code == seedCodePoolBlockTaken {
			continue
		}
		if err != nil {
			return false, fmt.Errorf("block a Springer of the Vertretungspool: %w", err)
		}
		return true, nil
	}
	return false, nil
}
