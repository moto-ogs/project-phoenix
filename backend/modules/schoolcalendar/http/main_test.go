package staffcalendarhttp_test

import (
	"testing"

	apiTest "github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestMain gives every test in this binary its own tenant (#2419), so the
// router tests of the opening changes cannot see each other's rows.
func TestMain(m *testing.M) {
	apiTest.SeedTestJWTConfig()
	testpkg.PerTestTenants()
	testpkg.Run(m)
}
