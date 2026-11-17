package compose

import (
	"errors"
	"log/slog"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/exporttransfer"
	"github.com/moto-ogs/project-phoenix/modules/exporttransfer/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/exporttransfer/internal/adapters/sftp"
	"github.com/moto-ogs/project-phoenix/modules/exporttransfer/internal/application"
	"github.com/moto-ogs/project-phoenix/modules/exporttransfer/internal/ports"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewTraegerTransfers builds the Träger scope (ADR 0218) with the root's clock and the production transport, public destinations only; tests append the loopback policy.
func NewTraegerTransfers(cipher exporttransfer.BankDataCipher, now func() time.Time, logger *slog.Logger, transport ...sftp.Option) (exporttransfer.TraegerTransfers, error) {
	if cipher == nil || now == nil {
		return nil, errors.New("export transfer compose: the bank cipher and the clock are required for the Träger scope")
	}
	store := traegerStore(now)
	return application.NewTraegerService(store, store, retainedUploader{Client: sftp.New(transport...)}, cipher,
		ports.TraegerRuntime{Detached: retainedNewDetachedContext(), WithinTraeger: tenant.WithinTraeger}, logger), nil
}

// NewRecipientRekey builds the maintenance-only rekey of the recipient password; never bind it to HTTP.
func NewRecipientRekey(rewrapper exporttransfer.BankDataRewrapper) exporttransfer.RecipientRekey {
	return application.RecipientRekey{Recipients: traegerStore(nil), Rewrapper: rewrapper} // stamps nothing
}

func traegerStore(now func() time.Time) *postgres.TraegerStore {
	return postgres.NewTraegerStore(postgres.NewTraegerDatabase(tenant.TransactionFromContext, tenant.TraegerTransactionFromContext), now)
}
