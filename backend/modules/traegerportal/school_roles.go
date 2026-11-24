package traegerportal

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// SchoolRolesResource serves the roles the session's Träger gives the staff
// of all its schools at /traeger/school-roles (#4810, ADR 0317). Every route
// needs the Träger right „Einstellungen“; Identity & Access opens the
// transactions itself, one per school (ADR 0105).
type SchoolRolesResource struct {
	roles          identityaccess.TraegerSchoolRoles
	requireSetting common.Middleware
}

// NewSchoolRolesResource builds the resource; the root binds requireSetting
// to the Träger right traeger_settings:manage.
func NewSchoolRolesResource(roles identityaccess.TraegerSchoolRoles, requireSetting common.Middleware) *SchoolRolesResource {
	if roles == nil || requireSetting == nil {
		panic("traeger portal school roles: the roles and the right check are required")
	}
	return &SchoolRolesResource{roles: roles, requireSetting: requireSetting}
}

// TraegerRouter returns the routes mounted at /traeger/school-roles.
func (rs *SchoolRolesResource) TraegerRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		settings := r.With(rs.requireSetting)
		settings.Get("/", rs.list)
		settings.Get("/catalog", rs.catalog)
		settings.Post("/", rs.create)
		settings.Put("/{id}", rs.update)
		settings.Get("/{id}/removal-preview", rs.previewRemoval)
		settings.Post("/{id}/removal", rs.remove)
	})
	return r
}

// SchoolRoleCarryResponse is how one school carries a Träger role.
type SchoolRoleCarryResponse struct {
	SchoolID   ident.ID `json:"school_id"`
	SchoolName string   `json:"school_name"`
	// Carried is false while the school has no copy of the role.
	Carried bool `json:"carried"`
	// NameTaken says why: the school uses the name for a role of its own.
	NameTaken bool `json:"name_taken"`
	// Holders counts the people the school gave the role.
	Holders int `json:"holders"`
}

// SchoolRoleResponse is a role of the Träger with the schools that carry it.
type SchoolRoleResponse struct {
	ID            ident.ID                  `json:"id"`
	Name          string                    `json:"name"`
	Description   string                    `json:"description"`
	BaseRole      string                    `json:"base_role"`
	PermissionIDs []ident.ID                `json:"permission_ids"`
	Schools       []SchoolRoleCarryResponse `json:"schools"`
	UpdatedAt     time.Time                 `json:"updated_at"`
	// Version is the read-state token of the role (ADR 0311): a change
	// sends it back as expected_version.
	Version string `json:"version"`
}

// SchoolRoleSchoolResponse is a school of the Träger.
type SchoolRoleSchoolResponse struct {
	ID   ident.ID `json:"id"`
	Name string   `json:"name"`
}

// SchoolRoleListResponse is the page of the Träger-Büro.
type SchoolRoleListResponse struct {
	Roles   []SchoolRoleResponse       `json:"roles"`
	Schools []SchoolRoleSchoolResponse `json:"schools"`
}

// SchoolRolePermissionResponse is a permission a school role may hold.
type SchoolRolePermissionResponse struct {
	ID          ident.ID `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Resource    string   `json:"resource"`
	Action      string   `json:"action"`
}

// SchoolRoleTemplateResponse is the starting selection of one tier.
type SchoolRoleTemplateResponse struct {
	BaseRole      string     `json:"base_role"`
	PermissionIDs []ident.ID `json:"permission_ids"`
}

// SchoolRoleCatalogResponse is what the form of a role chooses from.
type SchoolRoleCatalogResponse struct {
	Permissions []SchoolRolePermissionResponse `json:"permissions"`
	Templates   []SchoolRoleTemplateResponse   `json:"templates"`
}

// SchoolRoleRequest is the whole role; an update replaces every field.
type SchoolRoleRequest struct {
	Name          string     `json:"name"`
	Description   string     `json:"description"`
	BaseRole      string     `json:"base_role"`
	PermissionIDs []ident.ID `json:"permission_ids"`
	// ExpectedVersion is the version of the role an update was made on; a
	// role changed since is refused with general.changed_since_read (ADR
	// 0311). A create ignores it.
	ExpectedVersion string `json:"expected_version"`
}

func (req *SchoolRoleRequest) Bind(*http.Request) error { return nil }

func (req *SchoolRoleRequest) toInput() identityaccess.TraegerSchoolRoleInput {
	return identityaccess.TraegerSchoolRoleInput{
		Name: req.Name, Description: req.Description, BaseRole: req.BaseRole,
		PermissionIDs: ident.Int64s(req.PermissionIDs), ExpectedVersion: req.ExpectedVersion,
	}
}

// SchoolRoleHolderResponse is a person who holds the role at a school.
type SchoolRoleHolderResponse struct {
	AccountID ident.ID `json:"account_id"`
	Name      string   `json:"name"`
	Email     string   `json:"email"`
}

// SchoolRoleRemovalSchoolResponse lists who loses the role at one school.
type SchoolRoleRemovalSchoolResponse struct {
	SchoolID   ident.ID                   `json:"school_id"`
	SchoolName string                     `json:"school_name"`
	Holders    []SchoolRoleHolderResponse `json:"holders"`
	// KeptForInvitations: an invitation of the school names the role, so it
	// stays there as a role of the school's own and nobody loses it.
	KeptForInvitations bool `json:"kept_for_invitations"`
}

// SchoolRoleRemovalResponse is the preview of a removal.
type SchoolRoleRemovalResponse struct {
	RoleID  ident.ID                          `json:"role_id"`
	Name    string                            `json:"name"`
	Schools []SchoolRoleRemovalSchoolResponse `json:"schools"`
	// Version is the token the removal sends back as expected_version.
	Version string `json:"version"`
}

// SchoolRoleRemovalRequest confirms the preview the Träger-Büro saw.
type SchoolRoleRemovalRequest struct {
	ExpectedVersion string `json:"expected_version"`
}

func (req *SchoolRoleRemovalRequest) Bind(*http.Request) error { return nil }

func schoolRoleActor(w http.ResponseWriter, r *http.Request) (identityaccess.TraegerSchoolRoleActor, bool) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 || principal.AccountID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return identityaccess.TraegerSchoolRoleActor{}, false
	}
	return identityaccess.TraegerSchoolRoleActor{
		OrganizationID: principal.OrganizationID(), AccountID: principal.AccountID(),
		IPAddress: common.GetClientIPString(r), UserAgent: r.UserAgent(),
	}, true
}

func schoolRoleActorAndID(w http.ResponseWriter, r *http.Request) (identityaccess.TraegerSchoolRoleActor, int64, bool) {
	actor, ok := schoolRoleActor(w, r)
	if !ok {
		return identityaccess.TraegerSchoolRoleActor{}, 0, false
	}
	id, ok := common.ParseInt64IDWithError(w, r, "id", "invalid role ID")
	return actor, id, ok
}

func (rs *SchoolRolesResource) list(w http.ResponseWriter, r *http.Request) {
	actor, ok := schoolRoleActor(w, r)
	if !ok {
		return
	}
	list, err := rs.roles.ListTraegerSchoolRoles(r.Context(), actor)
	if err != nil {
		common.RenderError(w, r, renderSchoolRoleError(err))
		return
	}
	response := SchoolRoleListResponse{
		Roles:   make([]SchoolRoleResponse, 0, len(list.Roles)),
		Schools: make([]SchoolRoleSchoolResponse, 0, len(list.Schools)),
	}
	for _, role := range list.Roles {
		response.Roles = append(response.Roles, schoolRoleResponse(role))
	}
	for _, school := range list.Schools {
		response.Schools = append(response.Schools, SchoolRoleSchoolResponse{ID: ident.ID(school.ID), Name: school.Name})
	}
	common.Respond(w, r, http.StatusOK, response, "Roles retrieved successfully")
}

func (rs *SchoolRolesResource) catalog(w http.ResponseWriter, r *http.Request) {
	actor, ok := schoolRoleActor(w, r)
	if !ok {
		return
	}
	catalog, err := rs.roles.TraegerSchoolRoleCatalog(r.Context(), actor)
	if err != nil {
		common.RenderError(w, r, renderSchoolRoleError(err))
		return
	}
	response := SchoolRoleCatalogResponse{
		Permissions: make([]SchoolRolePermissionResponse, 0, len(catalog.Permissions)),
		Templates:   make([]SchoolRoleTemplateResponse, 0, len(catalog.Templates)),
	}
	for _, permission := range catalog.Permissions {
		response.Permissions = append(response.Permissions, SchoolRolePermissionResponse{
			ID: ident.ID(permission.ID), Name: permission.Name, Description: permission.Description,
			Resource: permission.Resource, Action: permission.Action,
		})
	}
	for _, template := range catalog.Templates {
		response.Templates = append(response.Templates, SchoolRoleTemplateResponse{BaseRole: template.BaseRole, PermissionIDs: ident.IDs(template.PermissionIDs)})
	}
	common.Respond(w, r, http.StatusOK, response, "Role catalog retrieved successfully")
}

func (rs *SchoolRolesResource) create(w http.ResponseWriter, r *http.Request) {
	actor, ok := schoolRoleActor(w, r)
	if !ok {
		return
	}
	req := &SchoolRoleRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	saved, err := rs.roles.CreateTraegerSchoolRole(r.Context(), actor, req.toInput())
	if err != nil {
		common.RenderError(w, r, renderSchoolRoleError(err))
		return
	}
	common.Respond(w, r, http.StatusCreated, schoolRoleResponse(saved), "Role created successfully")
}

func (rs *SchoolRolesResource) update(w http.ResponseWriter, r *http.Request) {
	actor, id, ok := schoolRoleActorAndID(w, r)
	if !ok {
		return
	}
	req := &SchoolRoleRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	saved, err := rs.roles.UpdateTraegerSchoolRole(r.Context(), actor, id, req.toInput())
	if err != nil {
		common.RenderError(w, r, renderSchoolRoleError(err))
		return
	}
	common.Respond(w, r, http.StatusOK, schoolRoleResponse(saved), "Role updated successfully")
}

func (rs *SchoolRolesResource) previewRemoval(w http.ResponseWriter, r *http.Request) {
	actor, id, ok := schoolRoleActorAndID(w, r)
	if !ok {
		return
	}
	removal, err := rs.roles.PreviewTraegerSchoolRoleRemoval(r.Context(), actor, id)
	if err != nil {
		common.RenderError(w, r, renderSchoolRoleError(err))
		return
	}
	response := SchoolRoleRemovalResponse{
		RoleID: ident.ID(removal.RoleID), Name: removal.Name, Version: removal.Version,
		Schools: make([]SchoolRoleRemovalSchoolResponse, 0, len(removal.Schools)),
	}
	for _, school := range removal.Schools {
		entry := SchoolRoleRemovalSchoolResponse{
			SchoolID: ident.ID(school.SchoolID), SchoolName: school.SchoolName, KeptForInvitations: school.KeptForInvitations,
			Holders: make([]SchoolRoleHolderResponse, 0, len(school.Holders)),
		}
		for _, holder := range school.Holders {
			entry.Holders = append(entry.Holders, SchoolRoleHolderResponse{AccountID: ident.ID(holder.AccountID), Name: holder.Name, Email: holder.Email})
		}
		response.Schools = append(response.Schools, entry)
	}
	common.Respond(w, r, http.StatusOK, response, "Removal preview retrieved successfully")
}

func (rs *SchoolRolesResource) remove(w http.ResponseWriter, r *http.Request) {
	actor, id, ok := schoolRoleActorAndID(w, r)
	if !ok {
		return
	}
	req := &SchoolRoleRemovalRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	if err := rs.roles.RemoveTraegerSchoolRole(r.Context(), actor, id, req.ExpectedVersion); err != nil {
		common.RenderError(w, r, renderSchoolRoleError(err))
		return
	}
	common.RespondNoContent(w, r)
}

func schoolRoleResponse(role identityaccess.TraegerSchoolRole) SchoolRoleResponse {
	response := SchoolRoleResponse{
		ID: ident.ID(role.ID), Name: role.Name, Description: role.Description, BaseRole: role.BaseRole,
		PermissionIDs: ident.IDs(role.PermissionIDs), UpdatedAt: role.UpdatedAt, Version: role.Version,
		Schools: make([]SchoolRoleCarryResponse, 0, len(role.Schools)),
	}
	for _, school := range role.Schools {
		response.Schools = append(response.Schools, SchoolRoleCarryResponse{
			SchoolID: ident.ID(school.SchoolID), SchoolName: school.SchoolName,
			Carried: school.Carried, NameTaken: school.NameTaken, Holders: school.Holders,
		})
	}
	return response
}

// renderSchoolRoleError maps the refusals of the Träger roles onto their
// registered codes.
func renderSchoolRoleError(err error) render.Renderer {
	if invalid, ok := errors.AsType[*identityaccess.TraegerSchoolRoleInvalidError](err); ok {
		return common.ErrorInvalidOnField(invalid, common.CodeGeneralInput, invalid.Field)
	}
	if used, ok := errors.AsType[*identityaccess.TraegerSchoolRoleNameUsedError](err); ok {
		return common.ErrorConflictWithDetails(used, common.CodeTraegerSchoolRoleNameUsedAtSchool, map[string]any{"schools": joinSchoolNames(used.Schools)})
	}
	if reserved, ok := errors.AsType[*identityaccess.ReservedPermissionError](err); ok {
		return common.ErrorInvalidRequestWithDetails(reserved, common.CodeIdentityRolePlatformPermission, map[string]any{"permission": reserved.Permission})
	}
	return schoolRoleErrors(err)
}

var schoolRoleErrors = common.RulesRenderer([]common.ErrorRule{
	{Target: identityaccess.ErrTraegerSchoolRoleNotFound, Render: func(err error) render.Renderer {
		return common.ErrorNotFoundWithCode(err, common.CodeTraegerSchoolRoleNotFound)
	}},
	{Target: identityaccess.ErrTraegerSchoolRoleNameTaken, Render: func(err error) render.Renderer {
		return common.ErrorConflictOnField(err, common.CodeTraegerSchoolRoleNameTaken, "name")
	}},
	{Target: identityaccess.ErrRoleHoldersChanged, Render: func(error) render.Renderer {
		return common.ErrorConflict(readstate.ErrChanged)
	}},
}, common.ErrorInternalServer)

// joinSchoolNames lists the schools like a sentence: „OGS Nord und OGS Süd“.
func joinSchoolNames(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	}
	joined := names[0]
	for _, name := range names[1 : len(names)-1] {
		joined += ", " + name
	}
	return joined + " und " + names[len(names)-1]
}
