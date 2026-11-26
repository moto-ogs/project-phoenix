package catererportalhttp

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/mealplan"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
	"github.com/moto-ogs/project-phoenix/workflows/catererportal"
)

// PreviewResponse is what the acceptance page shows.
type PreviewResponse struct {
	Email             string    `json:"email"`
	CatererName       string    `json:"caterer_name"`
	SchoolName        string    `json:"school_name"`
	ExpiresAt         time.Time `json:"expires_at"`
	HasCatererAccount bool      `json:"has_caterer_account"`
	AddressTaken      bool      `json:"address_taken"`
}

// SchoolResponse is a school the caterer supplies.
type SchoolResponse struct {
	ID   ident.ID `json:"id"`
	Name string   `json:"name"`
}

// SchoolsResponse is the caterer and its schools.
type SchoolsResponse struct {
	CatererName string                  `json:"caterer_name"`
	Schools     []SchoolSummaryResponse `json:"schools"`
}

// SchoolSummaryResponse is one currently supplied school, without detail rows.
type SchoolSummaryResponse struct {
	ID              ident.ID                `json:"id"`
	Name            string                  `json:"name"`
	DeliveryAddress string                  `json:"delivery_address"`
	StartedAt       *time.Time              `json:"started_at,omitempty"`
	Names           bool                    `json:"names"`
	ByClass         bool                    `json:"by_class"`
	Failure         *SummaryFailureResponse `json:"failure,omitempty"`
	Days            []SummaryDayResponse    `json:"days"`
}

// SummaryFailureResponse exposes only the registered error identity, never diagnostics.
type SummaryFailureResponse struct {
	Status int    `json:"status"`
	Code   string `json:"code"`
}

type SummaryDayResponse struct {
	Date     string    `json:"date" contract:"date"`
	Closed   bool      `json:"closed"`
	Deadline time.Time `json:"deadline"`
	Status   string    `json:"status"`
	OrderID  ident.ID  `json:"order_id,omitempty"`
	Total    int       `json:"total"`
	Added    int       `json:"added"`
	Removed  int       `json:"removed"`
}

// OrderChildResponse is a child in an order; names reach the caterer only while
// the school shows them.
type OrderChildResponse struct {
	FirstName   string `json:"first_name,omitempty"`
	LastName    string `json:"last_name,omitempty"`
	SchoolClass string `json:"school_class,omitempty"`
}

// ChangeResponse is a numbered change after the deadline.
type ChangeResponse struct {
	Sequence   int                `json:"sequence"`
	Child      OrderChildResponse `json:"child"`
	Delta      int                `json:"delta"`
	DetectedAt time.Time          `json:"detected_at"`
}

// ClassCountResponse is the number of meals of a class.
type ClassCountResponse struct {
	SchoolClass string `json:"school_class"`
	Count       int    `json:"count"`
}

// DayResponse is one weekday of a school's orders.
type DayResponse struct {
	Date        string               `json:"date" contract:"date"`
	Closed      bool                 `json:"closed"`
	Deadline    time.Time            `json:"deadline"`
	Status      string               `json:"status"`
	OrderID     ident.ID             `json:"order_id,omitempty"`
	ConfirmedAt *time.Time           `json:"confirmed_at,omitempty"`
	Total       int                  `json:"total"`
	Classes     []ClassCountResponse `json:"classes"`
	Children    []OrderChildResponse `json:"children"`
	Changes     []ChangeResponse     `json:"changes"`
}

// SchoolOrdersResponse is a school's orders as its caterer reads them.
type SchoolOrdersResponse struct {
	School          SchoolResponse `json:"school"`
	DeliveryAddress string         `json:"delivery_address"`
	FormatVersion   int            `json:"format_version"`
	Rhythm          string         `json:"rhythm"`
	Detail          string         `json:"detail"`
	Days            []DayResponse  `json:"days"`
}

type acceptRequest struct {
	Password        string `json:"password"`
	ConfirmPassword string `json:"confirm_password"`
}

func schoolResponse(school catererportal.School) SchoolResponse {
	return SchoolResponse{ID: ident.ID(school.ID), Name: school.Name}
}

func childResponse(child mealplan.OrderChild) OrderChildResponse {
	return OrderChildResponse{FirstName: child.FirstName, LastName: child.LastName, SchoolClass: child.SchoolClass}
}

func dayResponse(day mealplan.OrderDay) DayResponse {
	response := DayResponse{
		Date: string(day.Date), Closed: day.Closed, Deadline: day.Deadline, Status: string(day.Status),
		ConfirmedAt: day.ConfirmedAt, Total: day.Total, Classes: make([]ClassCountResponse, 0, len(day.Classes)),
		Children: make([]OrderChildResponse, 0, len(day.Children)), Changes: make([]ChangeResponse, 0, len(day.Changes)),
	}
	if day.OrderID > 0 {
		response.OrderID = ident.ID(day.OrderID)
	}
	for _, count := range day.Classes {
		response.Classes = append(response.Classes, ClassCountResponse(count))
	}
	for _, child := range day.Children {
		response.Children = append(response.Children, childResponse(child))
	}
	for _, change := range day.Changes {
		response.Changes = append(response.Changes, ChangeResponse{Sequence: change.Sequence, Child: childResponse(change.Child), Delta: change.Delta, DetectedAt: change.DetectedAt})
	}
	return response
}

func invitationPath(r *http.Request) (int64, string, bool) {
	schoolID, ok := pathID(r, "schoolId")
	token := strings.TrimSpace(chi.URLParam(r, "token"))
	return schoolID, token, ok && token != ""
}

// previewInvitation shows what the link offers, in the school it names.
func (rs *Resource) previewInvitation(w http.ResponseWriter, r *http.Request) {
	schoolID, token, ok := invitationPath(r)
	if !ok {
		renderFailure(w, r, identityaccess.ErrInvitationNotFound)
		return
	}
	preview, err := rs.portal.PreviewInvitation(r.Context(), schoolID, token)
	if err != nil {
		renderFailure(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, PreviewResponse(preview), "Invitation retrieved")
}

// acceptInvitation spends the invitation: a new caterer sets its password,
// an existing one confirms with it.
func (rs *Resource) acceptInvitation(w http.ResponseWriter, r *http.Request) {
	schoolID, token, ok := invitationPath(r)
	if !ok {
		renderFailure(w, r, identityaccess.ErrInvitationNotFound)
		return
	}
	var request acceptRequest
	if err := wire.Decode(r.Body, &request); err != nil || request.Password == "" {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("password is required")))
		return
	}
	err := rs.portal.AcceptInvitation(r.Context(), schoolID, token, identityaccess.CatererRegistration{
		Password: request.Password, ConfirmPassword: request.ConfirmPassword,
		IPAddress: common.GetClientIPString(r), UserAgent: r.UserAgent(),
	})
	if err != nil {
		renderFailure(w, r, err)
		return
	}
	common.RespondNoContent(w, r)
}

// getSchools returns the order overview; a retry may select one supplied school.
func (rs *Resource) getSchools(w http.ResponseWriter, r *http.Request) {
	from, to, ok := orderWindow(w, r)
	if !ok {
		return
	}
	var id int64
	if r.URL.Query().Has("school_id") {
		var err error
		id, err = strconv.ParseInt(r.URL.Query().Get("school_id"), 10, 64)
		if err != nil || id <= 0 {
			common.RenderError(w, r, common.ErrorInvalidRequest(errInvalidID))
			return
		}
	}
	schools, err := rs.portal.OrderOverview(r.Context(), rs.currentAccountID(r.Context()), id, from, to)
	if err != nil {
		renderFailure(w, r, err)
		return
	}
	response := SchoolsResponse{CatererName: schools.CatererName, Schools: make([]SchoolSummaryResponse, 0, len(schools.Schools))}
	for _, school := range schools.Schools {
		row := SchoolSummaryResponse{ID: ident.ID(school.ID), Name: school.Name, DeliveryAddress: school.DeliveryAddress, Names: school.Summary.Names, ByClass: school.Summary.ByClass, Failure: summaryFailure(r, school), Days: make([]SummaryDayResponse, 0, len(school.Summary.Days))}
		if !school.StartedAt.IsZero() {
			row.StartedAt = &school.StartedAt
		}
		for _, day := range school.Summary.Days {
			row.Days = append(row.Days, SummaryDayResponse{Date: day.Date.String(), Closed: day.Closed, Deadline: day.Deadline, Status: string(day.Status), OrderID: ident.ID(day.OrderID), Total: day.Total, Added: day.Added, Removed: day.Removed})
		}
		response.Schools = append(response.Schools, row)
	}
	common.Respond(w, r, http.StatusOK, response, "Order overview retrieved")
}

func summaryFailure(r *http.Request, school catererportal.SchoolSummary) *SummaryFailureResponse {
	if school.Failure == nil {
		return nil
	}
	failure := common.RenderWithRules(school.Failure, errorRules, common.ErrorInternalServerRenderer("school order overview failed"))
	status, code := http.StatusInternalServerError, common.CodeGeneralServer
	if problem, ok := failure.(*common.ErrResponse); ok {
		status, code = problem.HTTPStatusCode, problem.Code
		if code == "" {
			code = common.ErrorClassCode(status)
		}
	}
	if status >= 500 {
		slog.WarnContext(r.Context(), "school order overview failed",
			"school_id", school.ID,
			"code", code,
			"error", school.Failure,
		)
	}
	return &SummaryFailureResponse{Status: status, Code: code}
}

// getSchoolOrders returns one school's orders of [from, to].
func (rs *Resource) getSchoolOrders(w http.ResponseWriter, r *http.Request) {
	schoolID, ok := pathID(r, "schoolId")
	if !ok {
		common.RenderError(w, r, common.ErrorInvalidRequest(errInvalidID))
		return
	}
	from, to, ok := orderWindow(w, r)
	if !ok {
		return
	}
	orders, err := rs.portal.SchoolOrders(r.Context(), rs.currentAccountID(r.Context()), schoolID, from, to)
	if err != nil {
		renderFailure(w, r, err)
		return
	}
	response := SchoolOrdersResponse{
		School: schoolResponse(orders.School), DeliveryAddress: orders.DeliveryAddress, FormatVersion: mealplan.OrderFormatVersion,
		Rhythm: orders.Orders.Rhythm, Detail: orders.Orders.Detail, Days: make([]DayResponse, 0, len(orders.Orders.Days)),
	}
	for _, day := range orders.Orders.Days {
		response.Days = append(response.Days, dayResponse(day))
	}
	common.Respond(w, r, http.StatusOK, response, "Orders retrieved")
}

// confirmOrder records that the caterer received a fixed order.
func (rs *Resource) confirmOrder(w http.ResponseWriter, r *http.Request) {
	schoolID, schoolOK := pathID(r, "schoolId")
	orderID, orderOK := pathID(r, "orderId")
	if !schoolOK || !orderOK {
		common.RenderError(w, r, common.ErrorInvalidRequest(errInvalidID))
		return
	}
	if err := rs.portal.ConfirmOrder(r.Context(), rs.currentAccountID(r.Context()), schoolID, orderID); err != nil {
		renderFailure(w, r, err)
		return
	}
	common.RespondNoContent(w, r)
}

func orderWindow(w http.ResponseWriter, r *http.Request) (mealplan.Date, mealplan.Date, bool) {
	from, fromErr := mealplan.ParseDate(r.URL.Query().Get("from"))
	to, toErr := mealplan.ParseDate(r.URL.Query().Get("to"))
	if fromErr != nil || toErr != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("from and to must be in YYYY-MM-DD format")))
		return "", "", false
	}
	return from, to, true
}
