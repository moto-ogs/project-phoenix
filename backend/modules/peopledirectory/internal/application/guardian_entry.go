package application

import (
	"context"
	"errors"
	"fmt"

	peopleValues "github.com/moto-ogs/project-phoenix/modules/peopledirectory"

	peoplePorts "github.com/moto-ogs/project-phoenix/modules/peopledirectory/ports"
)

// UpdateGuardianEntry saves the staff form of a child's guardian in the
// caller's transaction: profile, this child's link and the phone list. It
// locks the profile, then the link, the order the parents-portal contact
// edit takes as well; every phone writer locks the profile too. check sees
// the locked state before anything is written and refuses a stale edit.
func (s *RetainedGuardianService) UpdateGuardianEntry(ctx context.Context, edit peopleValues.GuardianEntryEdit, check func(*peopleValues.GuardianProfileSnapshot, *peopleValues.GuardianRelationshipSnapshot) error) error {
	if err := s.GuardianProfileRepo.LockByIDForUpdate(ctx, edit.GuardianProfileID); err != nil {
		return guardianLookupFailure(peopleValues.ErrGuardianNotFound, fmt.Errorf(errMsgGuardianNotFound, err))
	}
	link, err := s.StudentGuardianRepo.FindByStudentAndGuardianForUpdate(ctx, edit.StudentID, edit.GuardianProfileID)
	if err != nil {
		return guardianLookupFailure(peopleValues.ErrGuardianLinkNotFound, fmt.Errorf("relationship not found: %w", err))
	}
	profile, err := s.GuardianProfileRepo.FindByID(ctx, edit.GuardianProfileID)
	if err != nil {
		return guardianLookupFailure(peopleValues.ErrGuardianNotFound, fmt.Errorf(errMsgGuardianNotFound, err))
	}
	phones, err := s.GuardianPhoneNumberRepo.FindByGuardianID(ctx, profile.ID)
	if err != nil {
		return fmt.Errorf("failed to load guardian phone numbers: %w", err)
	}
	profile.PhoneNumbers = phones
	if err := check(profile, link); err != nil {
		return err
	}

	stored := toDirectoryGuardian(profile)
	if err := s.updateGuardian(ctx, profile, toGuardianCreateRequest(edit.Profile.Apply(stored))); err != nil {
		return err
	}
	// The link stays locked by this unit; the update reads it again by ID.
	if err := s.UpdateStudentGuardianRelationship(ctx, link.ID, peoplePorts.StudentGuardianUpdateRequest{
		RelationshipType: edit.Link.RelationshipType, GuardianRole: edit.Link.GuardianRole,
		IsPrimary: edit.Link.IsPrimary, IsEmergencyContact: edit.Link.IsEmergencyContact, CanPickup: edit.Link.CanPickup,
		PickupNotes: edit.Link.PickupNotes, EmergencyPriority: edit.Link.EmergencyPriority,
	}); err != nil {
		return err
	}
	if edit.Phones == nil {
		return nil
	}
	return s.replaceGuardianPhones(ctx, profile.ID, phones, *edit.Phones)
}

// replaceGuardianPhones makes the stored list the saved one, in the order the
// staff form used to send its single requests: change and add, delete what
// the form left out, then move the primary mark.
func (s *RetainedGuardianService) replaceGuardianPhones(ctx context.Context, guardianID int64, stored []*peopleValues.GuardianProfilePhoneSnapshot, saved []peopleValues.GuardianPhoneEdit) error {
	storedByID := make(map[int64]*peopleValues.GuardianProfilePhoneSnapshot, len(stored))
	var storedPrimary int64
	for _, phone := range stored {
		storedByID[phone.ID] = phone
		if phone.IsPrimary {
			storedPrimary = phone.ID
		}
	}
	kept := make(map[int64]bool, len(saved))
	var primary int64
	for _, phone := range saved {
		id, err := s.saveGuardianPhone(ctx, guardianID, storedByID, phone)
		if err != nil {
			return err
		}
		kept[id] = true
		if phone.IsPrimary {
			primary = id
		}
	}
	for _, phone := range stored {
		if kept[phone.ID] {
			continue
		}
		if err := s.DeletePhoneNumber(ctx, phone.ID); err != nil {
			return err
		}
	}
	if primary == 0 || primary == storedPrimary {
		return nil
	}
	return s.SetPrimaryPhone(ctx, primary)
}

// saveGuardianPhone changes a stored number or adds a new one and answers its
// ID. A number of another guardian is refused as invalid input.
func (s *RetainedGuardianService) saveGuardianPhone(ctx context.Context, guardianID int64, stored map[int64]*peopleValues.GuardianProfilePhoneSnapshot, phone peopleValues.GuardianPhoneEdit) (int64, error) {
	if phone.ID == 0 {
		created, err := s.AddPhoneNumber(ctx, guardianID, peoplePorts.PhoneNumberCreateRequest{
			PhoneNumber: phone.PhoneNumber, PhoneType: phone.PhoneType, Label: phone.Label, IsPrimary: phone.IsPrimary,
		})
		if err != nil {
			return 0, err
		}
		return created.ID, nil
	}
	if stored[phone.ID] == nil {
		return 0, newGuardianValidationError(errors.New("phone number belongs to another guardian"))
	}
	// The primary mark moves once the list is complete, as before.
	number, phoneType := phone.PhoneNumber, phone.PhoneType
	if err := s.UpdatePhoneNumber(ctx, phone.ID, peoplePorts.PhoneNumberUpdateRequest{
		PhoneNumber: &number, PhoneType: &phoneType, Label: phone.Label,
	}); err != nil {
		return 0, err
	}
	return phone.ID, nil
}
