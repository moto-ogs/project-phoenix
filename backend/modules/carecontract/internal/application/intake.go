package application

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

const maxCreateBatch = 200

const (
	accessViewCandidates = "care_contract_candidates"
	accessViewCreate     = "care_contract_create"
)

// Intake serves carecontract.Intake. It opens each unit itself: first the
// tenant transaction of every school it reads, then the Träger transaction
// it writes in (ADR 0153 point 3); no transaction holds both.
type Intake struct {
	store        Store
	schools      carecontract.TraegerSchools
	applications carecontract.SchoolApplications
	bookings     carecontract.SchoolBookings
	access       carecontract.SchoolAccessLog
	runtime      carecontract.Runtime
	modes        carecontract.ConclusionModes
	mail         carecontract.MailBlocks
	letterheads  carecontract.Letterheads
	issuers      carecontract.SchoolIssuers
	families     carecontract.FamilyNumbers
	requests     carecontract.SchoolParentRequests
	today        func() calendar.Date
}

// IntakePorts are the root-bound ports of the intake.
type IntakePorts struct {
	Schools      carecontract.TraegerSchools
	Applications carecontract.SchoolApplications
	Bookings     carecontract.SchoolBookings
	Access       carecontract.SchoolAccessLog
	Runtime      carecontract.Runtime
	Modes        carecontract.ConclusionModes
	Mail         carecontract.MailBlocks
	// Letterheads gives the Träger's address and contact the withdrawal
	// notice of the enrollment form names (#6105).
	Letterheads carecontract.Letterheads
	// Issuers names the Schulträger or the Gemeinde that concludes the
	// contracts of a school (#4811): the withdrawal notice of its
	// enrollment form names that body. The roots bind it; a composition
	// without it knows only the Träger.
	Issuers carecontract.SchoolIssuers
	// Families takes the registration's number of children over with the
	// contract (#6335).
	Families carecontract.FamilyNumbers
	// Requests reads the parents' own approved requests, which count as the
	// signature of the version they made (#4816). The roots bind it; a
	// composition without it knows no such request, so every changed version
	// waits for a signature.
	Requests carecontract.SchoolParentRequests
}

var _ carecontract.Intake = (*Intake)(nil)

func NewIntake(store Store, ports IntakePorts, today func() calendar.Date) *Intake {
	if store == nil || ports.Schools == nil || ports.Applications == nil || ports.Bookings == nil || ports.Access == nil ||
		ports.Runtime == nil || ports.Modes == nil || ports.Mail == nil || ports.Letterheads == nil || ports.Families == nil || today == nil {
		panic("care contract: the store, the schools, the applications, the bookings, the access log, the runtime, the conclusion modes, the mail blocks, the letterheads, the family numbers and the clock are required")
	}
	return &Intake{store: store, schools: ports.Schools, applications: ports.Applications, bookings: ports.Bookings,
		access: ports.Access, runtime: ports.Runtime, modes: ports.Modes, mail: ports.Mail, letterheads: ports.Letterheads,
		issuers: ports.Issuers, families: ports.Families, requests: ports.Requests, today: today}
}

// schoolRead is what the intake read in one school's tenant transaction.
type schoolRead struct {
	automatic    bool
	school       carecontract.School
	applications []carecontract.Application
	offerings    map[int64]carecontract.Offering
}

// Candidates lists the accepted application children with a booked offering
// that have no contract for it yet.
func (in *Intake) Candidates(ctx context.Context, reviewer carecontract.Reviewer, schoolID int64) ([]carecontract.Candidate, error) {
	if err := checkReviewer(reviewer); err != nil {
		return nil, err
	}
	schools, err := in.schoolsOf(ctx, reviewer.OrganizationID, schoolID)
	if err != nil {
		return nil, err
	}
	reads, err := in.readSchools(ctx, reviewer, schools, nil, accessViewCandidates)
	if err != nil {
		return nil, err
	}
	var candidates []carecontract.Candidate
	err = in.runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		existing, named, err := in.contractedKeys(txCtx, reviewer.OrganizationID, reads)
		if err != nil {
			return err
		}
		rows, err := in.store.Templates(txCtx, reviewer.OrganizationID)
		if err != nil {
			return err
		}
		templates, changed := indexTemplates(rows)
		candidates = collectCandidates(reads, withoutNamed(existing, named), templates, changed, in.today())
		markNamedByImport(candidates, named)
		return in.markHeldMail(txCtx, reviewer.OrganizationID, candidates)
	})
	if err != nil {
		return nil, fmt.Errorf("care contract: read contracts: %w", err)
	}
	sortCandidates(candidates)
	return candidates, nil
}

// markHeldMail names, for every child the conclusion at the acceptance
// could conclude (conditions in place, the parents' agreement proven), why
// the mail to the parents' address would stay back now (#4680). The
// conclusion holds such a child back on every run, so the dialog must not
// promise the contract. One read covers all addresses; the list does not know
// a school's way (see ConclusionModes), so the dialog shows it where the
// contract comes at the acceptance.
func (in *Intake) markHeldMail(ctx context.Context, organizationID int64, candidates []carecontract.Candidate) error {
	var addresses []string
	for _, candidate := range candidates {
		if concludable(candidate) {
			addresses = append(addresses, candidate.GuardianEmail)
		}
	}
	if len(addresses) == 0 {
		return nil
	}
	blocks, err := in.mail.ContractMailBlocks(ctx, organizationID, addresses)
	if err != nil {
		return fmt.Errorf("care contract: read mail blocks: %w", err)
	}
	for i := range candidates {
		if concludable(candidates[i]) {
			candidates[i].MailBlock = blocks[candidates[i].GuardianEmail]
		}
	}
	return nil
}

// concludable is a candidate the conclusion at the acceptance would send.
func concludable(candidate carecontract.Candidate) bool {
	return candidate.TemplateIssue == "" && candidate.AcceptanceIssue == "" && candidate.GuardianEmail != ""
}

// collectCandidates keeps every accepted application child with booked care
// and no contract.
func collectCandidates(reads []schoolRead, existing map[ContractKey]bool, templates templateIndex, changed templateChanges,
	today calendar.Date) []carecontract.Candidate {
	candidates := []carecontract.Candidate{}
	for _, read := range reads {
		for _, application := range read.applications {
			key := ContractKey{SchoolID: read.school.ID, RequestChildID: application.RequestChildID}
			booked := bookedCare(read, application, today)
			if existing[key] || len(booked.services) == 0 {
				continue
			}
			terms, issue := templates.terms(read.school.ID, booked.offerings)
			candidates = append(candidates, carecontract.Candidate{
				CandidateKey:   carecontract.CandidateKey{SchoolID: ident.ID(read.school.ID), RequestChildID: ident.ID(application.RequestChildID)},
				SchoolName:     read.school.Name,
				ChildFirstName: application.ChildFirstName, ChildLastName: application.ChildLastName,
				GuardianName:  fullName(application.GuardianFirstName, application.GuardianLastName),
				GuardianEmail: application.GuardianEmail,
				PhaseName:     firstText(booked.phaseName, application.PhaseName),
				Services:      boundServices(booked.services, lastDay(booked.until)),
				EffectiveFrom: booked.effectiveFrom(application, today),
				TemplateIssue: issue,
				Renewal:       application.Renewal,
				ModulesText:   carecontract.JoinNames(ModuleNames(booked.services)),
				AcceptanceIssue: acceptanceIssue(NewContract{AcceptedAt: application.AcceptedAt, Acceptances: application.Acceptances,
					Version: carecontract.Version{Terms: terms}},
					changed.since(read.school.ID, booked.offerings)),
			})
		}
	}
	return candidates
}

func sortCandidates(candidates []carecontract.Candidate) {
	slices.SortStableFunc(candidates, func(a, b carecontract.Candidate) int {
		return firstNonZero(strings.Compare(a.SchoolName, b.SchoolName), strings.Compare(a.ChildLastName, b.ChildLastName),
			strings.Compare(a.ChildFirstName, b.ChildFirstName), compareIDs(a.RequestChildID.Int64(), b.RequestChildID.Int64()))
	})
}

// CreateContracts creates a draft for every key with a template and no
// contract yet. Every key must name an accepted application child that books
// the offering at a school of the Träger.
func (in *Intake) CreateContracts(ctx context.Context, reviewer carecontract.Reviewer, keys []carecontract.CandidateKey) (carecontract.CreateResult, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.CreateResult{}, err
	}
	keys = uniqueKeys(keys)
	if len(keys) == 0 || len(keys) > maxCreateBatch {
		return carecontract.CreateResult{}, carecontract.InvalidSelection("contracts", "count")
	}
	all, err := in.schools.TraegerSchools(ctx, reviewer.OrganizationID)
	if err != nil {
		return carecontract.CreateResult{}, fmt.Errorf("care contract: schools: %w", err)
	}
	children := map[int64][]int64{}
	for _, key := range keys {
		if !slices.ContainsFunc(all, func(s carecontract.School) bool { return ident.ID(s.ID) == key.SchoolID }) {
			return carecontract.CreateResult{}, carecontract.ErrSchoolOutsideTraeger
		}
		children[key.SchoolID.Int64()] = append(children[key.SchoolID.Int64()], key.RequestChildID.Int64())
	}
	schools := slices.DeleteFunc(slices.Clone(all), func(s carecontract.School) bool { return children[s.ID] == nil })
	reads, err := in.readSchools(ctx, reviewer, schools, children, accessViewCreate)
	if err != nil {
		return carecontract.CreateResult{}, err
	}
	result := carecontract.CreateResult{Created: []carecontract.ContractSummary{}, Skipped: []carecontract.CreateSkip{}}
	err = in.runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		var err error
		result, err = in.create(txCtx, reviewer, keys, reads)
		return err
	})
	if err != nil {
		return carecontract.CreateResult{}, err
	}
	return result, nil
}

func (in *Intake) create(ctx context.Context, reviewer carecontract.Reviewer, keys []carecontract.CandidateKey, reads []schoolRead) (carecontract.CreateResult, error) {
	result := carecontract.CreateResult{Created: []carecontract.ContractSummary{}, Skipped: []carecontract.CreateSkip{}}
	templates, existing, err := in.lockedBasis(ctx, reviewer.OrganizationID, reads)
	if err != nil {
		return result, err
	}
	today := in.today()
	for _, key := range keys {
		draft, reason := in.draft(key, reads, templates, existing, today)
		if reason != "" {
			result.Skipped = append(result.Skipped, carecontract.CreateSkip{CandidateKey: key, Reason: reason})
			continue
		}
		id, err := in.store.InsertContract(ctx, reviewer.OrganizationID, reviewer.AccountID, draft)
		if errors.Is(err, carecontract.ErrContractExists) {
			result.Skipped = append(result.Skipped, carecontract.CreateSkip{CandidateKey: key, Reason: carecontract.SkipContractExists})
			continue
		}
		if err != nil {
			return result, err
		}
		if err := trail(ctx, in.store, reviewer.OrganizationID, reviewer.AccountID, id, key.SchoolID.Int64(), ActionCreate,
			map[string]any{"request_child_id": key.RequestChildID.Int64(), "care_offering_ids": draftOfferings(draft)}); err != nil {
			return result, err
		}
		if err := adoptFamilyChildren(ctx, in.store, in.families, reviewer.OrganizationID, id, draft); err != nil {
			return result, err
		}
		record, err := in.store.Contract(ctx, reviewer.OrganizationID, id, false)
		if err != nil {
			return result, err
		}
		result.Created = append(result.Created, record.Summary)
	}
	return result, nil
}

// lockedBasis takes the lock of the Träger's links and reads under it the
// templates and the keys with a contract: a link run of the Träger waits
// until the drafts are written, or they wait for it, so what an imported
// contract covers is decided under the lock (#7760).
func (in *Intake) lockedBasis(ctx context.Context, organizationID int64, reads []schoolRead) (templateIndex, map[ContractKey]bool, error) {
	if err := in.store.LockChildLinks(ctx, organizationID); err != nil {
		return nil, nil, err
	}
	templates, err := in.templateIndex(ctx, organizationID)
	if err != nil {
		return nil, nil, err
	}
	existing, _, err := in.contractedKeys(ctx, organizationID, reads)
	if err != nil {
		return nil, nil, err
	}
	return templates, existing, nil
}

// draft builds the draft of one key over every module the child books, or
// names why there is none.
func (in *Intake) draft(key carecontract.CandidateKey, reads []schoolRead, templates templateIndex,
	existing map[ContractKey]bool, today calendar.Date) (NewContract, string) {
	contractKey := ContractKey{SchoolID: key.SchoolID.Int64(), RequestChildID: key.RequestChildID.Int64()}
	if existing[contractKey] {
		return NewContract{}, carecontract.SkipContractExists
	}
	read, ok := findRead(reads, key.SchoolID.Int64())
	if !ok {
		return NewContract{}, carecontract.SkipNotFound
	}
	if read.automatic {
		// The school concludes at the acceptance: no manual draft may take
		// the key the conclusion needs (#4680).
		return NewContract{}, carecontract.SkipConclusionAutomatic
	}
	index := slices.IndexFunc(read.applications, func(a carecontract.Application) bool { return ident.ID(a.RequestChildID) == key.RequestChildID })
	if index < 0 {
		return NewContract{}, carecontract.SkipNotFound
	}
	application := read.applications[index]
	booked := bookedCare(read, application, today)
	if len(booked.services) == 0 {
		return NewContract{}, carecontract.SkipNotFound
	}
	terms, issue := templates.terms(key.SchoolID.Int64(), booked.offerings)
	if issue != "" {
		return NewContract{}, issue
	}
	from := booked.effectiveFrom(application, today)
	ends := endsOn(terms, from, booked.until)
	version := carecontract.Version{
		Number: 1, Status: carecontract.VersionRequested, EffectiveFrom: from, EndsOn: ends,
		ChildFirstName: application.ChildFirstName, ChildLastName: application.ChildLastName, ChildBirthDate: application.ChildBirthDate,
		SchoolName: read.school.Name, PhaseName: firstText(booked.phaseName, application.PhaseName),
		Services: boundServices(booked.services, ends), PriceCents: booked.price, Terms: terms,
	}
	draft := NewContract{
		AcceptedAt: application.AcceptedAt, Acceptances: application.Acceptances,
		Key: contractKey, StudentID: application.StudentID, Version: version,
		Party: NewParty{
			FirstName: application.GuardianFirstName, LastName: application.GuardianLastName,
			Email: strings.TrimSpace(application.GuardianEmail), AccountID: application.GuardianAccountID,
		},
	}
	draft.EarlyStart = earlyStartRequested(draft)
	draft.FamilyChildren = application.FamilyChildren
	return draft, ""
}

func draftOfferings(draft NewContract) []int64 {
	ids := []int64{}
	for _, service := range draft.Version.Services {
		if !slices.Contains(ids, service.CareOfferingID.Int64()) {
			ids = append(ids, service.CareOfferingID.Int64())
		}
	}
	return ids
}

// ConclusionModes tells for every school of the Träger how its contracts
// come about (#4680): its own value, else the Träger's, else Weg a. It reads
// a setting, no personal data, in each school's tenant transaction.
func (in *Intake) ConclusionModes(ctx context.Context, reviewer carecontract.Reviewer) ([]carecontract.SchoolConclusion, error) {
	if err := checkReviewer(reviewer); err != nil {
		return nil, err
	}
	schools, err := in.schools.TraegerSchools(ctx, reviewer.OrganizationID)
	if err != nil {
		return nil, fmt.Errorf("care contract: schools: %w", err)
	}
	result := make([]carecontract.SchoolConclusion, 0, len(schools))
	for _, school := range schools {
		var mode string
		err := in.runtime.WithinSchool(ctx, school.ID, func(txCtx context.Context) error {
			var err error
			mode, err = in.modes.ConclusionMode(txCtx, school.ID)
			return err
		})
		if err != nil {
			return nil, fmt.Errorf("care contract: conclusion mode of school %d: %w", school.ID, err)
		}
		result = append(result, carecontract.SchoolConclusion{SchoolID: ident.ID(school.ID), SchoolName: school.Name, Mode: mode})
	}
	return result, nil
}

func (in *Intake) Templates(ctx context.Context, reviewer carecontract.Reviewer) ([]carecontract.OfferingTemplate, error) {
	if err := checkReviewer(reviewer); err != nil {
		return nil, err
	}
	schools, err := in.schools.TraegerSchools(ctx, reviewer.OrganizationID)
	if err != nil {
		return nil, fmt.Errorf("care contract: schools: %w", err)
	}
	offerings, err := in.schoolOfferings(ctx, schools)
	if err != nil {
		return nil, err
	}
	var rows []TemplateRow
	var head carecontract.Letterhead
	var issuers map[int64]carecontract.Issuer
	err = in.runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		var err error
		if head, err = in.letterheads.Letterhead(txCtx, reviewer); err != nil {
			return fmt.Errorf("letterhead: %w", err)
		}
		if issuers, err = in.schoolIssuers(txCtx, reviewer.OrganizationID, schools); err != nil {
			return err
		}
		rows, err = in.store.Templates(txCtx, reviewer.OrganizationID)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("care contract: read templates: %w", err)
	}
	byOffering := map[[2]int64]carecontract.ContractTemplate{}
	for _, row := range rows {
		byOffering[[2]int64{row.SchoolID, row.OfferingID}] = row.Template
	}
	result := []carecontract.OfferingTemplate{}
	for _, school := range schools {
		for _, offering := range offerings[school.ID] {
			var found *carecontract.ContractTemplate
			if template, ok := byOffering[[2]int64{school.ID, offering.ID}]; ok {
				found = &template
			}
			result = append(result, offeringTemplate(school, offering, found, schoolLetterhead(head, issuers, school.ID), issuerName(issuers, school.ID)))
		}
	}
	sortTemplates(result)
	return result, nil
}

// schoolOfferings reads the offerings of every school in its own tenant
// transaction.
func (in *Intake) schoolOfferings(ctx context.Context, schools []carecontract.School) (map[int64][]carecontract.Offering, error) {
	offerings := map[int64][]carecontract.Offering{}
	for _, school := range schools {
		err := in.runtime.WithinSchool(ctx, school.ID, func(txCtx context.Context) error {
			found, err := in.offerings(txCtx, nil)
			offerings[school.ID] = found
			return err
		})
		if err != nil {
			return nil, fmt.Errorf("care contract: read offerings: %w", err)
		}
	}
	return offerings, nil
}

// sortTemplates puts the active offerings first, then by school, the newest
// phase and the name.
func sortTemplates(templates []carecontract.OfferingTemplate) {
	slices.SortStableFunc(templates, func(a, b carecontract.OfferingTemplate) int {
		if a.Active != b.Active {
			if a.Active {
				return -1
			}
			return 1
		}
		return firstNonZero(strings.Compare(a.SchoolName, b.SchoolName), strings.Compare(b.PhaseName, a.PhaseName),
			strings.Compare(a.OfferingName, b.OfferingName))
	})
}

// SaveTemplate creates or replaces the template of one offering of a school
// of the Träger.
func (in *Intake) SaveTemplate(ctx context.Context, reviewer carecontract.Reviewer, schoolID, offeringID int64, input carecontract.TemplateInput,
	expectedVersion string) (carecontract.OfferingTemplate, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.OfferingTemplate{}, err
	}
	input = normalizeTemplate(input)
	if fields := validateTemplate(input); len(fields) > 0 {
		return carecontract.OfferingTemplate{}, &carecontract.ValidationError{Fields: fields}
	}
	schools, err := in.schoolsOf(ctx, reviewer.OrganizationID, schoolID)
	if err != nil {
		return carecontract.OfferingTemplate{}, err
	}
	var offering carecontract.Offering
	err = in.runtime.WithinSchool(ctx, schoolID, func(txCtx context.Context) error {
		found, err := in.offerings(txCtx, []int64{offeringID})
		if err != nil {
			return err
		}
		index := slices.IndexFunc(found, func(o carecontract.Offering) bool { return o.ID == offeringID })
		if index < 0 {
			return carecontract.ErrOfferingNotFound
		}
		offering = found[index]
		return nil
	})
	if err != nil {
		return carecontract.OfferingTemplate{}, err
	}
	var saved carecontract.ContractTemplate
	var head carecontract.Letterhead
	var issuer string
	err = in.runtime.WithinTraeger(ctx, reviewer.OrganizationID, func(txCtx context.Context) error {
		// A save that read no template only inserts: the catalog rollout
		// inserts templates without this lock (ADR 0311).
		stored, err := in.lockTemplateAsRead(txCtx, reviewer.OrganizationID, schoolID, offeringID, expectedVersion)
		if err != nil {
			return err
		}
		if head, issuer, err = in.issuedSchoolLetterhead(txCtx, reviewer, schools[0]); err != nil {
			return err
		}
		if saved, err = in.store.UpsertTemplate(txCtx, reviewer.OrganizationID, reviewer.AccountID, schoolID, offeringID, input, stored != nil); err != nil {
			return err
		}
		return trail(txCtx, in.store, reviewer.OrganizationID, reviewer.AccountID, 0, schoolID, ActionTemplate,
			versionDetails(offeringID, saved.ID.Int64(), saved.TemplateInput))
	})
	if err != nil {
		return carecontract.OfferingTemplate{}, err
	}
	return offeringTemplate(schools[0], offering, &saved, head, issuer), nil
}

// lockTemplateAsRead takes the lock of one offering's template, also for an
// offering without one, and refuses a template that differs from the
// version its author read (ADR 0311): the form sends every condition back,
// also the ones nobody touched.
func (in *Intake) lockTemplateAsRead(ctx context.Context, organizationID, schoolID, offeringID int64, expectedVersion string) (*carecontract.ContractTemplate, error) {
	stored, err := in.store.LockTemplate(ctx, organizationID, schoolID, offeringID)
	if err != nil {
		return nil, err
	}
	return stored, readstate.Check(expectedVersion, carecontract.TemplateVersion(stored))
}

// schoolsOf is every school of the Träger, or only schoolID, which must be
// one of them.
func (in *Intake) schoolsOf(ctx context.Context, organizationID, schoolID int64) ([]carecontract.School, error) {
	schools, err := in.schools.TraegerSchools(ctx, organizationID)
	if err != nil {
		return nil, fmt.Errorf("care contract: schools: %w", err)
	}
	if schoolID <= 0 {
		return schools, nil
	}
	index := slices.IndexFunc(schools, func(s carecontract.School) bool { return s.ID == schoolID })
	if index < 0 {
		return nil, carecontract.ErrSchoolOutsideTraeger
	}
	return []carecontract.School{schools[index]}, nil
}

// readSchools reads the accepted applications and their offerings of every
// school in its own tenant transaction and records the read in that
// school's access log.
func (in *Intake) readSchools(ctx context.Context, reviewer carecontract.Reviewer, schools []carecontract.School,
	children map[int64][]int64, view string) ([]schoolRead, error) {
	reads := make([]schoolRead, 0, len(schools))
	for _, school := range schools {
		read := schoolRead{school: school, offerings: map[int64]carecontract.Offering{}}
		err := in.runtime.WithinSchool(ctx, school.ID, func(txCtx context.Context) error {
			if view == accessViewCreate {
				mode, err := in.modes.ConclusionMode(txCtx, school.ID)
				if err != nil {
					return err
				}
				read.automatic = mode == carecontract.ModeOnAcceptance
			}
			if err := in.readSchool(txCtx, &read, children[school.ID]); err != nil || len(read.applications) == 0 {
				return err
			}
			return in.access.RecordAccess(txCtx, carecontract.SchoolAccess{
				OrganizationID: reviewer.OrganizationID, AccountID: reviewer.AccountID,
				Data: carecontract.SchoolAccessApplications, View: view, Rows: len(read.applications),
			})
		})
		if err != nil {
			return nil, fmt.Errorf("care contract: read school %d: %w", school.ID, err)
		}
		reads = append(reads, read)
	}
	return reads, nil
}

// readSchool reads, in the school's tenant transaction the caller holds, its
// accepted application children (all, or only requestChildIDs) with their
// bookings and the offerings they book.
func (in *Intake) readSchool(ctx context.Context, read *schoolRead, requestChildIDs []int64) error {
	applications, err := in.acceptedApplications(ctx, requestChildIDs)
	if err != nil {
		return err
	}
	read.applications = applications
	if len(applications) == 0 {
		return nil
	}
	offerings, err := in.offerings(ctx, bookedOfferingIDs(applications))
	if err != nil {
		return err
	}
	for _, offering := range offerings {
		read.offerings[offering.ID] = offering
	}
	return nil
}

// acceptedApplications reads the accepted application children with their
// bookings in the caller's tenant transaction.
func (in *Intake) acceptedApplications(ctx context.Context, requestChildIDs []int64) ([]carecontract.Application, error) {
	applications, err := in.applications.AcceptedApplications(ctx, requestChildIDs)
	if err != nil || len(applications) == 0 {
		return applications, err
	}
	ids := make([]int64, len(applications))
	for i, application := range applications {
		ids[i] = application.RequestChildID
	}
	bookings, err := in.bookings.Bookings(ctx, ids)
	if err != nil {
		return nil, err
	}
	for i := range applications {
		applications[i].Bookings = bookings[applications[i].RequestChildID]
	}
	return applications, nil
}

// readParentRequests fills in the parents' own approved requests of the
// applications read, in the caller's tenant transaction (#4816). Only the
// run that follows the bookings needs them; a composition without the port
// knows none.
func (in *Intake) readParentRequests(ctx context.Context, read *schoolRead) error {
	if in.requests == nil || len(read.applications) == 0 {
		return nil
	}
	ids := make([]int64, len(read.applications))
	for i, application := range read.applications {
		ids[i] = application.RequestChildID
	}
	requests, err := in.requests.ApprovedParentRequests(ctx, ids)
	if err != nil {
		return err
	}
	for i := range read.applications {
		read.applications[i].ParentRequests = requests[read.applications[i].RequestChildID]
	}
	return nil
}

// offerings reads the offerings with the names of their phases in the
// caller's tenant transaction.
func (in *Intake) offerings(ctx context.Context, ids []int64) ([]carecontract.Offering, error) {
	offerings, err := in.bookings.Offerings(ctx, ids)
	if err != nil || len(offerings) == 0 {
		return offerings, err
	}
	return in.applications.NamePhases(ctx, offerings)
}

// indexTemplates holds the conditions of every offering and their saved
// versions.
func indexTemplates(rows []TemplateRow) (templateIndex, templateChanges) {
	templates, changed := make(templateIndex, len(rows)), make(templateChanges, len(rows))
	for _, row := range rows {
		key := [2]int64{row.SchoolID, row.OfferingID}
		templates[key] = row.Template.TemplateInput
		changed[key] = templateHistory{updatedAt: row.Template.UpdatedAt, versions: row.Versions, complete: row.VersionsComplete}
	}
	return templates, changed
}

func (in *Intake) templateIndex(ctx context.Context, organizationID int64) (templateIndex, error) {
	rows, err := in.store.Templates(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	index := make(templateIndex, len(rows))
	for _, row := range rows {
		index[[2]int64{row.SchoolID, row.OfferingID}] = row.Template.TemplateInput
	}
	return index, nil
}

func offeringTemplate(school carecontract.School, offering carecontract.Offering, template *carecontract.ContractTemplate, head carecontract.Letterhead,
	issuer string) carecontract.OfferingTemplate {
	text, withdrawal, earlyStart, term, notice := "", "", "", "", ""
	if template != nil {
		text = acceptanceText(template.TemplateInput)
		withdrawal, earlyStart = withdrawalTexts(template.TemplateInput, head, offering.Name)
		term, notice = TermText(template.TemplateInput, nil), NoticeText(template.TemplateInput)
	}
	return carecontract.OfferingTemplate{
		AcceptanceText: text, WithdrawalText: withdrawal, EarlyStartText: earlyStart, TermText: term, NoticeText: notice,
		SchoolID: ident.ID(school.ID), SchoolName: school.Name, OfferingID: ident.ID(offering.ID), OfferingName: offering.Name,
		PhaseName: offering.PhaseName, PriceCents: offering.PriceCents, Active: offering.Active, Template: template,
		Version: carecontract.TemplateVersion(template), IssuerName: issuer,
	}
}

// fixedTermEnd is the day before the matching day in the target month.
// When that day does not exist, the term includes the target month's last day.
func fixedTermEnd(date calendar.Date, months int) calendar.Date {
	first := calendar.NewDate(date.Year(), date.Month()+time.Month(months), 1)
	last := calendar.NewDate(first.Year(), first.Month()+1, 1).AddDays(-1)
	if date.Day() > last.Day() {
		return last
	}
	return calendar.NewDate(first.Year(), first.Month(), date.Day()).AddDays(-1)
}

func bookedOfferingIDs(applications []carecontract.Application) []int64 {
	ids := []int64{}
	for _, application := range applications {
		for _, booking := range application.Bookings {
			if !slices.Contains(ids, booking.CareOfferingID) {
				ids = append(ids, booking.CareOfferingID)
			}
		}
	}
	return ids
}

func schoolIDs(schools []carecontract.School) []int64 {
	ids := make([]int64, len(schools))
	for i, school := range schools {
		ids[i] = school.ID
	}
	return ids
}

func readSchoolIDs(reads []schoolRead) []int64 {
	ids := make([]int64, len(reads))
	for i, read := range reads {
		ids[i] = read.school.ID
	}
	return ids
}

func findRead(reads []schoolRead, schoolID int64) (schoolRead, bool) {
	for _, read := range reads {
		if read.school.ID == schoolID {
			return read, true
		}
	}
	return schoolRead{}, false
}

func uniqueKeys(keys []carecontract.CandidateKey) []carecontract.CandidateKey {
	result := make([]carecontract.CandidateKey, 0, len(keys))
	for _, key := range keys {
		if key.SchoolID > 0 && key.RequestChildID > 0 && !slices.Contains(result, key) {
			result = append(result, key)
		}
	}
	// A fixed order: two overlapping batches insert the same keys one after
	// the other instead of waiting on each other's uncommitted rows.
	slices.SortFunc(result, func(a, b carecontract.CandidateKey) int {
		return firstNonZero(compareIDs(a.SchoolID.Int64(), b.SchoolID.Int64()), compareIDs(a.RequestChildID.Int64(), b.RequestChildID.Int64()))
	})
	return result
}

func firstNonZero(orders ...int) int {
	for _, order := range orders {
		if order != 0 {
			return order
		}
	}
	return 0
}

func compareIDs(a, b int64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

func firstText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
