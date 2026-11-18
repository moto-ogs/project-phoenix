package notifications

// ContractTypes are zero values of the bodies of this package's routes, for
// the typed route contract (ADR 0270). The root registers the routes: this
// package does not import the API's contract types.
type ContractTypes struct {
	FeedPage          any
	TraegerFeedPage   any
	FeedCount         any
	Preferences       any
	PreferenceRequest any
	PushPublicKey     any
	PushSubscription  any
	EmailSubscription any
}

// RouteContractTypes names the body types of the notification routes.
func RouteContractTypes() ContractTypes {
	return ContractTypes{
		FeedPage:          feedPageResponse{},
		TraegerFeedPage:   traegerFeedPageResponse{},
		FeedCount:         feedCountResponse{},
		Preferences:       PreferenceOverview{},
		PreferenceRequest: preferenceRequest{},
		PushPublicKey:     pushPublicKeyResponse{},
		PushSubscription:  pushSubscriptionRequest{},
		EmailSubscription: emailSubscriptionResponse{},
	}
}
