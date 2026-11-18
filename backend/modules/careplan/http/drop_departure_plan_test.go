package careplanhttp

import "testing"

// An edit of a child without an OGS place (#4803) drops the whole way home,
// the children it walks with included: the form sends them back unchanged,
// but none may be stored for the child.
func TestDropDeparturePlanDropsTheCompanions(t *testing.T) {
	t.Parallel()

	entries := []CompanionEntry{}
	fingerprint := "f"
	req := UpdateStudentRequest{Companions: &entries, CompanionsFingerprint: &fingerprint}
	req.dropDeparturePlan()
	if req.Companions != nil || req.CompanionsFingerprint != nil {
		t.Fatalf("companions kept: %v %v", req.Companions, req.CompanionsFingerprint)
	}
}
