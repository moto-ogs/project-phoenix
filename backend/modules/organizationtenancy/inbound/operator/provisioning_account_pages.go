package operator

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

func (rs *ProvisioningResource) ListSchoolAccounts(w http.ResponseWriter, r *http.Request) {
	id, ok := common.ParsePositiveInt64IDWithError(w, r, "id", "invalid school ID")
	if ok {
		rs.listAccountPage(w, r, organizationtenancy.AccountScope{SchoolID: id})
	}
}

func (rs *ProvisioningResource) ListOrganizationAccounts(w http.ResponseWriter, r *http.Request) {
	id, ok := common.ParsePositiveInt64IDWithError(w, r, "id", "invalid organization ID")
	if ok {
		rs.listAccountPage(w, r, organizationtenancy.AccountScope{OrganizationID: id})
	}
}

func (rs *ProvisioningResource) ListAllAccounts(w http.ResponseWriter, r *http.Request) {
	rs.listAccountPage(w, r, organizationtenancy.AccountScope{})
}

func (rs *ProvisioningResource) listAccountPage(w http.ResponseWriter, r *http.Request, scope organizationtenancy.AccountScope) {
	values := r.URL.Query()
	sort, direction := values.Get("sort"), values.Get("direction")
	search, cursor := strings.TrimSpace(values.Get("search")), values.Get("cursor")
	if (direction != "" && direction != "asc" && direction != "desc") || len(cursor) > 512 || len(search) > 512 || !utf8.ValidString(search) || strings.ContainsRune(search, 0) {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid account list query")))
		return
	}
	page, err := rs.service.ListAccountPage(r.Context(), scope, organizationtenancy.AccountPageQuery{
		Sort: sort, Descending: direction == "desc", Search: search, Cursor: cursor,
	})
	if err != nil {
		common.RenderError(w, r, ProvisioningErrorRenderer(err))
		return
	}
	params := common.PaginationParams{Page: page.Number, PageSize: organizationtenancy.AccountPageSize, Total: page.Total, NextCursor: page.NextCursor}
	if scope.SchoolID != 0 {
		rows := make([]organizationtenancy.SchoolAccount, 0, len(page.Rows))
		for _, row := range page.Rows {
			rows = append(rows, row.SchoolAccount)
		}
		common.RespondPaginated(w, r, http.StatusOK, rows, params, "School accounts retrieved successfully")
		return
	}
	common.RespondPaginated(w, r, http.StatusOK, page.Rows, params, "Accounts retrieved successfully")
}
