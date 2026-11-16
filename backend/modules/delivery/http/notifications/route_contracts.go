package notifications

// FeedUnreadCountContract is a zero value of the answer of
// GET /feed/unread-count, for the typed route contract (ADR 0270). The root
// registers the route: this package does not import the API's contract types.
func FeedUnreadCountContract() any { return feedCountResponse{} }
