package traegerportal

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/render"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

func TestAuthenticationOrganizationIDs(t *testing.T) {
	t.Parallel()
	const organizationID = 9007199254740993
	response := loginResponse(&identityaccess.TraegerLoginResult{
		Status:         identityaccess.TraegerLoginMFARequired,
		OrganizationID: organizationID,
		Organizations:  []identityaccess.TraegerOrganization{{ID: organizationID, Name: "Träger"}},
	})
	data, err := wire.Marshal(response)
	require.NoError(t, err)
	var body struct {
		OrganizationID string `json:"organization_id"`
		Organizations  []struct {
			ID string `json:"id"`
		} `json:"organizations"`
	}
	require.NoError(t, json.Unmarshal(data, &body))
	require.Equal(t, "9007199254740993", body.OrganizationID)
	require.Len(t, body.Organizations, 1)
	require.Equal(t, "9007199254740993", body.Organizations[0].ID)

	for _, id := range []string{`"9007199254740993"`, `9007199254740993`, `-1`} {
		t.Run(id, func(t *testing.T) {
			login := &TraegerLoginRequest{}
			mfa := &TraegerMFAVerifyRequest{}
			for _, request := range []render.Binder{login, mfa} {
				r := httptest.NewRequest("POST", "/", strings.NewReader(`{"email":"a@b.de","password":"pw","challenge_token":"challenge","code":"123456","organization_id":`+id+`}`))
				r.Header.Set("Content-Type", "application/json")
				err := render.Bind(r, request)
				if id == "-1" {
					require.Error(t, err)
				} else {
					require.NoError(t, err)
				}
			}
			if id != "-1" {
				require.EqualValues(t, organizationID, login.OrganizationID)
				require.EqualValues(t, organizationID, mfa.OrganizationID)
			}
		})
	}
}
