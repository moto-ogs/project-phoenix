package identityaccess

import (
	"context"
	"errors"
	"time"
)

// Roles a Träger gives the staff of all its schools (#4810, ADR 0317). The
// Träger-Büro keeps a role once, in the Träger transaction. Identity & Access
// then writes it into every school of the Träger as an ordinary school role
// that names it, each in that school's own tenant transaction (ADR 0084
// section 2). The school assigns the copy but does not change or delete it.
// Schools keep their own roles beside it.

var (
	// ErrTraegerRoleImmutable refuses a school's change of a role its Träger
	// gives: master data, permissions and deletion belong to the Träger-Büro.
	ErrTraegerRoleImmutable = errors.New("roles of the Träger cannot be modified by the school")
	// ErrTraegerSchoolRoleNotFound reports a role this Träger does not have.
	ErrTraegerSchoolRoleNotFound = errors.New("traeger school role not found")
	// ErrTraegerSchoolRoleNameTaken refuses a name another role of the Träger
	// or a platform role already carries.
	ErrTraegerSchoolRoleNameTaken = errors.New("traeger school role name already exists")
	// ErrTraegerSchoolRolesUnavailable reports an owner composed without the
	// role administration the Träger roles write through.
	ErrTraegerSchoolRolesUnavailable = errors.New("traeger school roles are not composed")
)

// TraegerSchoolRoleInvalidError refuses an input; Field names the wire field.
type TraegerSchoolRoleInvalidError struct {
	Field  string
	Reason string
}

func (e *TraegerSchoolRoleInvalidError) Error() string { return e.Reason }

// TraegerSchoolRoleNameUsedError refuses a name that a school of the Träger
// already uses for a role of its own: the copy could not be written there.
type TraegerSchoolRoleNameUsedError struct {
	Schools []string
}

func (e *TraegerSchoolRoleNameUsedError) Error() string {
	return "a school of the Träger already has a role of its own with this name"
}

// TraegerSchoolRoleActor is the person of the Träger-Büro who acts, from the
// Träger session.
type TraegerSchoolRoleActor struct {
	OrganizationID int64
	AccountID      int64
	IPAddress      string
	UserAgent      string
}

// TraegerSchoolRoleSchool is a school of the Träger.
type TraegerSchoolRoleSchool struct {
	ID   int64
	Name string
}

// TraegerSchoolRoleCarry is how one school carries a Träger role. Carried is
// false when the school has no copy or a copy that differs from the role:
// the last write failed there, or the school uses the name for a role of its
// own (NameTaken). Holders counts also for a copy that differs.
type TraegerSchoolRoleCarry struct {
	SchoolID   int64
	SchoolName string
	Carried    bool
	NameTaken  bool
	// Holders counts the accounts the school gave the role.
	Holders int
}

// TraegerSchoolRole is a role of the Träger with the schools that carry it.
type TraegerSchoolRole struct {
	ID            int64
	Name          string
	Description   string
	BaseRole      string
	PermissionIDs []int64
	Schools       []TraegerSchoolRoleCarry
	UpdatedAt     time.Time
	// Version is the read-state token of name, description, tier and
	// permission selection (ADR 0311).
	Version string
}

// TraegerSchoolRoleInput is what the Träger-Büro sets on a role.
type TraegerSchoolRoleInput struct {
	Name          string
	Description   string
	BaseRole      string
	PermissionIDs []int64
	// ExpectedVersion is the Version the change was made from; empty on
	// creation.
	ExpectedVersion string
}

// TraegerSchoolRoleTemplate is a starting selection: the permissions the
// platform role of that tier holds, without the reserved ones.
type TraegerSchoolRoleTemplate struct {
	BaseRole      string
	PermissionIDs []int64
}

// TraegerSchoolRoleCatalog is what the form of a role chooses from: the
// permissions a school role may hold and the two starting selections.
type TraegerSchoolRoleCatalog struct {
	Permissions []Permission
	Templates   []TraegerSchoolRoleTemplate
}

// TraegerSchoolRoleHolder is a person who holds the role at a school.
type TraegerSchoolRoleHolder struct {
	AccountID int64
	Name      string
	Email     string
}

// TraegerSchoolRoleRemovalSchool lists who loses the role at one school.
type TraegerSchoolRoleRemovalSchool struct {
	SchoolID   int64
	SchoolName string
	Holders    []TraegerSchoolRoleHolder
	// KeptForInvitations is set when an invitation of the school names the
	// role: the removal then leaves it there as a role of the school's own,
	// with its holders, so the invitation keeps working.
	KeptForInvitations bool
}

// TraegerSchoolRoleRemoval is the preview of a removal: every school with
// the people who hold the role there. Version is the token the removal
// sends back, so nothing is removed that the preview did not show.
type TraegerSchoolRoleRemoval struct {
	RoleID  int64
	Name    string
	Schools []TraegerSchoolRoleRemovalSchool
	Version string
}

// TraegerSchoolRoleList is the page of the Träger-Büro.
type TraegerSchoolRoleList struct {
	Roles   []TraegerSchoolRole
	Schools []TraegerSchoolRoleSchool
}

// TraegerSchoolRoles keeps the roles a Träger gives its schools. Every
// method acts for the Träger of the actor and reaches no other Träger.
type TraegerSchoolRoles interface {
	ListTraegerSchoolRoles(ctx context.Context, actor TraegerSchoolRoleActor) (TraegerSchoolRoleList, error)
	TraegerSchoolRoleCatalog(ctx context.Context, actor TraegerSchoolRoleActor) (TraegerSchoolRoleCatalog, error)
	// CreateTraegerSchoolRole stores the role and writes it into every
	// school of the Träger.
	CreateTraegerSchoolRole(ctx context.Context, actor TraegerSchoolRoleActor, input TraegerSchoolRoleInput) (TraegerSchoolRole, error)
	// UpdateTraegerSchoolRole rewrites the role and its copies. A person
	// who holds the role gets added rights at the next session renewal;
	// a removed right ends the person's sessions at once.
	UpdateTraegerSchoolRole(ctx context.Context, actor TraegerSchoolRoleActor, id int64, input TraegerSchoolRoleInput) (TraegerSchoolRole, error)
	// PreviewTraegerSchoolRoleRemoval reads who holds the role at which
	// school. It changes nothing.
	PreviewTraegerSchoolRoleRemoval(ctx context.Context, actor TraegerSchoolRoleActor, id int64) (TraegerSchoolRoleRemoval, error)
	// RemoveTraegerSchoolRole removes the role from every school and from
	// the Träger. expectedVersion is the Version of the preview the
	// Träger-Büro confirmed; without it, or when the holders changed since,
	// nothing is removed.
	RemoveTraegerSchoolRole(ctx context.Context, actor TraegerSchoolRoleActor, id int64, expectedVersion string) error
}

// TraegerSchoolRolePorts are what the Träger roles need from outside
// Identity & Access; the root binds them.
type TraegerSchoolRolePorts struct {
	Schools TraegerSchoolRoleSchools
	Runtime TraegerSchoolRoleRuntime
	People  TraegerSchoolRolePeople
}

// TraegerSchoolRoleSchools lists the undeleted schools of a Träger by name.
type TraegerSchoolRoleSchools interface {
	TraegerSchools(ctx context.Context, organizationID int64) ([]TraegerSchoolRoleSchool, error)
}

// TraegerSchoolRoleRuntime opens a school's tenant transaction or the
// Träger transaction, never both at once (ADR 0105).
type TraegerSchoolRoleRuntime interface {
	WithinSchool(ctx context.Context, schoolID int64, fn func(context.Context) error) error
	WithinTraeger(ctx context.Context, organizationID int64, fn func(context.Context) error) error
	// WithinExclusive runs fn alone for key, without a transaction of its
	// own: the writes of one Träger's roles reach the schools one after
	// the other, never interleaved.
	WithinExclusive(ctx context.Context, key string, fn func(context.Context) error) error
}

// TraegerSchoolRolePeople names the persons behind accounts of the school of
// the tenant transaction. Accounts without a person are absent.
type TraegerSchoolRolePeople interface {
	AccountNames(ctx context.Context, accountIDs []int64) (map[int64]string, error)
}

// TraegerSchoolRoleProvider builds the capability over the root's bindings.
type TraegerSchoolRoleProvider interface {
	TraegerSchoolRoles(ports TraegerSchoolRolePorts) (TraegerSchoolRoles, error)
}
