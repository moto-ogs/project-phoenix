// Package schoolstructurehttp is the School Structure HTTP adapter of the group routes
// under /api/groups (#2742). It drives the owner's group service and reads
// children and persons through the People Directory port the root binds.
package schoolstructurehttp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	education "github.com/moto-ogs/project-phoenix/modules/schoolstructure/contract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// GroupPeople is the People Directory side of the group routes: the children
// of a group. The root binds it to the retained person service.
type GroupPeople interface {
	// GroupStudents returns the children of a group.
	GroupStudents(ctx context.Context, groupID int64) ([]peopledirectory.StudentRecord, error)
	// CountByGroupIDs counts the children of each group.
	CountByGroupIDs(ctx context.Context, groupIDs []int64) (map[int64]int, error)
}

// Resource defines the group API resource
type Resource struct {
	ConstraintViolation func(error) bool
	EducationService    GroupService
	People              GroupPeople
}

// NewResource creates a new groups resource
func NewResource(educationService GroupService, people GroupPeople, constraintViolation func(error) bool) *Resource {
	if constraintViolation == nil {
		panic("group resource: database failure classifier is required")
	}
	return &Resource{
		ConstraintViolation: constraintViolation,
		EducationService:    educationService,
		People:              people,
	}
}

// Router returns a configured router for group endpoints
func (rs *Resource) Router(protectedTenantRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))

	// Protected routes that require authentication and permissions
	protectedTenantRoutes(r, func(r chi.Router, withTx common.Middleware) {

		// Read operations only require groups:read permission
		r.With(common.RequiresPermission(permissions.GroupsRead), withTx).Get("/", rs.listGroups)
		r.With(common.RequiresPermission(permissions.GroupsRead), withTx).Get("/{id}", rs.getGroup)

		// Write operations require groups:create, groups:update, or groups:delete permission
		r.With(common.RequiresPermission(permissions.GroupsCreate), withTx).Post("/", rs.createGroup)
		r.With(common.RequiresPermission(permissions.GroupsUpdate), withTx).Put("/{id}", rs.updateGroup)
		r.With(common.RequiresPermission(permissions.GroupsDelete), withTx).Delete("/{id}", rs.deleteGroup)
	})

	return r
}

// GroupResponse represents a group API response
type GroupResponse struct {
	ID               common.ID         `json:"id"`
	Name             string            `json:"name"`
	RoomID           *common.ID        `json:"room_id,omitempty"`
	Room             *Room             `json:"room,omitempty"`
	RepresentativeID *common.ID        `json:"representative_id,omitempty"`
	Representative   *TeacherResponse  `json:"representative,omitempty"`
	Teachers         []TeacherResponse `json:"teachers,omitempty"`
	StudentCount     int               `json:"student_count"`
	CreatedAt        time.Time         `json:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
}

// TeacherResponse represents a teacher in API responses
type TeacherResponse struct {
	ID             common.ID `json:"id"`
	StaffID        common.ID `json:"staff_id"`
	FirstName      string    `json:"first_name"`
	LastName       string    `json:"last_name"`
	Specialization string    `json:"specialization"`
	Role           string    `json:"role,omitempty"`
	FullName       string    `json:"full_name"`
}

// Room represents a simplified room for inclusion in group responses
type Room struct {
	ID   common.ID `json:"id"`
	Name string    `json:"name"`
}

// GroupRequest represents a group creation/update request
type GroupRequest struct {
	Name       string      `json:"name"`
	RoomID     *common.ID  `json:"room_id,omitempty"`
	TeacherIDs []common.ID `json:"teacher_ids,omitempty"`
}

// Bind validates the group request
func (req *GroupRequest) Bind(_ *http.Request) error {
	if req.Name == "" {
		return errors.New("group name is required")
	}
	return nil
}

// newGroupResponse converts a group model to a response object
func newGroupResponse(group *education.Group, teachers []*education.Teacher, studentCount int) GroupResponse {
	response := GroupResponse{
		ID:           ident.ID(group.ID),
		Name:         group.Name,
		RoomID:       (*ident.ID)(group.RoomID),
		StudentCount: studentCount,
		CreatedAt:    group.CreatedAt,
		UpdatedAt:    group.UpdatedAt,
	}

	// Add room details if available
	if group.Room != nil {
		response.Room = &Room{
			ID:   group.Room.ID,
			Name: group.Room.Name,
		}
	}

	// Add teacher details if available
	if len(teachers) > 0 {
		teacherResponses := make([]TeacherResponse, 0, len(teachers))

		// First teacher is the representative by convention
		firstTeacher := teachers[0]
		response.RepresentativeID = (*ident.ID)(&firstTeacher.ID)

		// Convert all teachers to response format
		for _, teacher := range teachers {
			teacherResp := TeacherResponse{
				ID:             ident.ID(teacher.ID),
				StaffID:        ident.ID(teacher.StaffID),
				Specialization: teacher.Specialization,
				Role:           teacher.Role,
				FullName:       teacher.FullName(),
			}

			// Extract first and last name from staff if available
			if teacher.Person != nil {
				teacherResp.FirstName = teacher.Person.FirstName
				teacherResp.LastName = teacher.Person.LastName
			}

			teacherResponses = append(teacherResponses, teacherResp)
		}

		// Set first teacher as representative
		response.Representative = &teacherResponses[0]
		response.Teachers = teacherResponses
	}

	return response
}

// =============================================================================
// HELPER METHODS - Reduce code duplication for common parsing/validation
// =============================================================================

// =============================================================================
// GROUP HANDLERS
// =============================================================================

// listGroups handles listing all groups with optional filtering
func (rs *Resource) listGroups(w http.ResponseWriter, r *http.Request) {
	// Add filters if provided
	name := r.URL.Query().Get("name")
	roomIDStr := r.URL.Query().Get("room_id")
	query := &education.GroupListQuery{NameContains: name}

	if roomIDStr != "" {
		roomID, err := strconv.ParseInt(roomIDStr, 10, 64)
		if err == nil {
			query.RoomID = &roomID
		}
	}

	page, pageSize := common.ParsePagination(r)
	query.Limit = pageSize
	query.Offset = (page - 1) * pageSize

	// Get all groups
	groups, err := rs.EducationService.ListGroups(r.Context(), query)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("list groups", err))
		return
	}

	responses, err := rs.groupResponses(r.Context(), groups)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("load group details", err))
		return
	}

	// Count total for pagination (same filters, no LIMIT/OFFSET)
	total, err := rs.EducationService.CountGroups(r.Context(), query)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("count groups", err))
		return
	}

	common.RespondPaginated(w, r, http.StatusOK, responses, common.PaginationParams{Page: page, PageSize: pageSize, Total: total}, "Groups retrieved successfully")
}

// getGroup handles getting a group by ID
func (rs *Resource) getGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := common.ParseInt64IDWithError(w, r, "id", common.MsgInvalidGroupID)
	if !ok {
		return
	}

	// Get group with room details
	group, err := rs.EducationService.FindGroupWithRoom(r.Context(), id)
	if err != nil {
		common.RenderError(w, r, common.ErrorNotFound(errors.New(common.MsgGroupNotFound)))
		return
	}

	response, err := rs.groupResponse(r.Context(), group)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("load group details", err))
		return
	}

	common.Respond(w, r, http.StatusOK, response, "Group retrieved successfully")
}

// createGroup handles creating a new group
func (rs *Resource) createGroup(w http.ResponseWriter, r *http.Request) {
	// Parse request
	req := &GroupRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}

	// Create group
	group := &education.Group{
		Name:   req.Name,
		RoomID: (*int64)(req.RoomID),
	}

	if err := tenant.WithinCurrentTenant(r.Context(), func(ctx context.Context) error {
		if err := rs.EducationService.CreateGroup(ctx, group); err != nil {
			return err
		}
		// Assign teachers to the group if any were provided
		if len(req.TeacherIDs) > 0 {
			if err := rs.EducationService.UpdateGroupTeachers(ctx, group.ID, ident.Int64s(req.TeacherIDs)); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		// The route-level tenant transaction is the outer transaction. A 4xx
		// response would otherwise commit partial group/teacher writes.
		tenant.MarkRollback(r.Context())
		common.RenderError(w, r, ErrorRenderer(err))
		return
	}

	response, err := rs.storedGroupResponse(r.Context(), group.ID)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("load created group", err))
		return
	}

	common.Respond(w, r, http.StatusCreated, response, "Group created successfully")
}

// updateGroup handles updating a group
func (rs *Resource) updateGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := common.ParseInt64IDWithError(w, r, "id", common.MsgInvalidGroupID)
	if !ok {
		return
	}

	// Parse request
	req := &GroupRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}

	// Get existing group
	group, err := rs.EducationService.GetGroup(r.Context(), id)
	if err != nil {
		common.RenderError(w, r, common.ErrorNotFound(errors.New(common.MsgGroupNotFound)))
		return
	}

	// Update fields
	group.Name = req.Name
	group.RoomID = (*int64)(req.RoomID)

	// Update group
	if err := tenant.WithinCurrentTenant(r.Context(), func(ctx context.Context) error {
		if err := rs.EducationService.UpdateGroup(ctx, group); err != nil {
			return err
		}
		// Update teacher assignments if provided
		if req.TeacherIDs != nil {
			if err := rs.EducationService.UpdateGroupTeachers(ctx, group.ID, ident.Int64s(req.TeacherIDs)); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		// ErrorRenderer maps validation failures to 4xx; explicitly request a
		// rollback so a partial teacher-set mutation cannot commit with that
		// non-5xx response.
		tenant.MarkRollback(r.Context())
		common.RenderError(w, r, ErrorRenderer(err))
		return
	}

	response, err := rs.storedGroupResponse(r.Context(), group.ID)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("load updated group", err))
		return
	}

	common.Respond(w, r, http.StatusOK, response, "Group updated successfully")
}

// groupResponses adds the teachers and student counts of a page of groups in
// two batch reads. A failed read is an error, not groups without teachers or
// children (#6849).
func (rs *Resource) groupResponses(ctx context.Context, groups []*education.Group) ([]GroupResponse, error) {
	groupIDs := make([]int64, len(groups))
	for i, g := range groups {
		groupIDs[i] = g.ID
	}
	studentCounts, err := rs.People.CountByGroupIDs(ctx, groupIDs)
	if err != nil {
		return nil, fmt.Errorf("count group students: %w", err)
	}
	teachersByGroup, err := rs.EducationService.GetTeachersForGroups(ctx, groupIDs)
	if err != nil {
		return nil, fmt.Errorf("load group teachers: %w", err)
	}
	responses := make([]GroupResponse, 0, len(groups))
	for _, group := range groups {
		responses = append(responses, newGroupResponse(group, teachersByGroup[group.ID], studentCounts[group.ID]))
	}
	return responses, nil
}

// storedGroupResponse reads a group back after a write. A failed read answers
// 500, which rolls the write back, instead of a response without room,
// teachers or children (#6849).
func (rs *Resource) storedGroupResponse(ctx context.Context, groupID int64) (GroupResponse, error) {
	group, err := rs.EducationService.FindGroupWithRoom(ctx, groupID)
	if err != nil {
		return GroupResponse{}, fmt.Errorf("load group: %w", err)
	}
	return rs.groupResponse(ctx, group)
}

// groupResponse adds a group's teachers and student count. A failed read is
// an error, not a group without teachers or children (#6849).
func (rs *Resource) groupResponse(ctx context.Context, group *education.Group) (GroupResponse, error) {
	teachers, err := rs.EducationService.GetGroupTeachers(ctx, group.ID)
	if err != nil {
		return GroupResponse{}, fmt.Errorf("load group teachers: %w", err)
	}
	students, err := rs.People.GroupStudents(ctx, group.ID)
	if err != nil {
		return GroupResponse{}, fmt.Errorf("count group students: %w", err)
	}
	return newGroupResponse(group, teachers, len(students)), nil
}

// deleteGroup handles deleting a group
func (rs *Resource) deleteGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := common.ParseInt64IDWithError(w, r, "id", common.MsgInvalidGroupID)
	if !ok {
		return
	}

	// Delete group
	if err := tenant.WithinCurrentTenant(r.Context(), func(ctx context.Context) error {
		return rs.EducationService.DeleteGroup(ctx, id)
	}); err != nil {
		if rs.ConstraintViolation(err) {
			common.RenderError(w, r, common.ErrorConflictMessage("Gruppe kann nicht gelöscht werden: Gruppe wird noch in anderen Bereichen referenziert"))
			return
		}
		common.RenderError(w, r, ErrorRenderer(err))
		return
	}

	common.Respond(w, r, http.StatusOK, nil, "Group deleted successfully")
}
