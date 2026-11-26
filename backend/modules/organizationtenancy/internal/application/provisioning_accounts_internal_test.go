package application

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProvisioningInviteSchoolAdmin(t *testing.T) {
	t.Parallel()

	input := organizationtenancy.SchoolAdminInvitationInput{
		Email: "  Leitung@Burbach.TEST ", FirstName: strPtr("Lea"), LastName: strPtr("Leitung"),
		Position: strPtr("Schulleitung"), CaregiverEnabled: true,
	}

	t.Run("invites the school admin with the admin system role", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		seedDeviceSchools(h)

		invitation, err := h.svc.InviteSchoolAdmin(context.Background(), 10, testOperatorID, operatorIP, input)

		require.NoError(t, err)
		assert.Equal(t, []domain.SchoolAdminInvitationRequest{{
			TenantID: 10, RoleID: 1, Email: "leitung@burbach.test",
			FirstName: input.FirstName, LastName: input.LastName, Position: input.Position, CaregiverEnabled: true,
		}}, h.identity.invitations)
		assert.Equal(t, &organizationtenancy.SchoolAdminInvitation{
			ID: 900, Email: "leitung@burbach.test", RoleID: 1, RoleName: "admin", Token: "invite-token",
			ExpiresAt: fixedTime.Add(48 * time.Hour), FirstName: input.FirstName, LastName: input.LastName,
			Position: input.Position, CaregiverEnabled: true,
		}, invitation)
		entry := h.onlyAudit(t, domain.AuditActionCreate, domain.AuditResourceInvitation, 900)
		assert.Equal(t, map[string]any{
			"schoolID": float64(10), "email": "leitung@burbach.test", "roleID": float64(1),
		}, auditChanges(t, entry))
	})

	t.Run("a tenant role named admin is not the system role", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		seedDeviceSchools(h)
		h.identity.roles = []domain.Role{{ID: 50, Name: "admin", IsSystem: true, TenantID: int64Ptr(10)}}

		invitation, err := h.svc.InviteSchoolAdmin(context.Background(), 10, testOperatorID, operatorIP, input)

		assert.Nil(t, invitation)
		var invalid *organizationtenancy.InvalidProvisioningDataError
		require.ErrorAs(t, err, &invalid)
		assert.Contains(t, invalid.Error(), "admin role not found")
		assert.Empty(t, h.identity.invitations)
	})

	// The invitation commits only with its operator audit entry (#6844).
	t.Run("audit failure fails the invitation", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		seedDeviceSchools(h)
		h.audit.err = errBoom

		invitation, err := h.svc.InviteSchoolAdmin(context.Background(), 10, testOperatorID, operatorIP, input)

		require.ErrorIs(t, err, errBoom)
		assert.Nil(t, invitation)
	})

	for name, tc := range map[string]struct {
		seed  func(*provisioningHarness)
		check func(*testing.T, error)
	}{
		"missing school": {
			seed: func(h *provisioningHarness) { delete(h.engine.schools, 10) },
			check: func(t *testing.T, err error) {
				var notFound *organizationtenancy.SchoolNotFoundError
				require.ErrorAs(t, err, &notFound)
				assert.Equal(t, int64(10), notFound.SchoolID)
			},
		},
		"deleted school": {
			seed: func(h *provisioningHarness) { h.engine.schools[10].DeletedAt = deletedNow() },
			check: func(t *testing.T, err error) {
				var deleted *organizationtenancy.SchoolAlreadyDeletedError
				require.ErrorAs(t, err, &deleted)
			},
		},
		"inactive school": {
			seed: func(h *provisioningHarness) { h.engine.schools[10].Active = false },
			check: func(t *testing.T, err error) {
				var invalid *organizationtenancy.InvalidProvisioningDataError
				require.ErrorAs(t, err, &invalid)
				assert.Contains(t, invalid.Error(), "school is inactive")
			},
		},
		"missing admin role": {
			seed: func(h *provisioningHarness) { h.identity.roles = nil },
			check: func(t *testing.T, err error) {
				var invalid *organizationtenancy.InvalidProvisioningDataError
				require.ErrorAs(t, err, &invalid)
				assert.Contains(t, invalid.Error(), "admin role not found")
			},
		},
		"role lookup failure": {
			seed:  func(h *provisioningHarness) { h.identity.fail["FindSystemRole"] = errBoom },
			check: func(t *testing.T, err error) { require.ErrorIs(t, err, errBoom) },
		},
		"invitation failure": {
			seed:  func(h *provisioningHarness) { h.identity.fail["InviteSchoolAdmin"] = errBoom },
			check: func(t *testing.T, err error) { require.ErrorIs(t, err, errBoom) },
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			h := newHarness(t)
			seedDeviceSchools(h)
			tc.seed(h)

			invitation, err := h.svc.InviteSchoolAdmin(context.Background(), 10, testOperatorID, operatorIP, input)

			assert.Nil(t, invitation)
			tc.check(t, err)
			assert.Empty(t, h.identity.invitations)
			assert.Empty(t, h.audit.entries)
		})
	}
}

func accountInput(roleID *int64) organizationtenancy.SchoolAccountInput {
	return organizationtenancy.SchoolAccountInput{
		Email: "jane@example.test", Password: "SecureP@ss1", FirstName: " Jane ", LastName: "DOE",
		RoleID: roleID,
	}
}

func TestProvisioningCreateSchoolAccount(t *testing.T) {
	t.Parallel()

	t.Run("creates the account and its school identity", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		seedDeviceSchools(h)
		input := accountInput(int64Ptr(2))
		input.Position = "Klassenlehrerin"

		account, err := h.svc.CreateSchoolAccount(context.Background(), 10, testOperatorID, operatorIP, input)

		require.NoError(t, err)
		require.NotNil(t, account)
		assert.Equal(t, ident.ID(int64(100)), account.ID)
		assert.Equal(t, "jane@example.test", account.Email)
		assert.Equal(t, []domain.SchoolAccountRegistration{{
			TenantID: 10, Email: "jane@example.test", Username: "jane_doe_abc123", Password: "SecureP@ss1", RoleID: 2,
		}}, h.identity.registrations)
		require.Len(t, h.identity.identities, 1)
		assert.Equal(t, domain.SchoolIdentityRequest{
			AccountID: 100, TenantID: 10, Role: h.identity.roles[1],
			FirstName: " Jane ", LastName: "DOE", Position: "Klassenlehrerin",
		}, h.identity.identities[0])
		assert.Empty(t, h.identity.assigned)
		entry := h.onlyAudit(t, domain.AuditActionCreate, domain.AuditResourceAccount, 100)
		assert.Equal(t, map[string]any{"schoolID": float64(10), "email": "jane@example.test"}, auditChanges(t, entry))
	})

	t.Run("defaults to the admin system role", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		seedDeviceSchools(h)

		_, err := h.svc.CreateSchoolAccount(context.Background(), 10, testOperatorID, operatorIP, accountInput(nil))

		require.NoError(t, err)
		require.Len(t, h.identity.registrations, 1)
		assert.Equal(t, int64(1), h.identity.registrations[0].RoleID)
		assert.Equal(t, "admin", h.identity.identities[0].Role.Name)
		assert.NotContains(t, h.identity.calls, "FindRole")
	})

	t.Run("a lehrkraft without caregiver capability is allowed", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		seedDeviceSchools(h)

		_, err := h.svc.CreateSchoolAccount(context.Background(), 10, testOperatorID, operatorIP, accountInput(int64Ptr(5)))

		require.NoError(t, err)
		assert.Equal(t, int64(5), h.identity.registrations[0].RoleID)
		assert.Empty(t, h.identity.assigned)
	})

	t.Run("caregiver upgrade hands out the user role", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		seedDeviceSchools(h)
		input := accountInput(int64Ptr(6))
		input.CaregiverEnabled = true

		_, err := h.svc.CreateSchoolAccount(context.Background(), 10, testOperatorID, operatorIP, input)

		require.NoError(t, err)
		assert.True(t, h.identity.identities[0].CaregiverUpgrade)
		assert.Equal(t, [][3]int64{{10, 100, 2}}, h.identity.assigned)
	})

	t.Run("a role with caregiver permissions needs no extra role", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		seedDeviceSchools(h)
		input := accountInput(nil)
		input.CaregiverEnabled = true

		_, err := h.svc.CreateSchoolAccount(context.Background(), 10, testOperatorID, operatorIP, input)

		require.NoError(t, err)
		assert.True(t, h.identity.identities[0].CaregiverUpgrade)
		assert.Empty(t, h.identity.assigned)
	})

	// The account commits only after its operator audit entry (#6984).
	t.Run("audit failure fails the creation", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		seedDeviceSchools(h)
		h.audit.err = errBoom

		account, err := h.svc.CreateSchoolAccount(context.Background(), 10, testOperatorID, operatorIP, accountInput(nil))

		var unavailable *organizationtenancy.OperatorAuditUnavailableError
		require.ErrorAs(t, err, &unavailable)
		require.ErrorIs(t, err, errBoom)
		assert.Nil(t, account)
		assert.ErrorIs(t, h.tx.lastErr, errBoom, "the school unit must roll back")
	})

	caregiver := func(input organizationtenancy.SchoolAccountInput) organizationtenancy.SchoolAccountInput {
		input.CaregiverEnabled = true
		return input
	}
	for name, tc := range map[string]struct {
		seed    func(*provisioningHarness)
		input   organizationtenancy.SchoolAccountInput
		message string
	}{
		"unknown role": {input: accountInput(int64Ptr(99)), message: "role with ID 99 not found"},
		"non-system role": {
			seed: func(h *provisioningHarness) {
				h.identity.roles = append(h.identity.roles, domain.Role{ID: 60, Name: "custom", TenantID: int64Ptr(10)})
			},
			input:   accountInput(int64Ptr(60)),
			message: "only system roles are allowed",
		},
		"guardian role": {input: accountInput(int64Ptr(3)), message: "guardian invitation flow"},
		"legacy teacher role": {
			seed:    func(h *provisioningHarness) { h.identity.roles[3].Name = "Teacher" },
			input:   accountInput(int64Ptr(4)),
			message: "legacy teacher role is no longer assignable",
		},
		"lehrkraft with caregiver capability": {
			input:   caregiver(accountInput(int64Ptr(5))),
			message: "lehrkraft role cannot be combined with caregiver capability",
		},
		"missing admin role": {
			seed:    func(h *provisioningHarness) { h.identity.roles = h.identity.roles[1:] },
			input:   accountInput(nil),
			message: "admin role not found",
		},
		"inactive school": {
			seed:    func(h *provisioningHarness) { h.engine.schools[10].Active = false },
			input:   accountInput(nil),
			message: "school is inactive",
		},
	} {
		t.Run("rejects "+name, func(t *testing.T) {
			t.Parallel()
			h := newHarness(t)
			seedDeviceSchools(h)
			if tc.seed != nil {
				tc.seed(h)
			}

			account, err := h.svc.CreateSchoolAccount(context.Background(), 10, testOperatorID, operatorIP, tc.input)

			assert.Nil(t, account)
			var invalid *organizationtenancy.InvalidProvisioningDataError
			require.ErrorAs(t, err, &invalid)
			assert.Contains(t, invalid.Error(), tc.message)
			assert.Empty(t, h.identity.registrations, "no account for a rejected request")
			assert.Empty(t, h.audit.entries)
		})
	}

	for name, tc := range map[string]struct {
		seed  func(*provisioningHarness)
		check func(*testing.T, error)
	}{
		"missing school": {
			seed: func(h *provisioningHarness) { delete(h.engine.schools, 10) },
			check: func(t *testing.T, err error) {
				var notFound *organizationtenancy.SchoolNotFoundError
				require.ErrorAs(t, err, &notFound)
				assert.Equal(t, int64(10), notFound.SchoolID)
			},
		},
		"deleted school": {
			seed: func(h *provisioningHarness) { h.engine.schools[10].DeletedAt = deletedNow() },
			check: func(t *testing.T, err error) {
				var deleted *organizationtenancy.SchoolAlreadyDeletedError
				require.ErrorAs(t, err, &deleted)
				assert.Equal(t, int64(10), deleted.SchoolID)
			},
		},
		"role lookup failure": {
			seed: func(h *provisioningHarness) { h.identity.fail["FindRole"] = errBoom },
			check: func(t *testing.T, err error) {
				require.ErrorIs(t, err, errBoom)
				assert.Contains(t, err.Error(), "lookup role")
			},
		},
		"registration failure": {
			seed:  func(h *provisioningHarness) { h.identity.fail["RegisterSchoolAccount"] = errBoom },
			check: func(t *testing.T, err error) { require.ErrorIs(t, err, errBoom) },
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			h := newHarness(t)
			seedDeviceSchools(h)
			tc.seed(h)

			account, err := h.svc.CreateSchoolAccount(context.Background(), 10, testOperatorID, operatorIP, accountInput(int64Ptr(2)))

			assert.Nil(t, account)
			tc.check(t, err)
			assert.Empty(t, h.identity.identities)
			assert.Empty(t, h.audit.entries)
		})
	}

	for name, tc := range map[string]struct {
		seed  func(*provisioningHarness)
		input organizationtenancy.SchoolAccountInput
		check func(*testing.T, error)
	}{
		"invalid identity input": {
			seed: func(h *provisioningHarness) {
				h.identity.fail["EnsureSchoolIdentity"] = fmt.Errorf("names required: %w", domain.ErrInvalidSchoolIdentity)
			},
			input: accountInput(int64Ptr(2)),
			check: func(t *testing.T, err error) {
				var invalid *organizationtenancy.InvalidProvisioningDataError
				require.ErrorAs(t, err, &invalid)
				require.ErrorIs(t, err, domain.ErrInvalidSchoolIdentity)
			},
		},
		"identity failure": {
			seed:  func(h *provisioningHarness) { h.identity.fail["EnsureSchoolIdentity"] = errBoom },
			input: accountInput(int64Ptr(2)),
			check: func(t *testing.T, err error) {
				require.ErrorIs(t, err, errBoom)
				var invalid *organizationtenancy.InvalidProvisioningDataError
				assert.NotErrorAs(t, err, &invalid)
			},
		},
		"missing user role for the caregiver upgrade": {
			seed:  func(h *provisioningHarness) { h.identity.roles = append(h.identity.roles[:1], h.identity.roles[2:]...) },
			input: caregiver(accountInput(int64Ptr(6))),
			check: func(t *testing.T, err error) {
				require.ErrorContains(t, err, "assign caregiver role: user role not found")
			},
		},
		"user role lookup failure": {
			seed: func(h *provisioningHarness) {
				// The account role is resolved by ID, so only the user role
				// lookup fails.
				h.identity.fail["FindSystemRole"] = errBoom
			},
			input: caregiver(accountInput(int64Ptr(6))),
			check: func(t *testing.T, err error) {
				require.ErrorIs(t, err, errBoom)
				assert.Contains(t, err.Error(), "assign caregiver role")
			},
		},
		"role assignment failure": {
			seed:  func(h *provisioningHarness) { h.identity.fail["AssignRole"] = errBoom },
			input: caregiver(accountInput(int64Ptr(6))),
			check: func(t *testing.T, err error) {
				require.ErrorIs(t, err, errBoom)
				assert.Contains(t, err.Error(), "assign caregiver role")
			},
		},
	} {
		t.Run(name+" fails after registration", func(t *testing.T) {
			t.Parallel()
			h := newHarness(t)
			seedDeviceSchools(h)
			tc.seed(h)

			account, err := h.svc.CreateSchoolAccount(context.Background(), 10, testOperatorID, operatorIP, tc.input)

			assert.Nil(t, account)
			tc.check(t, err)
			assert.Len(t, h.identity.registrations, 1)
			require.Error(t, h.tx.lastErr, "the registered account must roll back")
			assert.Empty(t, h.audit.entries)
		})
	}
}

func TestProvisioningListSystemRoles(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	h.identity.roles = []domain.Role{
		{ID: 1, Name: "admin", IsSystem: true},
		{ID: 9, Name: "custom", TenantID: int64Ptr(10)},
		{ID: 2, Name: "user", IsSystem: true},
	}

	roles, err := h.svc.ListSystemRoles(context.Background())

	require.NoError(t, err)
	assert.Equal(t, []organizationtenancy.SystemRole{
		{ID: 1, Name: "admin", IsSystem: true},
		{ID: 2, Name: "user", IsSystem: true},
	}, roles)

	h.identity.fail["ListSystemRoles"] = errBoom
	roles, err = h.svc.ListSystemRoles(context.Background())
	assert.Nil(t, roles)
	require.ErrorIs(t, err, errBoom)
}

func TestProvisioningListAccountPage(t *testing.T) {
	t.Parallel()
	query := organizationtenancy.AccountPageQuery{Sort: "email", Descending: true, Search: "Ada", Cursor: "next"}
	for name, scope := range map[string]organizationtenancy.AccountScope{
		"school":       {SchoolID: 10},
		"organization": {OrganizationID: 1},
		"all":          {},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			h := newHarness(t)
			seedDeviceSchools(h)
			want := organizationtenancy.AccountPage{
				Rows: []organizationtenancy.OrganizationAccount{{SchoolAccount: organizationtenancy.SchoolAccount{
					AccountID: 1, Email: "ada@example.test", HasAdminRole: true,
				}, SchoolID: 10, SchoolName: "Burbach"}},
				Total: 51, Number: 1, NextCursor: "next",
			}
			h.identity.accountPage = want
			page, err := h.svc.ListAccountPage(context.Background(), scope, query)
			require.NoError(t, err)
			assert.Equal(t, want, page)
			assert.Equal(t, []organizationtenancy.AccountScope{scope}, h.identity.accountScopes)
			assert.Equal(t, query, h.identity.accountQuery)

			h.identity.fail["ListAccountPage"] = errBoom
			page, err = h.svc.ListAccountPage(context.Background(), scope, query)
			require.ErrorIs(t, err, errBoom)
			assert.Empty(t, page)
		})
	}
}

func TestProvisioningListAccountPageValidatesScope(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	seedDeviceSchools(h)
	ctx := context.Background()
	query := organizationtenancy.AccountPageQuery{}
	_, err := h.svc.ListAccountPage(ctx, organizationtenancy.AccountScope{SchoolID: 99}, query)
	require.ErrorAs(t, err, new(*organizationtenancy.SchoolNotFoundError))
	h.engine.schools[10].DeletedAt = deletedNow()
	_, err = h.svc.ListAccountPage(ctx, organizationtenancy.AccountScope{SchoolID: 10}, query)
	require.ErrorAs(t, err, new(*organizationtenancy.SchoolAlreadyDeletedError))
	_, err = h.svc.ListAccountPage(ctx, organizationtenancy.AccountScope{OrganizationID: 99}, query)
	require.ErrorAs(t, err, new(*organizationtenancy.OrganizationNotFoundError))
	assert.Empty(t, h.identity.accountScopes)
}
