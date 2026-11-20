package contract

import (
	"fmt"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common/contractmodel"
)

// PublicPortal is the pseudo-portal of the routes a request reaches without
// a session (common.PortalPublic). Its proxy reads no session and sends no
// bearer, so a public route lists no other portal.
const PublicPortal = "public"

// publicRoutesStandApart refuses what the session-free proxy path cannot
// honour: a public route beside a session portal, a public write without a
// body limit, a retry trait where no session is renewed, a public upload, a
// public file its registration does not mark, and a public pattern that a
// session pattern of the same method matches with no order between them.
func publicRoutesStandApart(routes []Route) error {
	for _, route := range routes {
		public := slices.Contains(route.Portals, PublicPortal)
		if err := publicFileMarker(route, public); err != nil {
			return err
		}
		if !public {
			continue
		}
		where := route.Key()
		switch {
		case len(route.Portals) > 1:
			return fmt.Errorf("%s: a public route names no session portal beside %q", where, PublicPortal)
		case route.Method != "GET" && route.MaxBodyBytes == 0 && route.PublicFile == "":
			return fmt.Errorf("%s: a public write needs MaxBodyBytes", where)
		case route.NoRetryAfterRenewal != "":
			return fmt.Errorf("%s: a public route has no session to renew; drop NoRetryAfterRenewal", where)
		case route.Multipart:
			return fmt.Errorf("%s: the session-free proxy path takes no upload; a public upload keeps its route file", where)
		case route.File && route.PublicFile == "":
			return fmt.Errorf("%s: the session-free proxy path answers JSON only; a public file needs PublicFile, the reason its link alone may open it", where)
		}
		for _, other := range routes {
			if other.Method == route.Method && !slices.Contains(other.Portals, PublicPortal) && patternsOverlap(route.Pattern, other.Pattern) {
				return fmt.Errorf("%s overlaps the session route %s", where, other.Key())
			}
		}
	}
	return nil
}

// publicFileMarker keeps PublicFile on what it is for: one file of the
// portal public, which the proxy fetches without a body. A file that reads a
// body, or the marker on any other route, is refused.
func publicFileMarker(route Route, public bool) error {
	if route.PublicFile == "" {
		return nil
	}
	where := route.Key()
	switch {
	case !public || !route.File:
		return fmt.Errorf("%s: PublicFile marks a file of the portal %q only", where, PublicPortal)
	case route.Request != nil || route.MaxBodyBytes != 0:
		return fmt.Errorf("%s: a public file reads no request body", where)
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

// fileCacheTraits keeps a route's cache traits on what the proxy can honour
// (#2352, ADR 0270): a FileCache value of the closed list on a file it hands
// out, a public value only where PublicFile opens the file, and a
// conditional GET only on a GET file that names how long it may be kept.
func fileCacheTraits(rc Registration, where string) error {
	if rc.FileCache != "" {
		switch {
		case !rc.File || rc.Multipart:
			return fmt.Errorf("%s: FileCache belongs to a file route", where)
		case !slices.Contains(contractmodel.FileCacheValues, rc.FileCache):
			return fmt.Errorf("%s: FileCache %q is none of the reviewed values", where, rc.FileCache)
		case strings.HasPrefix(rc.FileCache, "public") && rc.PublicFile == "":
			return fmt.Errorf("%s: a public FileCache needs PublicFile", where)
		}
	}
	if rc.ConditionalGet && (rc.Method != "GET" || !rc.File || rc.FileCache == "") {
		return fmt.Errorf("%s: ConditionalGet belongs to a GET file route with FileCache", where)
	}
	return nil
}
