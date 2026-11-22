package contract

import (
	"fmt"
	"reflect"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common/contractmodel"
)

// outside builds a catalog line the contract does not type (#7808). It
// names a reason of the closed set and why it applies, and nothing a
// contract would say: no portal, query, type or trait.
func outside(rc Registration) (Outside, error) {
	line := Outside{Method: rc.Method, Pattern: rc.Pattern, Reason: rc.Outside.Reason, Why: strings.TrimSpace(rc.Outside.Why)}
	where := line.Key()
	switch {
	case rc.Method == "" || !strings.HasPrefix(rc.Pattern, "/"):
		return line, fmt.Errorf("invalid route registration %q", where)
	case !slices.Contains(contractmodel.OutsideReasons, line.Reason):
		return line, fmt.Errorf("%s: %q is no reason to stay outside the contract; one of %s, or register a contract", where, line.Reason, strings.Join(contractmodel.OutsideReasons, ", "))
	case line.Why == "":
		return line, fmt.Errorf("%s: say in one sentence why the line stays outside the contract", where)
	}
	bare := rc
	bare.Method, bare.Pattern, bare.Outside = "", "", nil
	if !reflect.ValueOf(bare).IsZero() {
		return line, fmt.Errorf("%s stays outside the contract and names a portal, a type or a trait; drop them, or drop Outside", where)
	}
	return line, nil
}

// routeFileTraits keeps a route served by its portal's own route file to
// what such a file reads: the types, a body limit of an upload, NoCommit. A
// trait only the catalog proxy honours, or the public portal, has no place
// on it; an answer without the envelope has no place elsewhere.
func routeFileTraits(rc Registration, where string) error {
	if rc.RouteFile == "" {
		if rc.Plain {
			return fmt.Errorf("%s: only a route file reads an answer without the envelope; name RouteFile or answer the envelope", where)
		}
		return nil
	}
	switch {
	case strings.TrimSpace(rc.RouteFile) == "":
		return fmt.Errorf("%s: RouteFile says why the portal's route file serves it", where)
	case slices.Contains(rc.Portals, PublicPortal):
		return fmt.Errorf("%s: a route file route names the portal whose route file calls it, not %q", where, PublicPortal)
	case rc.NoRetryAfterRenewal != "" || rc.PublicFile != "" || rc.PublicUpload != "" || rc.FileCache != "" || rc.ConditionalGet || rc.PrivateCache:
		return fmt.Errorf("%s: the catalog proxy never serves a route file route; drop its proxy traits", where)
	case rc.Plain && (rc.Response == nil || rc.Paginated || rc.Variants != nil):
		return fmt.Errorf("%s: a plain answer is one registered response", where)
	}
	return nil
}
