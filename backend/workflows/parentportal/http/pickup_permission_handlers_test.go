package parent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func pickupProofFixture(intact bool) *parentService.PickupProof {
	return &parentService.PickupProof{
		Request:    carerequests.Request{ID: 12, RequestKind: carerequests.KindPickupPermission, Status: carerequests.StatusApproved},
		ChildName:  "Mia Muster",
		SchoolName: "OGS am Berg",
		Statement:  "Ich erlaube, dass Erika Muster das Kind Mia Muster dienstags von der OGS abholt.",
		Summary:    []carerequests.DiffEntry{{Label: "Abholberechtigung · Erika Muster", Old: "Nicht abholberechtigt", New: "Nur Di"}},
		Signature: &parentService.PickupSignature{
			Method: "typed", TypedName: "Sabine Muster", SignerName: "Sabine Muster",
			PNG: []byte{0x89, 'P', 'N', 'G'}, SignedAt: time.Date(2026, 11, 3, 11, 0, 0, 0, time.UTC),
		},
		Intact: intact,
	}
}

// TestPickupProofReportNamesTheProcedureAndTheSignature pins the PDF
// description of the guardian's proof (#4780).
func TestPickupProofReportNamesTheProcedureAndTheSignature(t *testing.T) {
	t.Parallel()

	doc := pickupProofReport(pickupProofFixture(true), time.Date(2026, 11, 4, 9, 0, 0, 0, time.UTC))
	require.Len(t, doc.Sections, 1)
	cards := doc.Sections[0].Cards
	require.Len(t, cards, 2)

	values := map[string]string{}
	for _, field := range cards[0].Fields {
		values[field.Label] = field.Value
	}
	assert.Equal(t, "Einfache elektronische Signatur mit gezeichneter Unterschrift", values["Verfahren"])
	assert.Equal(t, "Von der OGS bestätigt", values["Stand"])
	assert.Equal(t, "Unterschrift und Text sind unverändert.", values["Prüfung"])
	assert.Contains(t, values["Erklärung"], "dienstags")
	assert.Equal(t, "Nicht abholberechtigt → Nur Di", values["Abholberechtigung · Erika Muster"])

	assert.True(t, strings.HasPrefix(cards[1].Title, "Unterschrift am 03.11.2026"))
	require.Len(t, cards[1].Fields, 2)
	assert.Equal(t, "Name getippt: Sabine Muster", cards[1].Fields[1].Value)
	assert.NotEmpty(t, cards[1].Fields[1].PNG)
}

func TestPickupProofReportWarnsAboutAChangedEntry(t *testing.T) {
	t.Parallel()

	doc := pickupProofReport(pickupProofFixture(false), time.Now())
	found := false
	for _, field := range doc.Sections[0].Cards[0].Fields {
		if field.Label == "Prüfung" {
			found = true
			assert.Contains(t, field.Value, "nachträglich verändert")
		}
	}
	assert.True(t, found)
}

func TestParsePickupPersonID(t *testing.T) {
	t.Parallel()

	id, err := parsePickupPersonID(nil)
	require.NoError(t, err)
	assert.Zero(t, id)
	value := "42"
	id, err = parsePickupPersonID(&value)
	require.NoError(t, err)
	assert.Equal(t, int64(42), id)
	invalid := "abc"
	_, err = parsePickupPersonID(&invalid)
	assert.Error(t, err)
}

func TestPickupChangeResponseExposesCollectorIDOnlyForOwnPendingRequest(t *testing.T) {
	t.Parallel()

	request := &carerequests.Request{
		ID: 1, SubmittedBy: 7, Status: carerequests.StatusPending,
		Payload: json.RawMessage(`{"date":"2026-11-10","reason":"Oma","pickup_person":{"guardian_profile_id":42,"name":"Erika Muster"}}`),
	}
	response, err := toPickupChangeRequestResponse(request, 7)
	require.NoError(t, err)
	require.NotNil(t, response.PickupPersonGuardianProfileID)
	assert.Equal(t, "42", response.PickupPersonGuardianProfileID.String())

	request.Status = carerequests.StatusApproved
	response, err = toPickupChangeRequestResponse(request, 7)
	require.NoError(t, err)
	assert.Nil(t, response.PickupPersonGuardianProfileID)
}

func pickupProofRequest(path string) *http.Request {
	req := withClaims(httptest.NewRequest(http.MethodGet, path, nil), 1234)
	route := chi.NewRouteContext()
	route.URLParams.Add("studentId", "7")
	route.URLParams.Add("requestId", "12")
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, route))
}

// The PDF has a path of its own (#2352).
func TestPickupRequestProofPDFHasItsOwnPath(t *testing.T) {
	t.Parallel()
	rs := &Resource{ParentService: &fakeParentService{pickupProof: pickupProofFixture(true)}, Reports: &capturingProofRenderer{}, Now: enrollmentTestNow}

	w := httptest.NewRecorder()
	rs.pickupRequestProofPDF(w, pickupProofRequest("/me/children/7/pickup-requests/12/proof/pdf"))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "application/pdf", w.Header().Get("Content-Type"))
	assert.Equal(t, `attachment; filename="nachweis-abholerlaubnis.pdf"`, w.Header().Get("Content-Disposition"))
	assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
}
