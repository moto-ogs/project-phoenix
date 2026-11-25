package operatoraccountdirectory

import (
	"github.com/moto-ogs/project-phoenix/modules/operatoraccountdirectory/contract"
	"github.com/moto-ogs/project-phoenix/modules/operatoraccountdirectory/internal/postgres"
)

func New(database postgres.Database) contract.AccountDirectory {
	return postgres.New(database)
}
