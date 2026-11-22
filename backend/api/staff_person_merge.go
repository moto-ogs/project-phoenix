package api

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"time"

	auditCompose "github.com/moto-ogs/project-phoenix/modules/auditlog/compose"
	auditRecords "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	peopleCompose "github.com/moto-ogs/project-phoenix/modules/peopledirectory/compose"
	membershipCompose "github.com/moto-ogs/project-phoenix/modules/schoolmembership/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/workflows/staffpersonmerge"
	mergeCompose "github.com/moto-ogs/project-phoenix/workflows/staffpersonmerge/compose"
	mergeHTTP "github.com/moto-ogs/project-phoenix/workflows/staffpersonmerge/http"
)

// staffPersonMergeAudit writes the operator audit details with encoding/json,
// which writes an ident.ID as a number: the stored JSON keeps its form (ADR
// 0300, addendum).
type staffPersonMergeAudit struct {
	create func(context.Context, *auditRecords.OperatorAuditEntry) error
}

func (a staffPersonMergeAudit) RecordStaffPersonMergePreview(ctx context.Context, operatorID, schoolID int64, clientIP net.IP) error {
	changes, err := json.Marshal(struct {
		SchoolID ident.ID `json:"school_id"`
		View     string   `json:"view"`
	}{ident.ID(schoolID), "staff_person_merge_candidates"})
	if err != nil {
		return err
	}
	return a.create(ctx, &auditRecords.OperatorAuditEntry{OperatorID: operatorID, Action: "view", ResourceType: "person", Changes: changes, RequestIP: clientIP})
}

func (a staffPersonMergeAudit) RecordStaffPersonMerge(ctx context.Context, operatorID, schoolID int64, candidate staffpersonmerge.StaffPersonMergeCandidate) error {
	changes, err := json.Marshal(struct {
		SchoolID        ident.ID `json:"school_id"`
		DonorID         ident.ID `json:"donor_person_id"`
		KeeperID        ident.ID `json:"keeper_person_id"`
		DonorStaffID    ident.ID `json:"donor_staff_id"`
		KeeperStaffID   ident.ID `json:"keeper_staff_id"`
		SchoolConfirmed bool     `json:"school_confirmed"`
	}{ident.ID(schoolID), candidate.Donor.Person.ID, candidate.Keeper.Person.ID, candidate.Donor.Employment.ID, candidate.Keeper.Employment.ID, true})
	if err != nil {
		return err
	}
	id := candidate.Keeper.Person.ID
	return a.create(ctx, &auditRecords.OperatorAuditEntry{OperatorID: operatorID, Action: "merge", ResourceType: "person", ResourceID: (*int64)(&id), Changes: changes})
}
func newStaffPersonMergeRoutes(db transactionruntime.Database, now func() time.Time) (http.Handler, error) {
	audit, err := auditCompose.NewPersistence(auditCompose.PersistenceDependencies{DB: db.Pool()})
	if err != nil {
		return nil, err
	}
	workflow, err := mergeCompose.New(peopleCompose.NewStaffPersonMerge(now), membershipCompose.NewStaffPersonMerge(), staffPersonMergeAudit{create: audit.OperatorAuditLog.Create}, operatorIDFromSession)
	if err != nil {
		return nil, err
	}
	return mergeHTTP.Router(workflow, TenantScopeMiddleware), nil
}
