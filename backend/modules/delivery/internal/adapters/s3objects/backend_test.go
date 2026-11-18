package s3objects_test

import (
	"encoding/xml"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/adapters/s3objects"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const fixtureBucket = "fixture-uploads"

func fixtureServer(t *testing.T, versioning func() string, objects http.HandlerFunc) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.True(t, strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 "))
		if r.Method == http.MethodGet && r.URL.Query().Has("versioning") {
			assert.Equal(t, "/"+fixtureBucket+"/", r.URL.Path)
			_, _ = io.WriteString(w, "<VersioningConfiguration><Status>"+versioning()+"</Status></VersioningConfiguration>")
			return
		}
		objects.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	return server.URL
}

func newFixtureBackend(t *testing.T, endpoint string) (contract.UploadBackend, error) {
	t.Helper()
	return s3objects.New(t.Context(), endpoint, "us-east-1", fixtureBucket, "fixture-access-key", "fixture-secret-key")
}

func TestReplacementDoesNotRecreateAnObjectDeletedAfterStat(t *testing.T) {
	t.Parallel()
	const key = "staff-documents/18/report.pdf"
	var attempts atomic.Int32
	endpoint := fixtureServer(t, func() string { return "" }, func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/"+fixtureBucket+"/"+key, r.URL.Path)
		switch r.Method {
		case http.MethodHead:
			if attempts.Load() > 0 {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("ETag", `"original-etag"`)
			w.Header().Set("Last-Modified", "Wed, 18 Nov 2026 00:00:00 GMT")
			w.Header().Set("Content-Length", "7")
		case http.MethodPut:
			attempts.Add(1)
			if !assert.Equal(t, `"original-etag"`, r.Header.Get("If-Match")) {
				w.WriteHeader(http.StatusOK)
				return
			}
			// This object disappeared after HEAD. The write must require the
			// original ETag so the storage server rejects the replacement.
			w.WriteHeader(http.StatusPreconditionFailed)
			_, _ = io.WriteString(w, "<Error><Code>PreconditionFailed</Code></Error>")
		default:
			t.Errorf("unexpected S3 method %s", r.Method)
			w.WriteHeader(http.StatusBadRequest)
		}
	})
	store, err := newFixtureBackend(t, endpoint)
	require.NoError(t, err)
	require.ErrorIs(t, store.ReplaceObject(t.Context(), key, []byte("replacement")), contract.ErrObjectChanged)

	_, err = store.OpenObject(t.Context(), key)
	require.ErrorIs(t, err, contract.ErrNotFound)
	require.ErrorIs(t, store.ReplaceObject(t.Context(), key, []byte("replacement")), contract.ErrNotFound)
	require.EqualValues(t, 1, attempts.Load())
}

func TestTenantErasureUsesExactPrefixesAndRechecksBucketVersioning(t *testing.T) {
	t.Parallel()
	const school = 18
	cases := []struct {
		kind, layout, key, prefix string
	}{
		{"staff-documents", "tenantDir", "staff-documents/18/report.pdf", "staff-documents/18/"},
		{"student-photos", "tenantPrefix", "student-photos/18_photo.jpg", "student-photos/18_"},
	}
	for _, tc := range cases {
		t.Run(tc.layout, func(t *testing.T) {
			t.Parallel()
			var deleted, suspended atomic.Bool
			versioning := func() string {
				if suspended.Load() {
					return "Suspended"
				}
				return ""
			}
			endpoint := fixtureServer(t, versioning, func(w http.ResponseWriter, r *http.Request) {
				assert.False(t, suspended.Load(), "a versioned bucket must block before list or delete")
				assert.Equal(t, "/"+fixtureBucket+"/", r.URL.Path)
				switch r.Method {
				case http.MethodGet:
					assert.Equal(t, tc.prefix, r.URL.Query().Get("prefix"))
					_, _ = io.WriteString(w, "<ListBucketResult><IsTruncated>false</IsTruncated>")
					if !deleted.Load() {
						_, _ = io.WriteString(w, "<Contents><Key>"+tc.key+"</Key><Size>7</Size></Contents>")
					}
					_, _ = io.WriteString(w, "</ListBucketResult>")
				case http.MethodPost:
					assert.True(t, r.URL.Query().Has("delete"))
					var request struct {
						Keys []string `xml:"Object>Key"`
					}
					assert.NoError(t, xml.NewDecoder(r.Body).Decode(&request))
					assert.Equal(t, []string{tc.key}, request.Keys)
					deleted.Store(true)
					_, _ = io.WriteString(w, "<DeleteResult><Deleted><Key>"+tc.key+"</Key></Deleted></DeleteResult>")
				default:
					t.Errorf("unexpected S3 method %s", r.Method)
					w.WriteHeader(http.StatusBadRequest)
				}
			})
			store, err := newFixtureBackend(t, endpoint)
			require.NoError(t, err)
			for _, remove := range []bool{false, true} {
				count, err := store.TenantObjects(t.Context(), tc.kind, tc.layout, school, remove)
				require.NoError(t, err)
				require.EqualValues(t, 1, count)
			}
			count, err := store.TenantObjects(t.Context(), tc.kind, tc.layout, school, false)
			require.NoError(t, err)
			require.Zero(t, count)

			suspended.Store(true)
			_, err = store.TenantObjects(t.Context(), tc.kind, tc.layout, school, true)
			require.ErrorContains(t, err, "never been versioned")
			_, err = newFixtureBackend(t, endpoint)
			require.ErrorContains(t, err, "never been versioned")
		})
	}
}
