package peopledirectory

import (
	"errors"
	"net/mail"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory/contact"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

func (g *GuardianProfileSnapshot) Validate() error {

	g.FirstName = textnorm.Name(g.FirstName)
	g.LastName = textnorm.Name(g.LastName)

	// An empty address is stored as NULL: staff clear a wrong address by
	// emptying the field, and UNIQUE(tenant_id, LOWER(email)) would let only
	// one profile per school hold "".
	if g.Email != nil && strings.TrimSpace(*g.Email) == "" {
		g.Email = nil
	}
	if g.Email != nil {
		*g.Email = strings.TrimSpace(strings.ToLower(*g.Email))
		if _, err := mail.ParseAddress(*g.Email); err != nil {
			return errors.New("invalid email format")
		}
	}

	if g.PreferredContactMethod != "" && !contact.IsPreferredContactMethod(g.PreferredContactMethod) {
		return errors.New("invalid preferred contact method")
	}

	return nil
}
