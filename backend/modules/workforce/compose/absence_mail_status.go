package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/application"
)

// NewAbsenceMailStatus builds what both sides of an absence request read
// about its mails (#7058) over Delivery's outcomes, which the root binds.
func NewAbsenceMailStatus(outcomes workforce.MailOutcomes) (workforce.AbsenceMailStatus, error) {
	return application.NewAbsenceMailStatus(outcomes)
}
