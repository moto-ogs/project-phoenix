package s3objects

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/moto-ogs/project-phoenix/modules/delivery/contract"
)

// Backend keeps every object private at the bucket. Public assets are served
// only by the app's existing public routes.
type Backend struct {
	client *minio.Client
	http   *http.Client
	bucket string
}

func New(ctx context.Context, endpoint, region, bucket, accessKey, secretKey string) (contract.UploadBackend, error) {
	address, err := url.Parse(endpoint)
	if err != nil || address.Hostname() == "" || address.User != nil ||
		address.RawQuery != "" || address.Fragment != "" || (address.Path != "" && address.Path != "/") {
		return nil, errors.New("storage: invalid UPLOADS_S3_ENDPOINT")
	}
	if address.Scheme != "https" && (address.Scheme != "http" || !isLoopback(address.Hostname())) {
		return nil, errors.New("storage: UPLOADS_S3_ENDPOINT requires HTTPS outside loopback")
	}
	secure := address.Scheme == "https"
	transport, err := minio.DefaultTransport(secure)
	if err != nil {
		return nil, errors.New("storage: invalid S3 client configuration")
	}
	client, err := minio.New(address.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure, Region: region, BucketLookup: minio.BucketLookupPath, Transport: transport,
	})
	if err != nil {
		return nil, errors.New("storage: invalid S3 client configuration")
	}
	backend := &Backend{client: client, http: &http.Client{Transport: transport}, bucket: bucket}
	check, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := backend.requireUnversionedBucket(check); err != nil {
		return nil, err
	}
	return backend, nil
}

func isLoopback(host string) bool {
	ip := net.ParseIP(host)
	return host == "localhost" || (ip != nil && ip.IsLoopback())
}

func (s *Backend) requireUnversionedBucket(ctx context.Context) error {
	versioning, err := s.client.GetBucketVersioning(ctx, s.bucket)
	if err != nil {
		return errors.New("storage: could not check S3 bucket versioning")
	}
	if versioning.Status != "" {
		return errors.New("storage: uploads require a bucket that has never been versioned")
	}
	return nil
}

func validateKey(key string) error {
	_, err := contract.ObjectKey(strings.Split(key, "/")...)
	return err
}

func (s *Backend) WriteObject(ctx context.Context, key string, r io.Reader, _ contract.SaveOptions) (int64, error) {
	if err := validateKey(key); err != nil {
		return 0, err
	}
	// The upload handlers already bound input sizes. Keep one atomic PUT for
	// both a new object and a replacement. A failed read cannot publish bytes.
	content, err := io.ReadAll(&cancelableReader{ctx: ctx, source: r})
	if err != nil {
		return 0, err
	}
	if err := s.put(ctx, key, content); err != nil {
		return 0, err
	}
	return int64(len(content)), nil
}

type cancelableReader struct {
	ctx    context.Context
	source io.Reader
}

func (r *cancelableReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.source.Read(p)
}

const objectContentType = "application/octet-stream"

func (s *Backend) put(ctx context.Context, key string, content []byte) error {
	opts := minio.PutObjectOptions{ContentType: objectContentType, DisableMultipart: true}
	_, err := s.client.PutObject(ctx, s.bucket, key, bytes.NewReader(content), int64(len(content)), opts)
	return objectError(ctx, "write", err)
}

// replace writes only while the object still has the given ETag. The ETag
// travels without quotes: Hetzner's Ceph gateway compares the header bytes
// with the stored ETag and answers 412 to the quoted form that minio-go's
// SetMatchETag sends. The SDK offers no other way to set the header, so the
// request is presigned with If-Match as a signed header and sent directly.
func (s *Backend) replace(ctx context.Context, key string, content []byte, etag string) error {
	condition := http.Header{"If-Match": {etag}}
	target, err := s.client.PresignHeader(ctx, http.MethodPut, s.bucket, key, time.Minute, nil, condition)
	if err != nil {
		return objectError(ctx, "write", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, target.String(), bytes.NewReader(content))
	if err != nil {
		return objectError(ctx, "write", err)
	}
	request.Header = condition
	request.Header.Set("Content-Type", objectContentType)
	response, err := s.http.Do(request)
	if err != nil {
		return objectError(ctx, "write", err)
	}
	defer func() { _ = response.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
	switch response.StatusCode {
	case http.StatusOK:
		return nil
	case http.StatusNotFound:
		return contract.ErrNotFound
	case http.StatusPreconditionFailed:
		// Some providers return 412 for a condition on a deleted key.
		if _, statErr := s.stat(ctx, key); statErr != nil {
			return statErr
		}
		return contract.ErrObjectChanged
	default:
		return objectError(ctx, "write", errors.New(response.Status))
	}
}

func (s *Backend) OpenObject(ctx context.Context, key string) (*contract.Object, error) {
	if err := validateKey(key); err != nil {
		return nil, err
	}
	content, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, objectError(ctx, "open", err)
	}
	info, err := content.Stat()
	if err != nil {
		_ = content.Close()
		return nil, objectError(ctx, "open", err)
	}
	return &contract.Object{Content: content, ModifiedAt: info.LastModified}, nil
}

func (s *Backend) stat(ctx context.Context, key string) (minio.ObjectInfo, error) {
	if err := validateKey(key); err != nil {
		return minio.ObjectInfo{}, err
	}
	info, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	return info, objectError(ctx, "stat", err)
}

func (s *Backend) ObjectSize(ctx context.Context, key string) (int64, error) {
	info, err := s.stat(ctx, key)
	return info.Size, err
}

func (s *Backend) ReplaceObject(ctx context.Context, key string, content []byte) error {
	info, err := s.stat(ctx, key)
	if err != nil {
		return err
	}
	if info.ETag == "" {
		return errors.New("storage: missing ETag for conditional replacement")
	}
	return s.replace(ctx, key, content, info.ETag)
}

func (s *Backend) RemoveObject(ctx context.Context, key string) error {
	if err := validateKey(key); err != nil {
		return err
	}
	err := objectError(ctx, "remove", s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{}))
	if errors.Is(err, contract.ErrNotFound) {
		return nil
	}
	return err
}

// RemoveStaleReplacements is empty because a conditional PUT leaves no
// staging key in the bucket.
func (*Backend) RemoveStaleReplacements(_ context.Context, prefix string) (int, error) {
	return 0, validateKey(prefix)
}

func objectError(ctx context.Context, operation string, err error) error {
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	switch minio.ToErrorResponse(err).Code {
	case "NoSuchKey", "NotFound":
		return contract.ErrNotFound
	default:
		// The SDK's error can contain the endpoint, bucket or a sensitive key.
		return errors.New("storage: S3 " + operation + " failed")
	}
}

var _ contract.UploadBackend = (*Backend)(nil)
