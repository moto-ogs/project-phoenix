package users

// GuardianContractTypes are the body types of the guardian routes the
// contract registers (ADR 0270), lists as lists. People Directory's http role
// may not import the contract types, so the root builds the registrations.
type GuardianContractTypes struct {
	Pickers, Phones, Phone, PhoneCreate, PhoneUpdate                                    any
	LinkRequest, Link, LinkUpdate, WithRelationships, BatchRequest                      any
	Entry, EntryRequest                                                                 any
	DeletePreview, EmailStatuses                                                        any
	PaymentMasked, PaymentReveal, PaymentRequest, PayerRequest, Overview, PaymentExport any
	BulkInviteRequest, BulkInvite, InviteRequest, Invite, Approvals                     any
	Guardian, GuardianCreate, GuardianUpdate, Invitation                                any
	// PaymentExportFormats are the formats PaymentExportRequest takes.
	PaymentExportFormats []string
}

// RouteContractTypes names the body types of the guardian routes.
func RouteContractTypes() GuardianContractTypes {
	return GuardianContractTypes{
		Pickers: []GuardianPickerResponse{}, Phones: []PhoneNumberResponse{}, Phone: PhoneNumberResponse{},
		PhoneCreate: PhoneNumberCreateRequest{}, PhoneUpdate: PhoneNumberUpdateRequest{},
		LinkRequest: StudentGuardianLinkRequest{}, Link: GuardianLinkResponse{}, LinkUpdate: StudentGuardianUpdateRequest{},
		WithRelationships: []GuardianWithRelationship{}, BatchRequest: CreateStudentGuardiansRequest{},
		Entry: GuardianWithRelationship{}, EntryRequest: GuardianEntryRequest{},
		DeletePreview: GuardianDeletePreview{}, EmailStatuses: []guardianEmailStatusResponse{},
		PaymentMasked: GuardianPaymentMaskedResponse{}, PaymentReveal: GuardianPaymentRevealResponse{},
		PaymentRequest: GuardianPaymentRequest{}, PayerRequest: StudentPayerRequest{}, Overview: []PaymentOverviewRow{}, PaymentExport: PaymentExportRequest{},
		BulkInviteRequest: bulkInviteRequest{}, BulkInvite: bulkInviteResponse{},
		InviteRequest: inviteToStudentRequest{}, Invite: inviteToStudentResponse{}, Approvals: []pendingApprovalResponse{},
		Guardian: GuardianResponse{}, GuardianCreate: GuardianCreateRequest{}, GuardianUpdate: GuardianUpdateRequest{},
		Invitation:           GuardianInvitationResponse{},
		PaymentExportFormats: []string{exportFormatPDF, exportFormatDOCX, exportFormatXLSX},
	}
}
