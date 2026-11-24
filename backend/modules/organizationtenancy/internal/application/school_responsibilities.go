package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// Responsibilities at the schools of a Träger (#4811). Like the master
// data, the service opens no transaction: the Träger-Portal route runs it
// in the Träger transaction of the session's Träger. Every write locks the
// Träger's profile row first, decides every refusal before its first write
// and logs the change in the master data log of the same transaction. The
// choices themselves are settings; the root binds their read.

var (
	errPostalCodeInvalid = errors.New("is not a German postal code")
	errCreditorIDInvalid = errors.New("is not a SEPA creditor identifier")
)

// Field limits of a body's master data; the table checks the same.
const (
	maxSchoolPartyName   = 140
	maxSchoolPartyStreet = 140
	maxSchoolPartyCity   = 120
)

// SchoolResponsibilities implements organizationtenancy.SchoolResponsibilities.
type SchoolResponsibilities struct {
	store    ports.SchoolPartyStore
	settings organizationtenancy.SchoolResponsibilitySettings
}

var _ organizationtenancy.SchoolResponsibilities = (*SchoolResponsibilities)(nil)

// NewSchoolResponsibilities builds the service.
func NewSchoolResponsibilities(store ports.SchoolPartyStore, settings organizationtenancy.SchoolResponsibilitySettings) *SchoolResponsibilities {
	if store == nil || settings == nil {
		panic("organization tenancy: the school party store and the responsibility settings are required")
	}
	return &SchoolResponsibilities{store: store, settings: settings}
}

// Overview reads the schools of the Träger with their responsibilities and
// logs the read.
func (s *SchoolResponsibilities) Overview(ctx context.Context, organizationID, accountID int64) (organizationtenancy.ResponsibilityOverview, error) {
	if organizationID <= 0 {
		return organizationtenancy.ResponsibilityOverview{}, errTraegerRequired
	}
	schools, err := s.store.TraegerSchoolNames(ctx, organizationID)
	if err != nil {
		return organizationtenancy.ResponsibilityOverview{}, err
	}
	schoolIDs := make([]int64, 0, len(schools))
	for _, school := range schools {
		schoolIDs = append(schoolIDs, school.ID)
	}
	parties, choices, err := s.read(ctx, organizationID, schoolIDs)
	if err != nil {
		return organizationtenancy.ResponsibilityOverview{}, err
	}
	overview := organizationtenancy.ResponsibilityOverview{Schools: make([]organizationtenancy.SchoolResponsibility, 0, len(schools))}
	stored := 0
	for _, school := range schools {
		entry := organizationtenancy.SchoolResponsibility{SchoolID: ident.ID(school.ID), SchoolName: school.Name,
			Areas: make([]organizationtenancy.AreaResponsibility, 0, 3), Parties: []organizationtenancy.SchoolParty{}}
		for _, area := range organizationtenancy.ResponsibilityAreas() {
			choice := choices[school.ID][area]
			entry.Areas = append(entry.Areas, organizationtenancy.AreaResponsibility{Area: area, Body: choice.Body, Source: choice.Source,
				Effective: organizationtenancy.EffectiveBody(area, choice.Body, parties[school.ID])})
		}
		for _, kind := range []organizationtenancy.ResponsibleBody{organizationtenancy.BodySchultraeger, organizationtenancy.BodyGemeinde} {
			if party, ok := parties[school.ID][kind]; ok {
				entry.Parties = append(entry.Parties, party)
				stored++
			}
		}
		overview.Schools = append(overview.Schools, entry)
	}
	read, _ := json.Marshal(map[string]int{"schools": len(schools), "parties": stored})
	if err := s.audit(ctx, organizationID, accountID, 0, domain.TraegerAuditActionRead, nil, read); err != nil {
		return organizationtenancy.ResponsibilityOverview{}, err
	}
	return overview, nil
}

// ResponsibleParties names per school the Schulträger or the Gemeinde
// responsible for area.
func (s *SchoolResponsibilities) ResponsibleParties(ctx context.Context, organizationID int64, area organizationtenancy.ResponsibilityArea,
	schoolIDs []int64) (map[int64]organizationtenancy.SchoolParty, error) {
	if organizationID <= 0 {
		return nil, errTraegerRequired
	}
	// Only schools of the Träger: the settings are read outside its
	// transaction, so a foreign school must not reach that read.
	own, err := s.store.TraegerSchoolNames(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	asked := make([]int64, 0, len(schoolIDs))
	for _, school := range own {
		if slices.Contains(schoolIDs, school.ID) {
			asked = append(asked, school.ID)
		}
	}
	result := map[int64]organizationtenancy.SchoolParty{}
	if len(asked) == 0 {
		return result, nil
	}
	parties, choices, err := s.read(ctx, organizationID, asked)
	if err != nil {
		return nil, err
	}
	for _, schoolID := range asked {
		body := organizationtenancy.EffectiveBody(area, choices[schoolID][area].Body, parties[schoolID])
		if body != organizationtenancy.BodyTraeger {
			result[schoolID] = parties[schoolID][body]
		}
	}
	return result, nil
}

// read loads the stored bodies and the settings of the schools. A school
// the settings do not answer for is an error, never the default.
func (s *SchoolResponsibilities) read(ctx context.Context, organizationID int64, schoolIDs []int64,
) (map[int64]map[organizationtenancy.ResponsibleBody]organizationtenancy.SchoolParty,
	map[int64]map[organizationtenancy.ResponsibilityArea]organizationtenancy.SchoolResponsibilityChoice, error) {
	parties := map[int64]map[organizationtenancy.ResponsibleBody]organizationtenancy.SchoolParty{}
	if len(schoolIDs) == 0 {
		return parties, nil, nil
	}
	stored, err := s.store.SchoolParties(ctx, organizationID, schoolIDs)
	if err != nil {
		return nil, nil, err
	}
	for _, row := range stored {
		if parties[row.SchoolID.Int64()] == nil {
			parties[row.SchoolID.Int64()] = map[organizationtenancy.ResponsibleBody]organizationtenancy.SchoolParty{}
		}
		parties[row.SchoolID.Int64()][row.Kind] = row
	}
	choices, err := s.settings.SchoolResponsibilityChoices(ctx, schoolIDs)
	if err != nil {
		return nil, nil, fmt.Errorf("organization tenancy: read the responsibilities of the schools: %w", err)
	}
	for _, schoolID := range schoolIDs {
		for _, area := range organizationtenancy.ResponsibilityAreas() {
			if choices[schoolID][area].Body == "" {
				return nil, nil, fmt.Errorf("organization tenancy: no responsibility %s for school %d", area, schoolID)
			}
		}
	}
	return parties, choices, nil
}

// SaveParty stores the master data of the school's Schulträger or Gemeinde.
func (s *SchoolResponsibilities) SaveParty(ctx context.Context, organizationID, accountID, schoolID int64, kind organizationtenancy.ResponsibleBody,
	input organizationtenancy.SchoolPartyInput, expectedVersion string) (organizationtenancy.SchoolParty, error) {
	old, err := s.lockedParty(ctx, organizationID, schoolID, kind, true)
	if err != nil {
		return organizationtenancy.SchoolParty{}, err
	}
	input, err = normalizeSchoolParty(input)
	if err != nil {
		return organizationtenancy.SchoolParty{}, err
	}
	// The body as its author read it, under the profile lock (ADR 0311): a
	// new one was read as missing and carries no version.
	current := ""
	if old != nil {
		current = old.Version
	}
	if expectedVersion != current {
		return organizationtenancy.SchoolParty{}, readstate.ErrChanged
	}
	saved, err := s.store.SaveSchoolParty(ctx, organizationID, accountID, schoolID, kind, input)
	if err != nil {
		return organizationtenancy.SchoolParty{}, err
	}
	action, before := domain.TraegerAuditActionCreate, json.RawMessage(nil)
	if old != nil {
		action, before = domain.TraegerAuditActionUpdate, schoolPartyAuditValue(*old)
	}
	if err := s.audit(ctx, organizationID, accountID, saved.ID.Int64(), action, before, schoolPartyAuditValue(saved)); err != nil {
		return organizationtenancy.SchoolParty{}, err
	}
	return saved, nil
}

// RemoveParty deletes the master data of the body.
func (s *SchoolResponsibilities) RemoveParty(ctx context.Context, organizationID, accountID, schoolID int64, kind organizationtenancy.ResponsibleBody) error {
	old, err := s.lockedParty(ctx, organizationID, schoolID, kind, false)
	if err != nil {
		return err
	}
	if old == nil {
		return organizationtenancy.ErrSchoolPartyNotFound
	}
	found, err := s.store.DeleteSchoolParty(ctx, organizationID, schoolID, kind)
	if err != nil {
		return err
	}
	if !found {
		return organizationtenancy.ErrSchoolPartyNotFound
	}
	return s.audit(ctx, organizationID, accountID, old.ID.Int64(), domain.TraegerAuditActionDelete, schoolPartyAuditValue(*old), nil)
}

// lockedParty checks the Träger, the body and the school, locks the
// Träger's profile row and reads the stored body of the school, nil without
// one. create makes the profile row first where it is missing.
func (s *SchoolResponsibilities) lockedParty(ctx context.Context, organizationID, schoolID int64, kind organizationtenancy.ResponsibleBody,
	create bool) (*organizationtenancy.SchoolParty, error) {
	if organizationID <= 0 {
		return nil, errTraegerRequired
	}
	if !kind.HasMasterData() {
		return nil, organizationtenancy.ErrSchoolPartyKindUnknown
	}
	schools, err := s.store.TraegerSchoolNames(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if !slices.ContainsFunc(schools, func(school organizationtenancy.TraegerSchoolName) bool { return school.ID == schoolID }) {
		return nil, organizationtenancy.ErrSchoolPartySchoolNotFound
	}
	if _, err := s.store.LockProfile(ctx, organizationID, create); err != nil {
		return nil, err
	}
	stored, err := s.store.SchoolParties(ctx, organizationID, []int64{schoolID})
	if err != nil {
		return nil, err
	}
	for i := range stored {
		if stored[i].Kind == kind {
			return &stored[i], nil
		}
	}
	return nil, nil
}

func (s *SchoolResponsibilities) audit(ctx context.Context, organizationID, accountID, partyID int64, action string, oldValue, newValue json.RawMessage) error {
	err := s.store.AppendAudit(ctx, domain.TraegerMasterDataAuditEntry{
		OrganizationID: organizationID, Subject: domain.TraegerAuditSubjectSchoolParty, SubjectID: partyID, Action: action,
		OldValue: oldValue, NewValue: newValue, ActorAccountID: accountID,
	})
	if err != nil {
		return fmt.Errorf("organization tenancy: log Träger master data %s %s: %w", domain.TraegerAuditSubjectSchoolParty, action, err)
	}
	return nil
}

// normalizeSchoolParty trims the texts, compacts the codes and checks every
// field; the refusal names each field.
func normalizeSchoolParty(input organizationtenancy.SchoolPartyInput) (organizationtenancy.SchoolPartyInput, error) {
	input.Name, input.Street, input.City = strings.TrimSpace(input.Name), strings.TrimSpace(input.Street), strings.TrimSpace(input.City)
	input.PostalCode = strings.TrimSpace(input.PostalCode)
	input.ContactName, input.ContactPhone = strings.TrimSpace(input.ContactName), strings.TrimSpace(input.ContactPhone)
	input.ContactEmail = strings.ToLower(strings.TrimSpace(input.ContactEmail))
	input.AccountHolder, input.BankName = strings.TrimSpace(input.AccountHolder), strings.TrimSpace(input.BankName)
	input.CreditorID, input.IBAN, input.BIC = domain.CompactCode(input.CreditorID), domain.CompactCode(input.IBAN), domain.CompactCode(input.BIC)
	fields := validation.Errors{}
	requiredText(fields, "name", input.Name, maxSchoolPartyName)
	requiredText(fields, "street", input.Street, maxSchoolPartyStreet)
	requiredText(fields, "city", input.City, maxSchoolPartyCity)
	if !domain.ValidPostalCode(input.PostalCode) {
		fields["postal_code"] = errPostalCodeInvalid
	}
	contact := validateContact(organizationtenancy.TraegerContact{Name: input.ContactName, Phone: input.ContactPhone, Email: input.ContactEmail})
	var contactFields validation.Errors
	if errors.As(contact, &contactFields) {
		for field, err := range contactFields {
			fields["contact_"+field] = err
		}
	}
	if input.CreditorID != "" && !domain.ValidCreditorID(input.CreditorID) {
		fields["creditor_id"] = errCreditorIDInvalid
	}
	checkSchoolPartyAccount(fields, input)
	return input, fields.Filter()
}

// checkSchoolPartyAccount checks the bank account: none at all, or an IBAN
// with its holder.
func checkSchoolPartyAccount(fields validation.Errors, input organizationtenancy.SchoolPartyInput) {
	if input.IBAN == "" {
		if input.AccountHolder != "" || input.BIC != "" || input.BankName != "" {
			fields["iban"] = errRequiredField
		}
		return
	}
	if !domain.ValidIBAN(input.IBAN) {
		fields["iban"] = errIBANInvalid
	}
	requiredText(fields, "account_holder", input.AccountHolder, maxAccountHolder)
	if input.BIC != "" && !domain.ValidBIC(input.BIC) {
		fields["bic"] = errBICInvalid
	}
	if utf8.RuneCountInString(input.BankName) > maxBankName {
		fields["bank_name"] = errTooLong
	}
}

func schoolPartyAuditValue(party organizationtenancy.SchoolParty) json.RawMessage {
	return mustJSON(map[string]any{
		"school_id": party.SchoolID.Int64(), "kind": party.Kind, "name": party.Name, "street": party.Street,
		"postal_code": party.PostalCode, "city": party.City, "contact_name": party.ContactName,
		"contact_phone": party.ContactPhone, "contact_email": party.ContactEmail, "creditor_id": party.CreditorID,
		"account_holder": party.AccountHolder, "iban": party.IBAN, "bic": party.BIC, "bank_name": party.BankName,
	})
}
