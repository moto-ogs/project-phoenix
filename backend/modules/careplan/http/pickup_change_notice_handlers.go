package careplanhttp

import (
	errors "errors"
	http "net/http"
	time "time"

	common "github.com/moto-ogs/project-phoenix/api/common"
	careplan "github.com/moto-ogs/project-phoenix/modules/careplan"
	sessiontoken "github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// pickupChangeNoticeResponse is one unread marker of a changed pickup time
// (#6855). It names the child by first name only; the link opens the child.
type pickupChangeNoticeResponse struct {
	RequestID        ident.ID  `json:"request_id"`
	StudentID        ident.ID  `json:"student_id"`
	StudentFirstName string    `json:"student_first_name"`
	Date             string    `json:"date"`
	PickupTime       string    `json:"pickup_time,omitempty"`
	Withdrawn        bool      `json:"withdrawn"`
	InformedAt       time.Time `json:"informed_at"`
}

var errPickupChangeNoticesUnbound = errors.New("pickup change notices are not configured")

// listPickupChangeNotices serves the reader's unread markers for the header.
// They reach only the reader they were stored for.
func (rs *Resource) listPickupChangeNotices(w http.ResponseWriter, r *http.Request) {
	if rs.PickupChangeNotices == nil {
		renderError(w, r, common.ErrorInternalServer(errPickupChangeNoticesUnbound))
		return
	}
	notices, err := rs.PickupChangeNotices.ListUnreadPickupChangeNotices(r.Context(), int64(sessiontoken.ClaimsFromCtx(r.Context()).ID))
	if err != nil {
		renderError(w, r, common.ErrorInternalServerWrap("failed to load pickup change notices", err))
		return
	}
	common.Respond(w, r, http.StatusOK, renderPickupChangeNotices(notices), "Pickup change notices retrieved")
}

// readPickupChangeNotices clears the markers the reader loaded for one child
// once the child is open, and answers with the markers still unread. A marker
// told again while the page loaded keeps its unread state.
func (rs *Resource) readPickupChangeNotices(w http.ResponseWriter, r *http.Request) {
	if rs.PickupChangeNotices == nil {
		renderError(w, r, common.ErrorInternalServer(errPickupChangeNoticesUnbound))
		return
	}
	studentID, ok := common.ParsePositiveInt64IDWithError(w, r, "id", "invalid student id")
	if !ok {
		return
	}
	var body pickupChangeNoticesReadRequest
	if err := wire.Decode(r.Body, &body); err != nil {
		renderError(w, r, common.ErrorInvalidRequest(errors.New("invalid pickup change notice revisions")))
		return
	}
	observed := make([]careplan.PickupChangeNoticeRevision, 0, len(body.Notices))
	for _, notice := range body.Notices {
		observed = append(observed, careplan.PickupChangeNoticeRevision{RequestID: notice.RequestID.Int64(), InformedAt: notice.InformedAt})
	}
	notices, err := rs.PickupChangeNotices.MarkPickupChangeNoticesRead(r.Context(), int64(sessiontoken.ClaimsFromCtx(r.Context()).ID), studentID, observed)
	if err != nil {
		renderError(w, r, common.ErrorInternalServerWrap("failed to mark pickup change notices read", err))
		return
	}
	common.Respond(w, r, http.StatusOK, renderPickupChangeNotices(notices), "Pickup change notices read")
}

// pickupChangeNoticesReadRequest names the markers the reader saw, each at
// the revision it was shown in.
type pickupChangeNoticesReadRequest struct {
	Notices []pickupChangeNoticeRevision `json:"notices"`
}

type pickupChangeNoticeRevision struct {
	RequestID  ident.ID  `json:"request_id"`
	InformedAt time.Time `json:"informed_at"`
}

func renderPickupChangeNotices(notices []careplan.PickupChangeTeamNotice) []pickupChangeNoticeResponse {
	out := make([]pickupChangeNoticeResponse, 0, len(notices))
	for _, notice := range notices {
		out = append(out, pickupChangeNoticeResponse{
			RequestID: ident.ID(notice.RequestID), StudentID: ident.ID(notice.StudentID),
			StudentFirstName: notice.StudentFirstName, Date: notice.Date.String(), PickupTime: notice.PickupTime,
			Withdrawn: notice.Withdrawn, InformedAt: notice.InformedAt,
		})
	}
	return out
}
