package contract

import (
	"fmt"
	"slices"
	"strings"
)

// PublicPortal is the pseudo-portal of the routes a request reaches without
// a session (common.PortalPublic). Its proxy reads no session and sends no
// bearer, so a public route lists no other portal.
const PublicPortal = "public"

// publicRoutesStandApart refuses what the session-free proxy path cannot
// honour: a public route beside a session portal, a public write without a
// body limit, a retry trait where no session is renewed, and a public
// pattern that a session pattern of the same method matches with no order
// between them.
func publicRoutesStandApart(routes []Route) error {
	for _, route := range routes {
		if !slices.Contains(route.Portals, PublicPortal) {
			continue
		}
		where := route.Key()
		switch {
		case len(route.Portals) > 1:
			return fmt.Errorf("%s: a public route names no session portal beside %q", where, PublicPortal)
		case route.Method != "GET" && route.MaxBodyBytes == 0:
			return fmt.Errorf("%s: a public write needs MaxBodyBytes", where)
		case route.NoRetryAfterRenewal != "":
			return fmt.Errorf("%s: a public route has no session to renew; drop NoRetryAfterRenewal", where)
		case route.File || route.Multipart:
			return fmt.Errorf("%s: the session-free proxy path answers JSON only; a public file or upload keeps its route file", where)
		}
		for _, other := range routes {
			if other.Method == route.Method && !slices.Contains(other.Portals, PublicPortal) && patternsOverlap(route.Pattern, other.Pattern) {
				return fmt.Errorf("%s overlaps the session route %s", where, other.Key())
			}
		}
	}
	return nil
}

// patternsOverlap says whether one request path can match both patterns
// with no order between them. A parameter matches any segment; where the two
// first differ in kind, the literal wins, in chi as in the proxy, so such a
// pair is ordered. Like the proxy it ignores empty segments, so a trailing
// slash makes no other path.
func patternsOverlap(a, b string) bool {
	left, right := segments(a), segments(b)
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		leftParam, rightParam := isParamSegment(left[i]), isParamSegment(right[i])
		if leftParam != rightParam {
			return false
		}
		if !leftParam && left[i] != right[i] {
			return false
		}
	}
	return true
}

func isParamSegment(segment string) bool {
	return strings.HasPrefix(segment, "{") && strings.HasSuffix(segment, "}")
}

func segments(pattern string) []string {
	return strings.FieldsFunc(pattern, func(r rune) bool { return r == '/' })
}
