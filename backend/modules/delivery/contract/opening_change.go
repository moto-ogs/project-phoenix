package contract

// NotificationOpeningChangeChanged is the notification type of an opening
// change of the school that was entered, changed or deleted (#8178): the
// staff of the school hear about it in the notification feed of the OGS
// portal, and by push while the change takes effect within 14 days and the
// person did not switch it off. School Calendar produces it; Delivery
// registers the type.
const NotificationOpeningChangeChanged = "opening_change_changed"

// NotificationParentOpeningChangeChanged is the same notice for the families
// (#8178): every guardian holding parent_portal.access for a child of the
// school. It follows the school switch of NotificationOpeningChangeChanged.
const NotificationParentOpeningChangeChanged = "parent_opening_change_changed"

// NotificationTraegerOpeningChangeChanged is the same notice for the
// Träger-Büro (#8178), in the bell of the Träger-Portal. It follows the school
// switch of NotificationOpeningChangeChanged and never pushes.
const NotificationTraegerOpeningChangeChanged = "traeger_opening_change_changed"
