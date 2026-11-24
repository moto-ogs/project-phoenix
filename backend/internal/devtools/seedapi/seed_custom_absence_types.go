package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// The school's own Abwesenheitsart of the time-tracking history (#2403).

// seedCustomAbsenceType adds the school's own Abwesenheitsart as the admin and
// returns its id. The base type is not sent: the server derives it from the
// art, which is the whole point of the split (#2403).
func seedCustomAbsenceType(rt *Runtime, name string) (int64, error) {
	currentAuth := rt.Client.auth
	defer rt.Client.BindAuth(currentAuth)
	rt.Client.BindAuth(rt.TenantAuth)

	resp, err := rt.Client.Post("/api/absence-types", map[string]any{
		"name": name,
	})
	if err != nil {
		return 0, fmt.Errorf("post absence type: %w", err)
	}
	var payload struct {
		Data struct {
			ID json.RawMessage `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(resp, &payload); err != nil {
		return 0, fmt.Errorf("parse absence type response: %w", err)
	}
	// The endpoint sends the id as a decimal STRING — JavaScript cannot
	// represent every BIGINT as a number — so unquote before parsing, and
	// accept a bare number too rather than tying the seeder to that detail.
	raw := strings.Trim(string(payload.Data.ID), `"`)
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse absence type id %q: %w", raw, err)
	}
	return id, nil
}

// seedAbsenceTypeVersion reads the version of the type from the school's
// list: every edit of the type sends it back (ADR 0311).
func seedAbsenceTypeVersion(rt *Runtime, absenceTypeID int64) (string, error) {
	raw, err := rt.Client.Get("/api/absence-types")
	if err != nil {
		return "", fmt.Errorf("list absence types: %w", err)
	}
	var listed struct {
		Data []struct {
			ID      string `json:"id"`
			Version string `json:"version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &listed); err != nil {
		return "", fmt.Errorf("parse absence types: %w", err)
	}
	for _, value := range listed.Data {
		if value.ID == strconv.FormatInt(absenceTypeID, 10) {
			return value.Version, nil
		}
	}
	return "", fmt.Errorf("absence type %d is not listed", absenceTypeID)
}

func seedAbsenceTypeCarryover(rt *Runtime, absenceTypeID int64, until string) error {
	currentAuth := rt.Client.auth
	defer rt.Client.BindAuth(currentAuth)
	rt.Client.BindAuth(rt.TenantAuth)
	version, err := seedAbsenceTypeVersion(rt, absenceTypeID)
	if err != nil {
		return fmt.Errorf("seed absence type carryover: %w", err)
	}
	if _, err := rt.Client.Put(
		fmt.Sprintf("/api/absence-types/%d", absenceTypeID),
		map[string]any{"allowance_enabled": true, "carryover_until": until, "expected_version": version},
	); err != nil {
		return fmt.Errorf("seed absence type carryover: %w", err)
	}
	return nil
}

func seedCustomAbsenceTypeAllowance(rt *Runtime, absenceTypeID, staffID int64, year int, days float64, reason string) error {
	currentAuth := rt.Client.auth
	defer rt.Client.BindAuth(currentAuth)
	rt.Client.BindAuth(rt.TenantAuth)
	version, err := seedAbsenceTypeVersion(rt, absenceTypeID)
	if err != nil {
		return fmt.Errorf("enable custom absence type allowance: %w", err)
	}
	if _, err := rt.Client.Put(
		fmt.Sprintf("/api/absence-types/%d", absenceTypeID),
		map[string]any{"allowance_enabled": true, "expected_version": version},
	); err != nil {
		return fmt.Errorf("enable custom absence type allowance: %w", err)
	}
	// The change carries the version of the claim it replaces (ADR 0311).
	allowancePath := fmt.Sprintf("/api/absence-types/%d/allowances/%d", absenceTypeID, staffID)
	raw, err := rt.Client.Get(fmt.Sprintf("%s?year=%d", allowancePath, year))
	version, readErr := seedReadToken(raw, "version")
	if err = errors.Join(err, readErr); err != nil {
		return fmt.Errorf("read custom absence type allowance for staff %d: %w", staffID, err)
	}
	if _, err := rt.Client.Put(allowancePath, map[string]any{
		"year": year, "entitled_days": days,
		"reason": reason, "expected_version": version,
	}); err != nil {
		return fmt.Errorf("seed custom absence type allowance for staff %d: %w", staffID, err)
	}
	return nil
}
