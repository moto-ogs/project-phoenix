package architecture

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/moto-ogs/project-phoenix/architecture/querybudget"
)

// routeGoldenRetirementsPath is the register of router golden files that
// left with their last route (ADR 0160, addendum of 2026-11-20).
const routeGoldenRetirementsPath = "architecture/route-golden-retirements.json"

// routeGoldenRetirement lets one base golden file disappear. It names the
// file and all of its routes; the checker, not the review, proves that these
// are exactly the file's routes at the base and that none of them is still
// served anywhere in the candidate golden.
type routeGoldenRetirement struct {
	File   string   `json:"file"`
	Routes []string `json:"routes"`
	Issue  int      `json:"issue"`
}

// key identifies a record independent of the order of its routes, so an
// unchanged historical record is recognized as history.
func (r routeGoldenRetirement) key() string {
	routes := canonicalRouteSet(r.Routes)
	return fmt.Sprintf("%s\x00%s\x00%d", r.File, describeRoutes(routes), r.Issue)
}

// retiredRouteGoldens checks the records this change adds and then every base
// golden file: a file the candidate lacks is an error unless a valid added
// record retires it. A record that fails its check is a violation and retires
// nothing.
func retiredRouteGoldens(added []routeGoldenRetirement, base, candidate routeGolden) ([]string, error) {
	retired := map[string]bool{}
	reasons := map[string]string{}
	var violations []string
	for _, record := range added {
		if reason := routeGoldenRetirementViolation(record, base, candidate); reason != "" {
			violations = append(violations, fmt.Sprintf("route golden retirement of %s %s", record.File, reason))
			reasons[record.File] = reason
			continue
		}
		retired[record.File] = true
	}
	names := make([]string, 0, len(base.files))
	for name := range base.files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if candidate.files[name] != nil || retired[name] {
			continue
		}
		if reason := reasons[name]; reason != "" {
			return nil, fmt.Errorf("route golden %s is missing; its retirement %s", name, reason)
		}
		return nil, fmt.Errorf("route golden %s is missing; only a record added to %s with all its base routes retires it", name, routeGoldenRetirementsPath)
	}
	return violations, nil
}

// routeGoldenRetirementViolation explains why a new record may not retire its
// file, or returns "" when the file and all of its routes left the golden.
func routeGoldenRetirementViolation(record routeGoldenRetirement, base, candidate routeGolden) string {
	own, existed := base.files[record.File]
	named := canonicalRouteSet(record.Routes)
	switch {
	case !existed:
		return "names a file the base golden does not have"
	case candidate.files[record.File] != nil:
		return "names a file the candidate golden still has"
	case !sameRoutes(named, own):
		return fmt.Sprintf("names %s; the base file lists %s", describeRoutes(named), describeRoutes(own))
	case anyRoute(named, candidate.routes):
		return "names a route the candidate golden still lists"
	}
	return ""
}

func canonicalRouteSet(routes []string) map[string]bool {
	set := make(map[string]bool, len(routes))
	for _, route := range routes {
		set[querybudget.CanonicalRoute(route)] = true
	}
	return set
}

func sameRoutes(a, b map[string]bool) bool {
	if len(a) != len(b) {
		return false
	}
	for route := range a {
		if !b[route] {
			return false
		}
	}
	return true
}

// addedRouteGoldenRetirements returns the records the base does not hold.
// Like a query budget retirement, an unchanged record is history and never a
// standing permission (ADR 0160 point 8).
func addedRouteGoldenRetirements(root, project, sha string) ([]routeGoldenRetirement, error) {
	source, err := os.ReadFile(filepath.Join(project, routeGoldenRetirementsPath))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	candidate, err := parseRouteGoldenRetirements(source)
	if err != nil {
		return nil, fmt.Errorf("read candidate route golden retirements: %w", err)
	}
	historical := map[string]bool{}
	baseSource, exists, err := baseProjectFile(root, project, sha, routeGoldenRetirementsPath)
	if err != nil {
		return nil, err
	}
	if exists {
		records, err := parseRouteGoldenRetirements(baseSource)
		if err != nil {
			return nil, fmt.Errorf("read route golden retirements at base %s: %w", sha, err)
		}
		for _, record := range records {
			historical[record.key()] = true
		}
	}
	var added []routeGoldenRetirement
	for _, record := range candidate {
		if !historical[record.key()] {
			added = append(added, record)
		}
	}
	return added, nil
}

func parseRouteGoldenRetirements(source []byte) ([]routeGoldenRetirement, error) {
	decoder := json.NewDecoder(bytes.NewReader(source))
	decoder.DisallowUnknownFields()
	var records []routeGoldenRetirement
	if err := decoder.Decode(&records); err != nil {
		return nil, err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("trailing data after route golden retirement register")
	}
	seen := map[string]bool{}
	for _, record := range records {
		if err := validRouteGoldenRetirement(record); err != nil {
			return nil, err
		}
		if seen[record.File] {
			return nil, fmt.Errorf("duplicate route golden retirement of %q", record.File)
		}
		seen[record.File] = true
	}
	return records, nil
}

func validRouteGoldenRetirement(record routeGoldenRetirement) error {
	if record.Issue <= 0 || !validRouteGoldenFile(record.File) || len(record.Routes) == 0 {
		return fmt.Errorf("route golden retirement %+v needs a relative .golden file inside %s, its routes and a positive issue", record, routeGoldenDirectory)
	}
	for _, route := range record.Routes {
		if !routeGoldenLine.MatchString(route) {
			return fmt.Errorf("route golden retirement of %q names %q, not a route \"METHOD /path\"", record.File, route)
		}
	}
	if len(canonicalRouteSet(record.Routes)) != len(record.Routes) {
		return fmt.Errorf("route golden retirement of %q names a route twice", record.File)
	}
	return nil
}

// validRouteGoldenFile accepts a clean slash path below the golden directory
// such as "auth/tokens.golden".
func validRouteGoldenFile(name string) bool {
	return strings.HasSuffix(name, ".golden") && path.Base(name) != ".golden" &&
		path.Clean(name) == name && filepath.IsLocal(name) && !strings.Contains(name, `\`)
}
