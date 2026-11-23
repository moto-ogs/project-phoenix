package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// The Monatsabschluss of the Träger (#4711): the first demo record gets the
// month before last closed in every school, so the Stundenkonto shows a
// closed month next to the open last month the Personalverwaltung still
// closes. A month a school closed later than this one, or one before the
// contract, stays as it is.

// The codes the close answers when the demo state leaves it nothing to do.
const (
	seedCodeTraegerMonthLaterClosed = "workforce.traeger_month_later_closed"
	seedCodeTraegerMonthNotKept     = "workforce.traeger_month_not_kept"
)

func seedTraegerMonthClose(client *Client, auth AuthRef, recordID int64) (bool, error) {
	if recordID <= 0 {
		return false, nil
	}
	now := time.Now()
	month := time.Date(now.Year(), now.Month()-2, 1, 0, 0, 0, 0, time.UTC)
	if month.Format("2006-01-02") < seedTraegerContractStart {
		return false, nil
	}
	// The close carries the fingerprint of the month it confirms (ADR 0311).
	path := fmt.Sprintf("/traeger/staff-records/%d/time-account", recordID)
	raw, err := client.GetWithAuth(auth, fmt.Sprintf("%s?year=%d&month=%d", path, month.Year(), int(month.Month())))
	if err != nil {
		return false, fmt.Errorf("read a month of a Träger staff record: %w", err)
	}
	var read struct {
		Data struct {
			Fingerprint string `json:"fingerprint"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &read); err != nil {
		return false, fmt.Errorf("decode a month of a Träger staff record: %w", err)
	}
	_, err = client.PostWithAuth(auth, path+"/close", map[string]any{
		"year": month.Year(), "month": int(month.Month()), "reason": "Monatsabschluss für das Lohnbüro",
		"expected_fingerprint": read.Data.Fingerprint,
	})
	var refused *APIError
	if errors.As(err, &refused) && (refused.Code == seedCodeTraegerMonthLaterClosed || refused.Code == seedCodeTraegerMonthNotKept) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("close a month of a Träger staff record: %w", err)
	}
	return true, nil
}
