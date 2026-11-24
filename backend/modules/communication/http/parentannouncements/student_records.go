package announcement

import (
	"errors"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	announcementService "github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Kinderakte (#4814): the letters and declarations of one child for its
// Dokumente tab, and the proof of a declaration narrowed to that child.

var errStudentRecordsMissing = errors.New("parent announcements: student records are not composed")

type studentLetterResponse struct {
	AnnouncementID ident.ID   `json:"announcement_id"`
	Title          string     `json:"title"`
	PublishedAt    time.Time  `json:"published_at"`
	CanConfirm     bool       `json:"can_confirm"`
	AcknowledgedAt *time.Time `json:"acknowledged_at"`
	AcknowledgedBy string     `json:"acknowledged_by"`
}

type studentDeclarationResponse struct {
	AnnouncementID ident.ID                    `json:"announcement_id"`
	Title          string                      `json:"title"`
	PublishedAt    time.Time                   `json:"published_at"`
	Deadline       *time.Time                  `json:"deadline"`
	VersionNo      int                         `json:"version_no"`
	State          string                      `json:"state"`
	Signers        []declarationSignerResponse `json:"signers"`
}

type studentRecordsResponse struct {
	Letters      []studentLetterResponse      `json:"letters"`
	Declarations []studentDeclarationResponse `json:"declarations"`
}

func toStudentRecordsResponse(records *announcementService.StudentParentRecords) studentRecordsResponse {
	out := studentRecordsResponse{
		Letters:      make([]studentLetterResponse, 0, len(records.Letters)),
		Declarations: make([]studentDeclarationResponse, 0, len(records.Declarations)),
	}
	for _, l := range records.Letters {
		out.Letters = append(out.Letters, studentLetterResponse{
			AnnouncementID: ident.ID(l.AnnouncementID), Title: l.Title, PublishedAt: l.PublishedAt,
			CanConfirm: l.CanConfirm, AcknowledgedAt: l.AcknowledgedAt, AcknowledgedBy: l.AcknowledgedBy,
		})
	}
	for _, d := range records.Declarations {
		declaration := studentDeclarationResponse{
			AnnouncementID: ident.ID(d.AnnouncementID), Title: d.Title, PublishedAt: d.PublishedAt,
			Deadline: d.Deadline, VersionNo: d.VersionNo, State: d.State,
			Signers: make([]declarationSignerResponse, 0, len(d.Signers)),
		}
		for _, signer := range d.Signers {
			declaration.Signers = append(declaration.Signers, declarationSignerResponse{
				AccountID: ident.ID(signer.AccountID), FirstName: signer.FirstName,
				LastName: signer.LastName, Action: signer.Action, SubmittedAt: signer.SubmittedAt,
			})
		}
		out.Declarations = append(out.Declarations, declaration)
	}
	return out
}

// studentRecords answers the letters and declarations of one child. A child
// of another school has no rows here: the read runs in the caller's school.
func (rs *Resource) studentRecords(w http.ResponseWriter, r *http.Request) {
	studentID, ok := common.ParsePositiveInt64IDWithError(w, r, "studentId", "invalid student ID")
	if !ok {
		return
	}
	if rs.StudentRecords == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errStudentRecordsMissing))
		return
	}
	claims := sessiontoken.ClaimsFromCtx(r.Context())
	records, err := rs.StudentRecords.StudentParentRecords(r.Context(), int64(claims.ID), studentID)
	if err != nil {
		renderAnnouncementError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, toStudentRecordsResponse(records), "Student parent records retrieved")
}

// proofStudent reads the optional student_id that narrows a proof to one
// child. It reports false after answering a malformed value.
func proofStudent(w http.ResponseWriter, r *http.Request) (*int64, bool) {
	raw := r.URL.Query().Get("student_id")
	if raw == "" {
		return nil, true
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("student_id must be a positive integer")))
		return nil, false
	}
	return &id, true
}

// childProofFilename names the child in the file of a proof narrowed to one
// child, so it is not mistaken for the proof of the whole school once
// downloaded.
func childProofFilename(filename string, status *announcementService.ParentDeclarationStatus, studentID *int64) string {
	if studentID == nil || len(status.Children) != 1 {
		return filename
	}
	child := status.Children[0]
	name := strings.Join(strings.Fields(child.FirstName+" "+child.LastName), "-")
	if name == "" {
		return filename
	}
	ext := path.Ext(filename)
	return strings.TrimSuffix(filename, ext) + "-" + name + ext
}
