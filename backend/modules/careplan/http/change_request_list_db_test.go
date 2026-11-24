package careplanhttp_test

import (
	"encoding/json"
)

type aggListEnvelope struct {
	Data struct {
		Items []struct {
			RequestType      string          `json:"request_type"`
			GroupName        string          `json:"group_name"`
			DirectCorrection json.RawMessage `json:"direct_correction"`
		} `json:"items"`
		NextCursor string `json:"next_cursor"`
	} `json:"data"`
}
