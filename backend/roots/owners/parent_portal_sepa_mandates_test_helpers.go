//go:build testhooks

package owners

import (
	"context"
	"sync"
	"time"

	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// ParentMandateTestSettings is the Träger level of the settings as a test
// sets it: the online mandate switch and the letterhead text per Träger.
type ParentMandateTestSettings struct {
	mu      sync.Mutex
	allowed map[int64]bool
	address map[int64]string
}

// Set turns the online mandate of a Träger on or off with its letterhead.
func (s *ParentMandateTestSettings) Set(organizationID int64, allowed bool, letterhead string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.allowed == nil {
		s.allowed, s.address = map[int64]bool{}, map[int64]string{}
	}
	s.allowed[organizationID], s.address[organizationID] = allowed, letterhead
}

func (s *ParentMandateTestSettings) TraegerBools(_ context.Context, organizationID int64, _ []string) (map[string]bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return map[string]bool{configModels.KeyParentBillingOnlineMandate: s.allowed[organizationID]}, nil
}

func (s *ParentMandateTestSettings) TraegerTexts(_ context.Context, organizationID int64, _ []string) (map[string]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return map[string]string{configModels.KeyBrandingLetterheadText: s.address[organizationID]}, nil
}

// NewParentSEPAMandatesForTests binds the parents' mandates over the real
// store with the settings of the test, the given bank-data cipher and the
// test's day; the store stamps on the real clock.
func NewParentSEPAMandatesForTests(settings *ParentMandateTestSettings, cipher BankDataCipher, today func() calendar.Date) parentportal.SEPAMandatesPort {
	return NewParentSEPAMandates(settings, registryDefaultSchoolSettings{}, cipher, today, time.Now)
}

// registryDefaultSchoolSettings answers every school's settings with the
// registry defaults: the Träger is responsible for everything (#8040).
type registryDefaultSchoolSettings struct{}

func (registryDefaultSchoolSettings) ResolveManyForTenants(_ context.Context, tenantIDs []int64, keys []string) (map[int64]*configModels.SettingsSnapshot, error) {
	result := make(map[int64]*configModels.SettingsSnapshot, len(tenantIDs))
	for _, id := range tenantIDs {
		snapshot, err := configModels.NewSettingsSnapshot(configModels.DefaultRegistry(), id, keys, nil)
		if err != nil {
			return nil, err
		}
		result[id] = snapshot
	}
	return result, nil
}
