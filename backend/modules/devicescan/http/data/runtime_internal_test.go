package data

import (
	"time"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func testRuntime() Runtime {
	return Runtime{
		ParseID: testpkg.ParseHTTPIDParam,
		Now:     func() time.Time { return time.Date(2026, 8, 31, 10, 11, 12, 0, time.UTC) },
		Device:  testutil.DeviceIdentity,
		Success: testutil.RespondSuccess,
		Failure: func(w testpkg.HTTPResponseWriter, r *testpkg.HTTPRequest, status int, err error, message string) {
			testutil.RespondCoded(w, r, status, "", err, nil, message)
		},
	}
}
