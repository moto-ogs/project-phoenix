// Package compose builds the Elternabrechnung (parent-billing, ADR 0088).
package compose

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/modules/parentbilling/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/parentbilling/internal/adapters/rendering"
	"github.com/moto-ogs/project-phoenix/modules/parentbilling/internal/application"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NewContributionRules builds the rules and cost bearers (#5627) of a Träger in its Träger transaction (ADR 0105) on the root's clock.
func NewContributionRules(now func() time.Time) parentbilling.ContributionRules {
	return application.NewRules(postgres.NewStore(now))
}

// NewHolidayContributions builds the holiday contribution and allocation billing over the root-bound registrations (ADR 0115).
func NewHolidayContributions(registrations parentbilling.HolidayRegistrations, settings parentbilling.HolidayBillingSettings, today func() calendar.Date, now func() time.Time) (parentbilling.HolidayContributions, parentbilling.HolidayAllocationBilling) {
	return application.NewHolidayContributions(postgres.NewStore(now), registrations, settings, today)
}

// NewBillingRuns builds the billing runs (#4668, ADR 0119, ADR 0122) and the kind of document per service (#4688) over the registrations and document templates the root binds; names names who set a start value of a number range (#7358); now stamps the overview (ADR 0275).
func NewBillingRuns(registrations parentbilling.HolidayBillingRegistrations, settings parentbilling.HolidayBillingSettings, templates parentbilling.BillingDocumentTemplates, names parentbilling.ExportActorNames, today func() calendar.Date, now func() time.Time) (*application.BillingRuns, parentbilling.BillingDocumentKinds) {
	return application.NewBillingRuns(postgres.NewStore(now), registrations, settings, rendering.NewRenderer(now), templates, names, today), application.NewDocumentKinds(postgres.NewStore(now), templates)
}

// NewBillingLetterMail builds the mail and print of the letters (#4670, ADR 0123) over the post and the clock the root binds.
func NewBillingLetterMail(post parentbilling.BillingLetterPost, now func() time.Time) parentbilling.BillingLetterMailService {
	return application.NewBillingLetterMail(postgres.NewStore(now), post, rendering.NewLetterRenderer())
}

// NewLetterMailRenderer renders the mail of a letter for the Delivery worker.
func NewLetterMailRenderer() parentbilling.LetterMailRenderer { return application.RenderLetterMail }

// NewBillingLetters builds the confirmation letters of the released runs (#4669, ADR 0121) over the letterhead of the Träger, which the root binds, and the letter layout of Document Rendering.
func NewBillingLetters(letterheads parentbilling.BillingLetterheads, bankData parentbilling.BankDataCipher, today func() calendar.Date, now func() time.Time) parentbilling.BillingLetterService {
	return application.NewBillingLetters(postgres.NewStore(now), letterheads, rendering.NewLetterRenderer(), bankData, today)
}

// NewParentDocuments builds the inbox of the parents portal (#4671, ADR 0126) in the Träger transaction it opens; no write it reaches stamps from the store clock (ADR 0281).
func NewParentDocuments() *application.ParentDocuments {
	return application.NewParentDocuments(postgres.NewStore(time.Now))
}

// NewBillingFamilies builds the invoices and amounts per family (#4691), checking a debtor number in the format of the Träger (#6675), and the finance exports with their protocol (#4693), which names the people of the Träger-Büro through names, whose DATEV booking batch (#4694) reads the DATEV settings of the Träger; today and now are the root's clocks.
func NewBillingFamilies(post parentbilling.InvoiceHistoryPost, names parentbilling.ExportActorNames, datev parentbilling.DatevBillingSettings, schools parentbilling.CareSchools, formats parentbilling.DebtorNumberFormats, contracts parentbilling.FamilyContracts, careContracts parentbilling.CareContracts, today func() calendar.Date, now func() time.Time) (parentbilling.BillingFamilies, parentbilling.FinanceExports, parentbilling.BookingAccountService) {
	return application.NewBillingFamilies(postgres.NewStore(now), contracts, careContracts, formats, today), application.NewFinanceExports(postgres.NewStore(now), post, names, datev, today, now), application.NewBookingAccounts(postgres.NewStore(now), datev, schools)
}

// MonthlyBilling is the monthly run with its Mensa prices (#4684, #4686) and the discard of an empty open run (#6626).
type MonthlyBilling interface {
	parentbilling.CareBilling
	parentbilling.CareMealBilling
	parentbilling.CareRunDiscard
	parentbilling.CareModulePrices
}

// NewCareBilling builds the monthly contribution of the care contract (#4684), its rule chain (#4685) and its Mensa (#4686) over the contracts, schools, settings and released Mensa months the root binds, and the document templates (#4688); now stamps the overview (ADR 0275).
func NewCareBilling(contracts parentbilling.CareContracts, schools parentbilling.CareSchools, settings parentbilling.CareBillingSettings, meals parentbilling.CareMeals, templates parentbilling.BillingDocumentTemplates, today func() calendar.Date, now func() time.Time) (MonthlyBilling, parentbilling.CareReductions) {
	return application.NewCareBilling(postgres.NewStore(now), contracts, schools, settings, rendering.NewRenderer(now), postgres.NewStore(now), meals, templates, today), application.NewCareReductions(postgres.NewStore(now), contracts, schools, today)
}

// NewCareLetters builds the letters, mail, print and Storno of the monthly runs (#4684, ADR 0165) over the ports the root binds.
func NewCareLetters(letterheads parentbilling.BillingLetterheads, contracts parentbilling.CareContracts, post parentbilling.BillingLetterPost, carePost parentbilling.CareLetterPost, bankData parentbilling.BankDataCipher, today func() calendar.Date, now func() time.Time) parentbilling.CareLetterService {
	ports := application.CareLetterPorts{Letterheads: letterheads, Recipients: contracts, Post: post, CarePost: carePost, BankData: bankData}
	return application.NewCareLetters(postgres.NewStore(now), ports, rendering.NewLetterRenderer(), rendering.NewLetterRenderer(), today)
}

// NewBillingTerms builds the payment terms, the bundling, the family deviations with the debtor number in the format of the Träger (#6675) and the due dates of the runs (#4689) over the contracts the root binds, and the DATEV booking batch of both payment methods (#4694) over the DATEV settings of the Träger; today and now are the root's clocks.
func NewBillingTerms(contracts parentbilling.CareContracts, datev parentbilling.DatevBillingSettings, formats parentbilling.DebtorNumberFormats, today func() calendar.Date, now func() time.Time) (parentbilling.BillingTerms, parentbilling.DatevExport) {
	return application.NewBillingTerms(postgres.NewStore(now), contracts, formats), application.NewDatevExport(datev, today, now)
}

// NewCareFeeNotices builds the Jahresbescheide of the monthly care (#6219, ADR 0182) over the monthly computation and the letterhead of the Träger, which carries the template of the fee notice; the root binds the ports and the clocks.
func NewCareFeeNotices(contracts parentbilling.CareContracts, schools parentbilling.CareSchools, settings parentbilling.CareBillingSettings, meals parentbilling.CareMeals, letterheads parentbilling.BillingLetterheads, today func() calendar.Date, now func() time.Time) parentbilling.CareFeeNotices {
	billing := application.NewCareBilling(postgres.NewStore(now), contracts, schools, settings, rendering.NewRenderer(now), postgres.NewStore(now), meals, letterheads, today)
	return application.NewCareFeeNotices(billing, postgres.NewStore(now), letterheads)
}

// NewCareNoticeLetters builds the stored originals of the Jahresbescheide and their mail and print (#6347) over the ports the root binds; now stamps the recipient trail (ADR 0281).
func NewCareNoticeLetters(letterheads parentbilling.BillingLetterheads, contracts parentbilling.CareContracts, post parentbilling.BillingLetterPost, noticePost parentbilling.CareNoticeLetterPost, now func() time.Time) parentbilling.CareNoticeLetterService {
	return application.NewCareNoticeLetters(postgres.NewStore(now), application.CareNoticeLetterPorts{Letterheads: letterheads, Recipients: contracts, Post: post, NoticePost: noticePost}, rendering.NewLetterRenderer(), rendering.NewLetterRenderer())
}

// NewSEPAMandates builds the SEPA mandates and the creditor of the Träger (#4695, ADR 0171) over the contracts, the field cipher and the day clock the root binds; the import judges a mandate's lapse on that day.
func NewSEPAMandates(contracts parentbilling.CareContracts, cipher parentbilling.BankDataCipher, formats parentbilling.DebtorNumberFormats, today func() calendar.Date, now func() time.Time) parentbilling.SEPAMandates {
	return application.NewSEPAMandates(postgres.NewStore(now), contracts, cipher, formats, today)
}

// NewContractImportNumbers builds the debtor numbers of an import of care contracts (#4723) over the format of the Träger's numbers the root binds.
func NewContractImportNumbers(formats parentbilling.DebtorNumberFormats, today func() calendar.Date, now func() time.Time) parentbilling.ContractImportNumbers {
	return application.NewContractImportNumbers(postgres.NewStore(now), formats, today)
}

// NewSEPAExportFields opens the sealed IBAN, account holder and mandate text for the return export of a Träger (#3838, #6412); only the administrative export CLI binds it, never HTTP.
func NewSEPAExportFields(cipher parentbilling.BankDataCipher) parentbilling.SEPAExportFields {
	return application.NewSEPAExportFields(cipher)
}

// NewBankDataRekey builds maintenance-only re-encryption; never bind it to HTTP.
func NewBankDataRekey(cipher parentbilling.BankDataRewrapper) parentbilling.BankDataRekey {
	return application.NewBankDataRekey(postgres.NewBankDataRekeyStore(), cipher)
}

// NewSEPAReturn builds the bank data of the Rückgabe of a Träger (#6314) over its creditor account and
// the field cipher the root binds. Internal procedure only; never bind it to HTTP. It only reads: no store clock stamps (ADR 0281).
func NewSEPAReturn(creditors parentbilling.SEPACreditorAccounts, cipher parentbilling.BankDataCipher, fingerprint func([]byte) string) parentbilling.SEPAReturn {
	return application.NewSEPAReturn(postgres.NewStore(time.Now), creditors, cipher, fingerprint)
}

// NewSEPADebitDownloadRetention builds the hourly expiry of the unsubmitted PAIN.008 downloads (ADR 0187) on the root's clock.
func NewSEPADebitDownloadRetention(now func() time.Time) parentbilling.SEPADebitDownloadRetention {
	return postgres.NewStore(now)
}

// NewSEPADebits builds the SEPA direct debit file of the issued runs (#4697, ADR 0181) over the letterhead with the bank account of the Träger and the field cipher the root binds, on the root's clocks.
func NewSEPADebits(letterheads parentbilling.BillingLetterheads, cipher parentbilling.BankDataCipher, fingerprint func([]byte) string, today func() calendar.Date, now func() time.Time) parentbilling.SEPADebits {
	return application.NewSEPADebits(postgres.NewStore(now), letterheads, cipher, today, now, fingerprint)
}

// NewBelegRetention builds the retention of the Belege of every Träger (#4720, ADR 0184) over the contracts and the day clock the root binds.
func NewBelegRetention(contracts parentbilling.RetainedContracts, today func() calendar.Date, now func() time.Time) parentbilling.BelegRetention {
	return application.NewBelegRetention(postgres.NewStore(now), contracts, today)
}

// NewParentSEPAMandates builds the SEPA mandate the parents give in the parents portal (#4696) over the contract parties, the bank-data cipher and the Träger's online mandate setting the root binds.
func NewParentSEPAMandates(contracts parentbilling.ContractParties, cipher parentbilling.BankDataCipher, terms parentbilling.OnlineMandateSettings, sums parentbilling.ContentFingerprints, today func() calendar.Date, now func() time.Time) parentbilling.ParentSEPAMandates {
	return application.NewParentMandates(postgres.NewStore(now), contracts, cipher, terms, sums, today)
}

// NewExportHandovers builds the handover of finance exports to the recipient of the Träger (ADR 0218) over the producers of the downloads and the transport the root binds; no write it reaches stamps from the store clock (ADR 0281).
func NewExportHandovers(exports parentbilling.FinanceExports, debits parentbilling.SEPADebits, transfer parentbilling.FinanceExportTransfer) parentbilling.FinanceExportHandovers {
	return application.NewExportHandovers(exports, debits, postgres.NewStore(time.Now), transfer)
}
