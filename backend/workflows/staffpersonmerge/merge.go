// Package staffpersonmerge repairs reviewed staff person duplicates without
// merging employment records. It owns no data and issues no SQL.
package staffpersonmerge

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"sort"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

var (
	ErrInvalid          = errors.New("select reviewed cases and confirm school consultation")
	ErrConflict         = errors.New("staff person merge preview is no longer current")
	ErrUnauthorized     = errors.New("staff person merge requires an operator")
	ErrAuditUnavailable = errors.New("operator audit unavailable")
)

type Employment struct {
	ID        ident.ID   `json:"id"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `json:"deleted_at"`
}
type PersonSnapshot struct {
	ID        ident.ID  `json:"id"`
	TenantID  ident.ID  `json:"tenant_id"`
	AccountID *ident.ID `json:"account_id,omitempty"`
	FirstName string    `json:"first_name"`
	LastName  string    `json:"last_name"`
	Birthday  string    `json:"birthday,omitempty"`
	TagID     *string   `json:"tag_id,omitempty" contract_text:"RFID tag code"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Side struct {
	Person     PersonSnapshot `json:"person"`
	Employment Employment     `json:"employment"`
}
type StaffPersonMergeCandidate struct {
	Keeper   Side   `json:"keeper"`
	Donor    Side   `json:"donor"`
	Revision string `json:"revision"`
}
type Selection struct {
	DonorID  ident.ID `json:"donor_id"`
	KeeperID ident.ID `json:"keeper_id"`
	Revision string   `json:"revision"`
}
type Request struct {
	SchoolConfirmed bool        `json:"school_confirmed"`
	Cases           []Selection `json:"cases"`
}

type Runtime interface {
	RequireAdmin(context.Context) error
	Lock(context.Context, int64) error
	MarkRollback(context.Context)
	OperatorID(context.Context) int64
}
type Audit interface {
	RecordStaffPersonMerge(context.Context, int64, int64, StaffPersonMergeCandidate) error
	RecordStaffPersonMergePreview(context.Context, int64, int64, net.IP) error
}
type Workflow struct {
	people      peopledirectory.StaffPersonMerge
	memberships schoolmembership.StaffPersonMerge
	runtime     Runtime
	audit       Audit
}

func New(people peopledirectory.StaffPersonMerge, memberships schoolmembership.StaffPersonMerge, runtime Runtime, audit Audit) (*Workflow, error) {
	if people == nil || memberships == nil || runtime == nil || audit == nil {
		return nil, errors.New("staff person merge: all dependencies required")
	}
	return &Workflow{people: people, memberships: memberships, runtime: runtime, audit: audit}, nil
}
func (w *Workflow) Preview(ctx context.Context, schoolID int64, clientIP net.IP) ([]StaffPersonMergeCandidate, error) {
	if w.runtime.OperatorID(ctx) <= 0 {
		return nil, ErrUnauthorized
	}
	if schoolID <= 0 {
		return nil, ErrInvalid
	}
	if err := w.runtime.RequireAdmin(ctx); err != nil {
		return nil, err
	}
	if err := w.audit.RecordStaffPersonMergePreview(ctx, w.runtime.OperatorID(ctx), schoolID, clientIP); err != nil {
		w.runtime.MarkRollback(ctx)
		return nil, ErrAuditUnavailable
	}
	return w.candidates(ctx, schoolID, false)
}

// Execute locks the school repair gate, all employments by ID, then all live
// people by ID. Every selected fingerprint is checked before any write.
// The caller must supply one administrative unit for the entire batch,
// including its audit entries, and roll it back on error. HTTP callers use
// the standing TenantTxMiddleware after the operator session gates.
func (w *Workflow) Execute(ctx context.Context, schoolID int64, request Request) error {
	actor := w.runtime.OperatorID(ctx)
	if actor <= 0 {
		return ErrUnauthorized
	}
	if schoolID <= 0 || !request.SchoolConfirmed || len(request.Cases) == 0 {
		return ErrInvalid
	}
	if err := w.runtime.RequireAdmin(ctx); err != nil {
		return err
	}
	if err := w.runtime.Lock(ctx, schoolID); err != nil {
		return err
	}
	candidates, err := w.candidates(ctx, schoolID, true)
	if err != nil {
		return err
	}
	selected, err := selectCandidates(candidates, request.Cases)
	if err != nil {
		return err
	}
	if err := w.executeSelected(ctx, actor, schoolID, selected); err != nil {
		w.runtime.MarkRollback(ctx)
		return err
	}
	return nil
}

func (w *Workflow) executeSelected(ctx context.Context, actor, schoolID int64, selected []StaffPersonMergeCandidate) error {
	for _, candidate := range selected {
		if err := w.memberships.ReassignStaffPerson(ctx, schoolmembership.StaffPersonReassignment{SchoolID: schoolID, StaffID: candidate.Donor.Employment.ID.Int64(), DonorPersonID: candidate.Donor.Person.ID.Int64(), KeeperPersonID: candidate.Keeper.Person.ID.Int64()}); err != nil {
			if errors.Is(err, peopledirectory.ErrStaffPersonMergeNoLongerEligible) || errors.Is(err, schoolmembership.ErrStaffPersonMergeNoLongerEligible) {
				return ErrConflict
			}
			return err
		}
		if err := w.people.RetireMergedStaffPerson(ctx, schoolID, candidate.Donor.Person.ID.Int64(), candidate.Keeper.Person.ID.Int64()); err != nil {
			if errors.Is(err, peopledirectory.ErrStaffPersonMergeNoLongerEligible) {
				return ErrConflict
			}
			return err
		}
		if err := w.audit.RecordStaffPersonMerge(ctx, actor, schoolID, candidate); err != nil {
			return err
		}
	}
	return nil
}

func selectCandidates(candidates []StaffPersonMergeCandidate, selections []Selection) ([]StaffPersonMergeCandidate, error) {
	byDonor := make(map[int64]StaffPersonMergeCandidate, len(candidates))
	for _, candidate := range candidates {
		byDonor[candidate.Donor.Person.ID.Int64()] = candidate
	}
	result := make([]StaffPersonMergeCandidate, 0, len(selections))
	seen := make(map[int64]bool)
	for _, selection := range selections {
		candidate, ok := byDonor[selection.DonorID.Int64()]
		if !ok || seen[selection.DonorID.Int64()] || candidate.Keeper.Person.ID != selection.KeeperID || candidate.Revision != selection.Revision {
			return nil, ErrConflict
		}
		seen[selection.DonorID.Int64()] = true
		result = append(result, candidate)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Donor.Person.ID < result[j].Donor.Person.ID })
	return result, nil
}

// candidates locks, when asked, the school's staff rows before their people
// (Konto → Schule → Profil, #6702): offboarding, retention and staff admin
// hold a staff row while they lock its person, so the merge never holds a
// person while it waits for a staff row.
func (w *Workflow) candidates(ctx context.Context, schoolID int64, lock bool) ([]StaffPersonMergeCandidate, error) {
	memberships, err := w.memberships.StaffMergeMemberships(ctx, schoolID, lock)
	if err != nil {
		return nil, err
	}
	people, err := w.people.StaffMergePeople(ctx, schoolID, lock)
	if err != nil {
		return nil, err
	}
	byPerson := make(map[int64][]schoolmembership.Staff)
	for _, staff := range memberships {
		byPerson[staff.PersonID] = append(byPerson[staff.PersonID], staff)
	}
	groups := make(map[string][]peopledirectory.StaffMergePerson)
	for _, person := range people {
		groups[person.NameKey] = append(groups[person.NameKey], person)
	}
	result := []StaffPersonMergeCandidate{}
	for _, group := range groups {
		candidate, ok, err := candidateFor(group, byPerson)
		if err != nil {
			return nil, err
		}
		if ok {
			result = append(result, candidate)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Keeper.Person.ID < result[j].Keeper.Person.ID })
	return result, nil
}
func candidateFor(group []peopledirectory.StaffMergePerson, staff map[int64][]schoolmembership.Staff) (StaffPersonMergeCandidate, bool, error) {
	if len(group) != 2 {
		return StaffPersonMergeCandidate{}, false, nil
	}
	keeper, donor := group[0], group[1]
	if keeper.AccountID == nil {
		keeper, donor = donor, keeper
	}
	if keeper.AccountID == nil || donor.AccountID != nil || keeper.HasStudent || donor.HasStudent || donor.TagID != nil || (keeper.Birthday != "" && donor.Birthday != "" && keeper.Birthday != donor.Birthday) {
		return StaffPersonMergeCandidate{}, false, nil
	}
	ks, ds := staff[keeper.ID], staff[donor.ID]
	if len(ks) != 1 || len(ds) != 1 || (ks[0].DeletedAt == nil) == (ds[0].DeletedAt == nil) || ks[0].PersonalDataErasedAt != nil || ds[0].PersonalDataErasedAt != nil {
		return StaffPersonMergeCandidate{}, false, nil
	}
	side := func(p peopledirectory.Person, s schoolmembership.Staff) Side {
		return Side{Person: PersonSnapshot{ID: ident.ID(p.ID), TenantID: ident.ID(p.TenantID), AccountID: (*ident.ID)(p.AccountID), FirstName: p.FirstName, LastName: p.LastName, Birthday: p.Birthday, TagID: p.TagID, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt}, Employment: Employment{ID: ident.ID(s.ID), CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt, DeletedAt: s.DeletedAt}}
	}
	candidate := StaffPersonMergeCandidate{Keeper: side(keeper.Person, ks[0]), Donor: side(donor.Person, ds[0])}
	// All fields have deterministic JSON encodings; no maps or credentials.
	// The revision is the hash of the answer's form, identifiers as strings.
	encoded, err := wire.Marshal(candidate)
	if err != nil {
		return StaffPersonMergeCandidate{}, false, err
	}
	sum := sha256.Sum256(encoded)
	candidate.Revision = hex.EncodeToString(sum[:])
	return candidate, true, nil
}
