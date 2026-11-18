package contract

import (
	"path"
	"strconv"
	"strings"
)

// ObjectKey builds a storage key from segments, rejecting anything that could
// escape the backend root. It is the only supported way to construct a key:
// hand-built strings bypass the traversal check that makes the Backend
// contract safe.
func ObjectKey(segments ...string) (string, error) {
	if len(segments) == 0 {
		return "", ErrInvalidKey
	}
	clean := make([]string, 0, len(segments))
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." {
			return "", ErrInvalidKey
		}
		if strings.ContainsAny(segment, `/\`) {
			return "", ErrInvalidKey
		}
		if strings.Contains(segment, "..") {
			return "", ErrInvalidKey
		}
		clean = append(clean, segment)
	}
	key := path.Join(clean...)
	if key == "" || strings.HasPrefix(key, "/") || strings.Contains(key, "..") {
		return "", ErrInvalidKey
	}
	return key, nil
}

// TenantObjectPrefix identifies a tenant's namespace without including IDs
// that happen to start with the same digits.
func TenantObjectPrefix(kind, layout string, tenantID int64) (string, error) {
	if tenantID <= 0 || kind == "" || strings.ContainsAny(kind, "/\\.") {
		return "", ErrInvalidKey
	}
	prefix := kind + "/" + strconv.FormatInt(tenantID, 10)
	switch layout {
	case "tenantDir":
		return prefix + "/", nil
	case "tenantPrefix":
		return prefix + "_", nil
	default:
		return "", ErrInvalidKey
	}
}
