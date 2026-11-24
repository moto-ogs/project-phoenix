package traegerstaff

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// ProofsResource serves the Nachweise of the Personalstamm (#4707, ADR 0089
// section 7) at /traeger/staff-proofs: the list of expiring proofs and its
// export, the kinds of the Träger, the mapping of the school kinds and the
// proofs of one record. Every route needs the Träger right „Personal“.
type ProofsResource struct {
	proofs       workforce.TraegerStaffProofs
	requireStaff common.Middleware
	lists        common.ListRenderer
}

// NewProofsResource builds the resource; the root binds requireStaff to the
// Träger right traeger_staff:manage and lists to Document Rendering (#4718).
func NewProofsResource(proofs workforce.TraegerStaffProofs, requireStaff common.Middleware, lists common.ListRenderer) *ProofsResource {
	if proofs == nil || requireStaff == nil || lists == nil {
		panic("workforce traeger staff proofs: the proofs, the right check and the list renderer are required")
	}
	return &ProofsResource{proofs: proofs, requireStaff: requireStaff, lists: lists}
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

// export answers the list as PDF, Excel or CSV (format=, CSV without one):
// one row per kind and person, the most urgent first. Its access entry is
// written before the file; a failed entry leaves no file.
func (rs *ProofsResource) export(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	list, err := rs.proofs.ProofList(r.Context(), session, workforce.TraegerStaffViewProofExport)
	if err != nil {
		renderProofError(w, r, err)
		return
	}
	common.WriteList(w, r, rs.lists, format, proofListTable(list))
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

func proofListTable(list workforce.TraegerStaffProofList) common.ListTable {
	rows := make([][]string, 0, len(list.Entries))
	for _, entry := range list.Entries {
		number := ""
		if entry.PersonnelNumber != nil {
			number = *entry.PersonnelNumber
		}
		rows = append(rows, []string{
			entry.LastName, entry.FirstName, number, strings.Join(entry.Schools, ", "), entry.TypeName,
			proofStatusLabels[entry.Status], germanDay(entry.ExpiresOn), germanDay(entry.PresentedOn),
		})
	}
	return common.ListTable{
		Title: "Nachweise", Subtitle: "Stand " + germanDay(list.Today),
		Filters: []string{"Alle Personen und Einsatzorte"},
		Columns: []common.ListColumn{
			{ID: "last_name", Label: "Nachname"}, {ID: "first_name", Label: "Vorname"}, {ID: "personnel_number", Label: "Personalnummer"},
			{ID: "schools", Label: "Einsatzorte"}, {ID: "type", Label: "Nachweis"}, {ID: "status", Label: "Stand"},
			{ID: "expires_on", Label: "Gültig bis"}, {ID: "presented_on", Label: "Vorgelegt am"},
		},
		Rows: rows, Footer: "Vertraulich. Enthält personenbezogene Daten.",
		Filename: "nachweise-" + list.Today,
	}
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

// ProofTypeRequest creates or rewrites a kind.
type ProofTypeRequest struct {
	Name              string `json:"name"`
	ValidityMonths    *int   `json:"validity_months"`
	ReminderLeadWeeks *int   `json:"reminder_lead_weeks"`
	Mandatory         bool   `json:"mandatory"`
	Archived          bool   `json:"archived"`
	// ExpectedVersion is the kind's version an update was made on; a kind
	// changed since is refused with general.changed_since_read (ADR 0311).
	// A create ignores it.
	ExpectedVersion string `json:"expected_version"`
}

func (req *ProofTypeRequest) Bind(*http.Request) error {
	if strings.TrimSpace(req.Name) == "" {
		return errors.New("name is required")
	}
	return nil
}

func (req *ProofTypeRequest) toInput() workforce.TraegerStaffProofTypeInput {
	lead := workforce.DefaultQualificationReminderLeadWeeks
	if req.ReminderLeadWeeks != nil {
		lead = *req.ReminderLeadWeeks
	}
	return workforce.TraegerStaffProofTypeInput{
		Name: req.Name, ValidityMonths: req.ValidityMonths, ReminderLeadWeeks: lead, Mandatory: req.Mandatory, Archived: req.Archived,
		ExpectedVersion: req.ExpectedVersion,
	}
}

func (rs *ProofsResource) createType(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	req := &ProofTypeRequest{}
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
	req := &ProofTypeRequest{}
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

// ProofMappingRequest maps one school kind onto a Träger kind; a null
// proof_type_id removes the mapping.
type ProofMappingRequest struct {
	SchoolID     ident.ID  `json:"school_id"`
	SchoolTypeID ident.ID  `json:"school_type_id"`
	ProofTypeID  *ident.ID `json:"proof_type_id"`
}

func (req *ProofMappingRequest) Bind(*http.Request) error {
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
	req := &ProofMappingRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeWorkforceTraegerProofMappingInvalid))
		return
	}
	kinds, err := rs.proofs.MapProofKind(r.Context(), session, workforce.TraegerProofMappingInput{
		SchoolID: req.SchoolID.Int64(), SchoolTypeID: req.SchoolTypeID.Int64(), ProofTypeID: (*int64)(req.ProofTypeID),
	})
	if err != nil {
		renderProofError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, kinds, "School proof kind mapped successfully")
}

// ProofRequest records or renews the proof of one kind at a record.
type ProofRequest struct {
	PresentedOn     string `json:"presented_on"`
	IssuedOn        string `json:"issued_on"`
	NoRelevantEntry bool   `json:"no_relevant_entry"`
	ExpiresOn       string `json:"expires_on"`
}

func (req *ProofRequest) Bind(*http.Request) error {
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
	req := &ProofRequest{}
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
