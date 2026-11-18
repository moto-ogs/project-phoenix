package objects

import (
	"strconv"

	"github.com/moto-ogs/project-phoenix/modules/delivery/contract"
)

func Key(segments ...string) (string, error) {
	return contract.ObjectKey(segments...)
}

// TenantKey builds the canonical per-tenant key for a document-style upload:
// {kind}/{tenantID}/{name}. Tenant isolation on disk mirrors the row-level
// isolation in the database, so a stray filename can never resolve into
// another school's directory.
func TenantKey(kind string, tenantID int64, name string) (string, error) {
	if tenantID <= 0 {
		return "", ErrInvalidKey
	}
	return Key(kind, strconv.FormatInt(tenantID, 10), name)
}
