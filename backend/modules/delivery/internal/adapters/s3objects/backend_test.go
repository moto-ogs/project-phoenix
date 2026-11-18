package s3objects_test

import (
	"bytes"
	"encoding/xml"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/adapters/s3objects"
	"github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const fixtureBucket = "fixture-uploads"

func fixtureServer(t *testing.T, versioning func() string, objects http.HandlerFunc) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A conditional replacement is presigned. Its signature is in the query.
		assert.True(t, strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") ||
			r.URL.Query().Get("X-Amz-Algorithm") == "AWS4-HMAC-SHA256")
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

func TestSealedObjectsStayOpaqueAndBoundToTheirKey(t *testing.T) {
	t.Parallel()
	const kind, name = "staff-documents", "fixture.pdf"
	modified := time.Date(2026, time.November, 18, 0, 0, 0, 0, time.UTC)
	var mu sync.Mutex
	var stored []byte
	endpoint := fixtureServer(t, func() string { return "" }, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.Method {
		case http.MethodPut:
			assert.Equal(t, "/"+fixtureBucket+"/"+kind+"/18/"+name, r.URL.Path)
			assert.Empty(t, r.Header.Get("X-Amz-Acl"))
			data, err := io.ReadAll(r.Body)
			assert.NoError(t, err)
			if r.Header.Get("Content-Encoding") == "aws-chunked" {
				// The tiny fixture is sent as one signed data chunk.
				size, err := strconv.Atoi(r.Header.Get("X-Amz-Decoded-Content-Length"))
				_, chunk, framed := bytes.Cut(data, []byte("\r\n"))
				if !assert.True(t, err == nil && framed && size > 0 && size <= len(chunk)) {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				data = chunk[:size]
			}
			stored = data
			w.Header().Set("ETag", `"fixture"`)
		case http.MethodGet, http.MethodHead:
			// Serve the same bytes under every key, as if an operator had copied
			// the encrypted file to a different school during migration.
			w.Header().Set("ETag", `"fixture"`)
			http.ServeContent(w, r, name, modified, bytes.NewReader(stored))
		default:
			t.Errorf("unexpected S3 method %s", r.Method)
			w.WriteHeader(http.StatusBadRequest)
		}
	})
	writer, err := newFixtureBackend(t, endpoint)
	require.NoError(t, err)
	reader, err := newFixtureBackend(t, endpoint)
	require.NoError(t, err)
	fileKeys := objects.FileKeys{Health: testpkg.TestHealthDataCipher}
	const plaintext = "synthetic personnel file"
	size, err := objects.NewPrivateUploads(writer, fileKeys).SaveSealed(t.Context(), kind, 18, name, strings.NewReader(plaintext), objects.FileRingHealth)
	require.NoError(t, err)
	require.EqualValues(t, len(plaintext), size)
	mu.Lock()
	raw := bytes.Clone(stored)
	mu.Unlock()
	require.True(t, bytes.HasPrefix(raw, []byte("MOTOSEAL")))
	require.NotContains(t, string(raw), plaintext)

	sealed := objects.NewPrivateUploads(reader, fileKeys)
	body, err := sealed.OpenPrivate(t.Context(), kind, 18, name)
	require.NoError(t, err)
	defer func() { require.NoError(t, body.Close()) }()
	decoded, err := io.ReadAll(body)
	require.NoError(t, err)
	require.Equal(t, plaintext, string(decoded))

	_, err = sealed.OpenPrivate(t.Context(), kind, 180, name)
	require.ErrorIs(t, err, objects.ErrSealedUnavailable)
	_, err = objects.NewPrivateUploads(reader, objects.FileKeys{}).OpenPrivate(t.Context(), kind, 18, name)
	require.ErrorIs(t, err, objects.ErrSealedUnavailable)
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
			// Hetzner's gateway matches only the unquoted ETag, and the
			// condition must be part of the signature.
			if !assert.Equal(t, "original-etag", r.Header.Get("If-Match")) ||
				!assert.Contains(t, r.URL.Query().Get("X-Amz-SignedHeaders"), "if-match") {
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
	require.ErrorIs(t, store.ReplaceObject(t.Context(), key, []byte("replacement")), contract.ErrNotFound)

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
			localRoot := t.TempDir()
			local := objects.NewLocal(localRoot)
			_, err = local.WriteObject(t.Context(), tc.key, strings.NewReader("migrated original"), objects.SaveOptions{Private: true})
			require.NoError(t, err)
			sources := objects.ErasureSources(store, localRoot)
			for _, remove := range []bool{false, true} {
				count, err := sources.TenantObjects(t.Context(), tc.kind, tc.layout, school, remove)
				require.NoError(t, err)
				require.EqualValues(t, 2, count)
			}
			count, err := sources.TenantObjects(t.Context(), tc.kind, tc.layout, school, false)
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

func TestTenantErasureReturnsFailureFromNextListingPage(t *testing.T) {
	t.Parallel()
	const key = "staff-documents/18/report.pdf"
	var deleted atomic.Int32
	endpoint := fixtureServer(t, func() string { return "" }, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			if r.URL.Query().Get("continuation-token") == "next" {
				w.WriteHeader(http.StatusForbidden)
				_, _ = io.WriteString(w, "<Error><Code>AccessDenied</Code></Error>")
				return
			}
			_, _ = io.WriteString(w, "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>next</NextContinuationToken>"+
				"<Contents><Key>"+key+"</Key><Size>7</Size></Contents></ListBucketResult>")
		case http.MethodPost:
			var request struct {
				Keys []string `xml:"Object>Key"`
			}
			assert.NoError(t, xml.NewDecoder(r.Body).Decode(&request))
			assert.Equal(t, []string{key}, request.Keys)
			deleted.Add(1)
			_, _ = io.WriteString(w, "<DeleteResult><Deleted><Key>"+key+"</Key></Deleted></DeleteResult>")
		default:
			t.Errorf("unexpected S3 method %s", r.Method)
			w.WriteHeader(http.StatusBadRequest)
		}
	})
	store, err := newFixtureBackend(t, endpoint)
	require.NoError(t, err)
	count, err := store.TenantObjects(t.Context(), "staff-documents", "tenantDir", 18, true)
	require.ErrorContains(t, err, "S3 inventory failed")
	require.EqualValues(t, 1, count)
	require.EqualValues(t, 1, deleted.Load())
}
