package traegerstaff

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// ProofsResource serves the Nachweise of the Personalstamm (#4707, ADR 0089
// section 7) at /traeger/staff-proofs: the list of expiring proofs and its
// export, the kinds of the Träger, the mapping of the school kinds and the
// proofs of one record. Every route needs the Träger right „Personal“.
type ProofsResource struct {
	proofs       workforce.TraegerStaffProofs
	requireStaff common.Middleware
}

// NewProofsResource builds the resource; the root binds requireStaff to the
// Träger right traeger_staff:manage.
func NewProofsResource(proofs workforce.TraegerStaffProofs, requireStaff common.Middleware) *ProofsResource {
	if proofs == nil || requireStaff == nil {
		panic("workforce traeger staff proofs: the proofs and the right check are required")
	}
	return &ProofsResource{proofs: proofs, requireStaff: requireStaff}
}

// TraegerRouter returns the routes mounted at /traeger/staff-proofs.
func (rs *ProofsResource) TraegerRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		staff := r.With(rs.requireStaff)
		staff.Get("/", rs.list)
		staff.Get("/export", rs.export)
		staff.Get("/types", rs.types)
		staff.Post("/types", rs.createType)
		staff.Put("/types/{id}", rs.updateType)
		staff.Get("/school-kinds", rs.schoolKinds)
		staff.Put("/school-kinds", rs.mapSchoolKind)
		staff.Put("/records/{id}/{typeId}", rs.saveProof)
		staff.Delete("/records/{id}/{typeId}", rs.deleteProof)
	})
	return r
}

func (rs *ProofsResource) list(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	list, err := rs.proofs.ProofList(r.Context(), session, workforce.TraegerStaffViewProofList)
	if err != nil {
		renderProofError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, list, "Staff proofs retrieved successfully")
}

// export answers the list as CSV for a spreadsheet: one row per kind and
// person, the most urgent first. Its access entry is written before the
// file; a failed entry leaves no file.
func (rs *ProofsResource) export(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	list, err := rs.proofs.ProofList(r.Context(), session, workforce.TraegerStaffViewProofExport)
	if err != nil {
		renderProofError(w, r, err)
		return
	}
	data, err := proofListCSV(list)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", textnorm.ContentDisposition("attachment", fmt.Sprintf("nachweise-%s.csv", list.Today)))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// proofStatusLabels are the German statuses of the export.
var proofStatusLabels = map[string]string{
	workforce.TraegerProofStatusExpired:      "Abgelaufen",
	workforce.TraegerProofStatusMissing:      "Fehlt",
	workforce.TraegerProofStatusExpiringSoon: "Läuft bald ab",
	workforce.TraegerProofStatusValid:        "Gültig",
}

func germanDay(day string) string {
	parsed, err := calendar.ParseDate(day)
	if err != nil {
		return ""
	}
	return parsed.Format("02.01.2006")
}

func proofListCSV(list workforce.TraegerStaffProofList) ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&buf)
	writer.Comma = ';'
	rows := [][]string{{"Nachname", "Vorname", "Personalnummer", "Einsatzorte", "Nachweis", "Stand", "Gültig bis", "Vorgelegt am"}}
	for _, entry := range list.Entries {
		number := ""
		if entry.PersonnelNumber != nil {
			number = *entry.PersonnelNumber
		}
		rows = append(rows, []string{
			csvSafe(entry.LastName), csvSafe(entry.FirstName), number, csvSafe(strings.Join(entry.Schools, ", ")), csvSafe(entry.TypeName),
			proofStatusLabels[entry.Status], germanDay(entry.ExpiresOn), germanDay(entry.PresentedOn),
		})
	}
	if err := writer.WriteAll(rows); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// csvSafe keeps a spreadsheet from reading a name as a formula.
func csvSafe(value string) string {
	if value != "" && strings.ContainsRune("=+-@\t\r", rune(value[0])) {
		return "'" + value
	}
	return value
}

func (rs *ProofsResource) types(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	kinds, err := rs.proofs.ProofTypes(r.Context(), session)
	if err != nil {
		renderProofError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, kinds, "Proof types retrieved successfully")
}

// proofTypeRequest creates or rewrites a kind.
type proofTypeRequest struct {
	Name              string `json:"name"`
	ValidityMonths    *int   `json:"validity_months"`
	ReminderLeadWeeks *int   `json:"reminder_lead_weeks"`
	Mandatory         bool   `json:"mandatory"`
	Archived          bool   `json:"archived"`
}

func (req *proofTypeRequest) Bind(*http.Request) error {
	if strings.TrimSpace(req.Name) == "" {
		return errors.New("name is required")
	}
	return nil
}

func (req *proofTypeRequest) toInput() workforce.TraegerStaffProofTypeInput {
	lead := workforce.DefaultQualificationReminderLeadWeeks
	if req.ReminderLeadWeeks != nil {
		lead = *req.ReminderLeadWeeks
	}
	return workforce.TraegerStaffProofTypeInput{
		Name: req.Name, ValidityMonths: req.ValidityMonths, ReminderLeadWeeks: lead, Mandatory: req.Mandatory, Archived: req.Archived,
	}
}

func (rs *ProofsResource) createType(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	req := &proofTypeRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeWorkforceTraegerProofInvalid, "name"))
		return
	}
	kind, err := rs.proofs.CreateProofType(r.Context(), session, req.toInput())
	if err != nil {
		renderProofError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusCreated, kind, "Proof type created successfully")
}

func (rs *ProofsResource) updateType(w http.ResponseWriter, r *http.Request) {
	session, id, ok := actorAndRecord(w, r)
	if !ok {
		return
	}
	req := &proofTypeRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeWorkforceTraegerProofInvalid, "name"))
		return
	}
	kind, err := rs.proofs.UpdateProofType(r.Context(), session, id, req.toInput())
	if err != nil {
		renderProofError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, kind, "Proof type updated successfully")
}

func (rs *ProofsResource) schoolKinds(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	kinds, err := rs.proofs.SchoolProofKinds(r.Context(), session)
	if err != nil {
		renderProofError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, kinds, "School proof kinds retrieved successfully")
}

// mappingRequest maps one school kind onto a Träger kind; a null
// proof_type_id removes the mapping.
type mappingRequest struct {
	SchoolID     int64  `json:"school_id"`
	SchoolTypeID int64  `json:"school_type_id"`
	ProofTypeID  *int64 `json:"proof_type_id"`
}

func (req *mappingRequest) Bind(*http.Request) error {
	if req.SchoolID <= 0 || req.SchoolTypeID <= 0 {
		return errors.New("school_id and school_type_id are required")
	}
	return nil
}

func (rs *ProofsResource) mapSchoolKind(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	req := &mappingRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeWorkforceTraegerProofMappingInvalid))
		return
	}
	kinds, err := rs.proofs.MapProofKind(r.Context(), session, workforce.TraegerProofMappingInput{
		SchoolID: req.SchoolID, SchoolTypeID: req.SchoolTypeID, ProofTypeID: req.ProofTypeID,
	})
	if err != nil {
		renderProofError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, kinds, "School proof kind mapped successfully")
}

// proofRequest records or renews the proof of one kind at a record.
type proofRequest struct {
	PresentedOn     string `json:"presented_on"`
	IssuedOn        string `json:"issued_on"`
	NoRelevantEntry bool   `json:"no_relevant_entry"`
	ExpiresOn       string `json:"expires_on"`
}

func (req *proofRequest) Bind(*http.Request) error {
	if strings.TrimSpace(req.PresentedOn) == "" {
		return errors.New("presented_on is required")
	}
	return nil
}

func recordAndType(w http.ResponseWriter, r *http.Request) (workforce.TraegerStaffActor, int64, int64, bool) {
	session, recordID, ok := actorAndRecord(w, r)
	if !ok {
		return workforce.TraegerStaffActor{}, 0, 0, false
	}
	typeID, ok := common.ParseInt64IDWithError(w, r, "typeId", "invalid proof type ID")
	return session, recordID, typeID, ok
}

func (rs *ProofsResource) saveProof(w http.ResponseWriter, r *http.Request) {
	session, recordID, typeID, ok := recordAndType(w, r)
	if !ok {
		return
	}
	req := &proofRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeWorkforceTraegerProofInvalid, "presented_on"))
		return
	}
	proofs, err := rs.proofs.SaveProof(r.Context(), session, recordID, typeID, workforce.TraegerStaffProofInput{
		PresentedOn: req.PresentedOn, IssuedOn: req.IssuedOn, NoRelevantEntry: req.NoRelevantEntry, ExpiresOn: req.ExpiresOn,
	})
	if err != nil {
		renderProofError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, proofs, "Proof saved successfully")
}

func (rs *ProofsResource) deleteProof(w http.ResponseWriter, r *http.Request) {
	session, recordID, typeID, ok := recordAndType(w, r)
	if !ok {
		return
	}
	proofs, err := rs.proofs.DeleteProof(r.Context(), session, recordID, typeID)
	if err != nil {
		renderProofError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, proofs, "Proof deleted successfully")
}

// renderProofError maps the refusals of the Nachweise onto their codes, then
// those of the Personalstamm.
func renderProofError(w http.ResponseWriter, r *http.Request, err error) {
	if invalid, ok := errors.AsType[*workforce.TraegerProofError](err); ok {
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeWorkforceTraegerProofInvalid, invalid.Field))
		return
	}
	common.RenderError(w, r, proofErrors(err))
}

var proofErrors = common.RulesRenderer([]common.ErrorRule{
	{Target: workforce.ErrTraegerProofTypeNotFound, Render: coded(common.ErrorNotFoundWithCode, common.CodeWorkforceTraegerProofTypeNotFound)},
	{Target: workforce.ErrTraegerProofTypeNameTaken, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceTraegerProofTypeNameTaken)},
	{Target: workforce.ErrTraegerProofNotFound, Render: coded(common.ErrorNotFoundWithCode, common.CodeWorkforceTraegerProofNotFound)},
	{Target: workforce.ErrTraegerProofMappingInvalid, Render: coded(common.ErrorInvalidRequestWithCode, common.CodeWorkforceTraegerProofMappingInvalid)},
	{Target: workforce.ErrTraegerStaffNotReleased, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceTraegerStaffNotReleased)},
	{Target: workforce.ErrTraegerStaffRecordNotFound, Render: coded(common.ErrorNotFoundWithCode, common.CodeWorkforceTraegerStaffRecordNotFound)},
}, common.ErrorInternalServer)
