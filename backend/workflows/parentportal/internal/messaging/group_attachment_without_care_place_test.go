package messaging

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type childWithoutPlaceResolver struct{ ChildResolver }

func (childWithoutPlaceResolver) ResolvePermittedChild(context.Context, int64, int64, string) (*Child, error) {
	return &Child{TenantID: 7, WithoutCarePlace: true}, nil
}

// tenantRuntimeStub runs every unit inline; only WithinTenant is reached.
type tenantRuntimeStub struct{}

func (tenantRuntimeStub) WithinTenant(ctx context.Context, _ int64, fn func(context.Context) error) error {
	return fn(ctx)
}
func (tenantRuntimeStub) WithinAdmin(ctx context.Context, fn func(context.Context) error) error {
	return fn(ctx)
}
func (tenantRuntimeStub) WithinAdminThenTenant(ctx context.Context, _ func(context.Context) (int64, error), fn func(context.Context) error) error {
	return fn(ctx)
}
func (tenantRuntimeStub) AmbientScope(context.Context) (bool, int64)                { return false, 0 }
func (tenantRuntimeStub) RegisterAfterCommit(context.Context, func())               {}
func (tenantRuntimeStub) WithTenantID(ctx context.Context, _ int64) context.Context { return ctx }

type storedAttachmentStub struct{ MessageAttachments }

func (storedAttachmentStub) OpenGuardianAttachment(_ context.Context, _, _, attachmentID int64) (*StoredMessageAttachment, error) {
	return &StoredMessageAttachment{StoredName: "brief.pdf"}, nil
}

// TestGroupMessageFilesOpenForChildrenWithoutCarePlace lets the family of a
// child without an OGS place (#4803) open the files of the group messages
// that reach its class; only the child's own OGS chat is closed to it.
func TestGroupMessageFilesOpenForChildrenWithoutCarePlace(t *testing.T) {
	t.Parallel()
	s := &Service{Config{Runtime: tenantRuntimeStub{}, Children: childWithoutPlaceResolver{}, MessageAttachments: storedAttachmentStub{}}}

	stored, err := s.OpenChildMessageAttachment(context.Background(), 1, 2, 3)

	require.NoError(t, err)
	assert.Equal(t, "brief.pdf", stored.StoredName)
}
