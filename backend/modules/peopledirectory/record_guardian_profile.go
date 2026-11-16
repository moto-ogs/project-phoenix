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

	if g.Email != nil && *g.Email != "" {
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
