package test

import "fmt"

// sharedTenantSignalSite is Delivery's one after-commit site for tenant-wide
// signals without content (ADR 0310, #7693). It is no entry of the losable
// notice register and grants nothing elsewhere: the key pins the path, the
// function, the occurrence and the fingerprint of the whole callback, which
// sends the bound event with empty data to the school's staff sessions. A
// second call in the function, a copy at another path or a changed body
// is a new finding and needs the register or a new decision. A new signal
// is a value of realtimeevents.TenantSignal and changes nothing here.
const sharedTenantSignalSite = "modules/delivery/internal/application/realtimeevents/tenant_signal.go:BoundTenantSignal.Announce:RegisterAfterCommit@e738fe3b71c61ff3b87b648dabbb70ef#1"

// withoutSharedTenantSignalSite drops exactly the shared site from the scan's
// findings. Without it the scan fails: the site moved or its callback changed,
// and the decision of ADR 0310 no longer covers it.
func withoutSharedTenantSignalSite(findings map[string]string) (map[string]string, error) {
	if _, ok := findings[sharedTenantSignalSite]; !ok {
		return nil, fmt.Errorf("shared tenant signal site changed or moved, reassess it against ADR 0310: %s", sharedTenantSignalSite)
	}
	rest := make(map[string]string, len(findings)-1)
	for key, fingerprint := range findings {
		if key != sharedTenantSignalSite {
			rest[key] = fingerprint
		}
	}
	return rest, nil
}
