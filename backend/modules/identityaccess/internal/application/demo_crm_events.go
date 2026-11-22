package application

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
)

func (d *DemoAccess) notifyDemoRequest(ctx context.Context, access, known domain.DemoAccess, found bool) error {
	if found && known.ContactOptIn == access.ContactOptIn && access.Phone == "" {
		return nil
	}
	if err := d.mail.SendDemoLead(ctx, access); err != nil {
		return err
	}
	if d.crm == nil {
		return nil
	}
	return d.crm.QueueDemoCRM(ctx, access, d.now(), false)
}

func (d *DemoAccess) recordDemoUse(ctx context.Context, access domain.DemoAccess, entry domain.DemoSchoolEntry, role domain.DemoRole, at time.Time) error {
	if err := d.store.RecordDemoAccessUse(ctx, access.ID, entry.AccountID, signedInParent(entry, role), at, at.Add(domain.DemoAccessLifetime)); err != nil {
		return err
	}
	if d.crm != nil && access.UseCount == 0 {
		return d.crm.QueueDemoCRM(ctx, access, at, true)
	}
	return nil
}
