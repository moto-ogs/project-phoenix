package operator

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

type updateSchoolRequest struct {
	OrganizationID ident.ID `json:"organization_id"`
	Name           string   `json:"name"`
	Slug           string   `json:"slug"`
	Subdomain      string   `json:"subdomain"`
	Address        string   `json:"address"`
	City           string   `json:"city"`
	Zip            string   `json:"zip"`
	Phone          string   `json:"phone"`
	Email          string   `json:"email"`
	Active         bool     `json:"active"`
	Hidden         bool     `json:"hidden"`
	// ChildQuota is the Kinderkontingent (#3567): absent keeps it, null
	// removes it, an object sets it.
	ChildQuota ChildQuotaField `json:"child_quota"`
}

func (req *updateSchoolRequest) Bind(_ *http.Request) error {
	req.Name = strings.TrimSpace(req.Name)
	req.Slug = strings.TrimSpace(req.Slug)
	req.Subdomain = strings.TrimSpace(req.Subdomain)
	req.Address = strings.TrimSpace(req.Address)
	req.City = strings.TrimSpace(req.City)
	req.Zip = strings.TrimSpace(req.Zip)
	req.Phone = strings.TrimSpace(req.Phone)
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Name == "" {
		return errors.New("name is required")
	}
	if req.Slug == "" {
		return errors.New("slug is required")
	}
	if req.Subdomain == "" {
		return errors.New("subdomain is required")
	}
	return nil
}

// ChildQuotaField remembers whether the request mentioned child_quota at
// all, so an update that leaves it out cannot clear a contract value.
type ChildQuotaField struct {
	present bool
	Value   *childQuotaRequest
}

type childQuotaRequest struct {
	Bundles    int  `json:"bundles"`
	BundleSize *int `json:"bundle_size"`
}

func (f *ChildQuotaField) UnmarshalJSON(data []byte) error {
	f.present = true
	if string(data) == "null" {
		f.Value = nil
		return nil
	}
	value := &childQuotaRequest{}
	if err := json.Unmarshal(data, value); err != nil {
		return fmt.Errorf("child_quota: %w", err)
	}
	f.Value = value
	return nil
}

// change converts the field into the owner's change; nil means unchanged. A
// missing bundle size is the default contract size.
func (f ChildQuotaField) change() *organizationtenancy.ChildQuotaChange {
	if !f.present {
		return nil
	}
	if f.Value == nil {
		return &organizationtenancy.ChildQuotaChange{}
	}
	bundleSize := organizationtenancy.DefaultChildQuotaBundleSize
	if f.Value.BundleSize != nil {
		bundleSize = *f.Value.BundleSize
	}
	return &organizationtenancy.ChildQuotaChange{Quota: &organizationtenancy.ChildQuota{Bundles: f.Value.Bundles, BundleSize: bundleSize}}
}
