package api

import "fmt"

// seedEnrollmentDeletion submits one request and deletes it through its
// preview, so the deletion audit has an entry (ADR 0311: the delete confirms
// the preview fingerprint).
func (s parentEnrollmentSeedStep) seedEnrollmentDeletion(rt *Runtime, auth AuthRef, phaseID int64, offerings map[string]int64, requestIndex int) error {
	body := s.enrollmentSubmissionWithDays(
		phaseID, offerings, "Tilda", "Löschdemo", "2019-08-13", 1,
		"Mara", "Löschdemo", "mara.loeschdemo@example.test", "deletion-audit",
		[]int64{offerings["ogs-kurz"]}, map[int64][]string{offerings["ogs-kurz"]: {"wed"}},
	)
	if err := showFormVersion(staffGet(rt, auth), body); err != nil {
		return err
	}
	raw, err := rt.Client.PostPublicWithHeaders(
		"/api/enrollment/"+rt.Bootstrap.TenantSlug+"/submit", body, publicEnrollmentSeedHeaders(requestIndex),
	)
	if err != nil {
		return fmt.Errorf("submit enrollment deletion demo: %w", err)
	}
	request, err := parseEnrollmentSubmitResponse(raw, "deletion-audit")
	if err != nil {
		return err
	}
	requestPath := fmt.Sprintf("/api/enrollment/admin/requests/%d", request.RequestID)
	impactRaw, err := rt.Client.GetWithAuth(auth, requestPath+"/delete-impact")
	if err != nil {
		return fmt.Errorf("preview enrollment deletion: %w", err)
	}
	var impact struct {
		Data struct {
			Fingerprint string `json:"fingerprint"`
		} `json:"data"`
	}
	if err := parseJSON(impactRaw, &impact); err != nil {
		return fmt.Errorf("parse enrollment deletion preview: %w", err)
	}
	if _, err := rt.Client.DeleteWithAuthBody(auth, requestPath, map[string]any{
		"reason":               "Löschung auf Wunsch der Familie",
		"expected_fingerprint": impact.Data.Fingerprint,
	}); err != nil {
		return fmt.Errorf("delete enrollment demo request: %w", err)
	}
	return nil
}
