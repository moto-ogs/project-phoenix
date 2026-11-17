package defaults

import (
	"sort"
	"testing"

	config "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/stretchr/testify/assert"
)

// TestTraegerLevelKeysOfVersionOne pins the first Träger classification (ADR
// 0086 section 4, ADR 0107 point 7): the legal texts of the enrollment and
// the parent portal functions without a lock are "beide"; the colour and the
// texts of the branding are "traeger" (#4653), and so are the switch for the
// debtor number at the confirmation of a holiday registration (#5621) and
// the payment sentence of the confirmation letter (#5622), and the
// thresholds of the hints on the Träger dashboard (#4675), the confirmations
// of a termination and a withdrawal of a care contract (#4682); how the contracts
// of a school come about is "beide" (#4680: Träger value with a school
// override), and so is the retention of parent contacts without a child
// (#5960); the switch and the working-time rules of the Einsatzplanung are
// "traeger" and written with the right Personal (#4708, ADR 0242);
// everything else stays at the school. A change of these lists is a product
// decision.
func TestTraegerLevelKeysOfVersionOne(t *testing.T) {
	t.Parallel()
	want := []string{
		config.KeyCareContractConclusionMode,
		config.KeyEnrollmentLegalAGBText, config.KeyEnrollmentLegalDSGVOEnabled, config.KeyEnrollmentLegalDSGVOText,
		config.KeyEnrollmentLegalEmailContactEnabled, config.KeyEnrollmentLegalEmailContactText,
		config.KeyEnrollmentLegalPhotoEnabled, config.KeyEnrollmentLegalPhotoText, config.KeyEnrollmentLegalTermsEnabled,
		// How long parent contacts outlive their last child (#5960).
		config.KeyGDPRGuardianRetentionDays,
		config.KeyGuardianParentCanRemove, config.KeyGuardianParentInviteMode, config.KeyParentCareModeRequestEnabled,
		config.KeyParentCarePickupRequestEnabled, config.KeyParentGuardianManagementEnabled,
		config.KeyParentMasterDataEditEnabled, config.KeyParentMasterDataRequestEnabled,
		config.KeyParentMessageStaffNameVisible, config.KeyParentNewsEnabled,
	}
	sort.Strings(want)
	wantTraeger := []string{
		config.KeyBrandingFooterText, config.KeyBrandingLetterheadText, config.KeyBrandingPrimaryColor,
		// The notices of the decided end of an extraordinary termination (#4682).
		config.KeyCareContractEndSetNotice, config.KeyCareContractReasonRejectedNotice,
		config.KeyCareContractExtraordinaryConfirmation,
		// The reminder of an unsigned care contract (#4679).
		config.KeyCareContractSignatureReminderDays,
		config.KeyCareContractTerminationConfirmation, config.KeyCareContractWithdrawalConfirmation,
		// How long the Träger keeps its holiday registrations (#6691).
		config.KeyHolidayRegistrationRetentionDays,
		// What the holiday care wish does in a holiday period (#4703).
		config.KeyHolidayRegistrationWishMode,
		config.KeyParentBillingCareMonthChange,
		// The changes of a single invoice the review allows (#6197).
		config.KeyParentBillingCareReviewAddress, config.KeyParentBillingCareReviewAmount,
		config.KeyParentBillingCareReviewPositions, config.KeyParentBillingCareReviewRecipient,
		config.KeyParentBillingCostTakeoverOrder,
		// The DATEV booking batch (#4694).
		config.KeyParentBillingDatevAccountLength, config.KeyParentBillingDatevChartOfAccounts,
		config.KeyParentBillingDatevClientNumber, config.KeyParentBillingDatevConsultantNumber,
		config.KeyParentBillingDatevCostCenterRequired, config.KeyParentBillingDatevFiscalYearStart, config.KeyParentBillingDatevLocked,
		config.KeyParentBillingDatevRevenueAccount,
		// The format of a debtor number (#6675).
		config.KeyParentBillingDebtorNumberDigitsOnly, config.KeyParentBillingDebtorNumberMaxDigits,
		config.KeyParentBillingDebtorNumberMinDigits, config.KeyParentBillingDebtorNumberOnConfirm,
		// Whom the debtor numbers name (#7007).
		config.KeyParentBillingDebtorNumberScope,
		// The SEPA mandate in the parents portal (#4696).
		config.KeyParentBillingOnlineMandate,
		config.KeyParentBillingPaymentText, config.KeyParentBillingSiblingRank,
		// Whether the letters print the GiroCode (#5624).
		config.KeyParentBillingTransferCode,
		// The Einsatzplanung and its working-time rules (#4708).
		config.KeyStaffPlanningCheckBreaks, config.KeyStaffPlanningEnabled,
		config.KeyStaffPlanningMaxDailyHours, config.KeyStaffPlanningMinRestHours,
		config.KeyTraegerAlertChildrenPerStaff, config.KeyTraegerAlertOpenEnrollments, config.KeyTraegerAlertSickPercent,
	}
	staffRight := map[string]bool{
		config.KeyStaffPlanningCheckBreaks: true, config.KeyStaffPlanningEnabled: true,
		config.KeyStaffPlanningMaxDailyHours: true, config.KeyStaffPlanningMinRestHours: true,
	}
	// The payroll file of the Träger (#4712): its DATEV client, a Lohnart
	// per category and kind of contract and the unit of each day category,
	// written with the right Personal.
	payroll := []string{config.KeyTraegerPayrollConsultantNumber, config.KeyTraegerPayrollClientNumber}
	for _, category := range config.TraegerPayrollCategories {
		for _, kind := range config.TraegerPayrollContractKinds {
			payroll = append(payroll, config.TraegerPayrollWageTypeKey(category, kind))
		}
	}
	for _, category := range config.TraegerPayrollDayCategories {
		payroll = append(payroll, config.TraegerPayrollUnitKey(category))
	}
	assert.Len(t, payroll, 2+7*5+3)
	for _, key := range payroll {
		staffRight[key] = true
	}
	wantTraeger = append(wantTraeger, payroll...)
	sort.Strings(wantTraeger)
	var got, gotTraeger []string
	for key, definition := range config.DefaultRegistry().AllDefinitions() {
		switch definition.Levels {
		case config.LevelBoth:
			got = append(got, key)
			assert.Equal(t, config.TraegerRightSettings, definition.TraegerWriteRight, "%s is written with the right Einstellungen", key)
		case config.LevelTraeger:
			gotTraeger = append(gotTraeger, key)
			if staffRight[key] {
				assert.Equal(t, config.TraegerRightStaff, definition.TraegerWriteRight, "%s is written with the right Personal", key)
				continue
			}
			assert.Equal(t, config.TraegerRightSettings, definition.TraegerWriteRight, "%s is written with the right Einstellungen", key)
		case config.LevelSchool:
		default:
			t.Errorf("%s has unknown level %q", key, definition.Levels)
		}
	}
	sort.Strings(got)
	sort.Strings(gotTraeger)
	assert.Equal(t, want, got)
	assert.Equal(t, wantTraeger, gotTraeger)
}
