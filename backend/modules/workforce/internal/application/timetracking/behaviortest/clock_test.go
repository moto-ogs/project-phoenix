package timetracking_test

import "time"

// testNow is the clock the suites hand the services they build directly; the
// services have no wall-clock fallback of their own (ADR 0272).
var testNow = time.Now
