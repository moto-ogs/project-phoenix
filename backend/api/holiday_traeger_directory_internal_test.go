package api

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	settings "github.com/moto-ogs/project-phoenix/modules/settings"
)

// The directory reads no row; the ID only names the Träger of the link.
const holidayLinkTraeger int64 = 6052

type holidayLinkOrganizations struct{}

func (holidayLinkOrganizations) FindOrganization(context.Context, int64) (organizationtenancy.Organization, error) {
	return organizationtenancy.Organization{Name: "Ganztag Nord e. V.", Active: true}, nil
}

func (holidayLinkOrganizations) ListSchoolsByOrganization(context.Context, int64) ([]organizationtenancy.School, error) {
	return []organizationtenancy.School{{Name: "OGS Sonnenhof"}}, nil
}

// holidayLinkModules answers the booked modules of the link's Träger.
type holidayLinkModules struct {
	modules []settings.ModuleKey
	err     error
}

func (m holidayLinkModules) BookedModules(context.Context, int64) ([]settings.ModuleKey, error) {
	return m.modules, m.err
}

// The public holiday registration follows Ferienbetreuung (#6052): while no
// school of the Träger books it, the link answers like an expired one, and a
// failed read of the switches is an error, never a closed link.
func TestHolidayLinkClosesWithoutFerienbetreuung(t *testing.T) {
	t.Parallel()
	booked := func(modules ...settings.ModuleKey) TraegerBookedModules {
		return holidayLinkModules{modules: modules}
	}
	directory := func(modules TraegerBookedModules) holidayTraegerDirectory {
		return holidayTraegerDirectory{organizations: holidayLinkOrganizations{}, modules: modules}
	}

	traeger, err := directory(booked(settings.ModuleFerienbetreuung)).HolidayTraeger(context.Background(), holidayLinkTraeger)
	require.NoError(t, err)
	assert.Equal(t, "Ganztag Nord e. V.", traeger.Name)
	assert.Len(t, traeger.Schools, 1)

	_, err = directory(booked(settings.ModuleVertraege)).HolidayTraeger(context.Background(), holidayLinkTraeger)
	require.ErrorIs(t, err, enrollmentOwner.ErrHolidayRegistrationNotFound, "another module does not open the link")

	readErr := errors.New("settings unavailable")
	_, err = directory(holidayLinkModules{err: readErr}).HolidayTraeger(context.Background(), holidayLinkTraeger)
	require.ErrorIs(t, err, readErr)
	require.NotErrorIs(t, err, enrollmentOwner.ErrHolidayRegistrationNotFound)

	_, err = directory(nil).HolidayTraeger(context.Background(), holidayLinkTraeger)
	require.NoError(t, err, "a router without the module lock keeps the link open")
}
