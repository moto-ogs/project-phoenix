package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/url"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

func localSeedAccountsEnabled(baseURL string, options SeedOptions) bool {
	if options.StandingDemo || options.VisitorFirstName != "" {
		return false
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || net.ParseIP(host).IsLoopback()
}

// registerSeedStaffAccount uses the tenant registration contract shared by
// local review accounts. Credentials stay with their callers, not in errors.
func registerSeedStaffAccount(rt *Runtime, body map[string]any) (AccountCredentials, error) {
	raw, err := rt.Client.PostWithAuth(rt.TenantAuth, "/auth/register", body)
	if err != nil {
		return AccountCredentials{}, err
	}
	var account struct {
		Data struct {
			ID             ident.ID `json:"id"`
			SchoolIdentity *struct {
				StaffID ident.ID `json:"staff_id"`
			} `json:"school_identity"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &account); err != nil {
		return AccountCredentials{}, fmt.Errorf("decode registered staff account: %w", err)
	}
	if account.Data.ID <= 0 || account.Data.SchoolIdentity == nil || account.Data.SchoolIdentity.StaffID <= 0 {
		return AccountCredentials{}, fmt.Errorf("registered account has no account or staff identity")
	}
	return AccountCredentials{AccountID: int64(account.Data.ID), StaffID: int64(account.Data.SchoolIdentity.StaffID)}, nil
}
