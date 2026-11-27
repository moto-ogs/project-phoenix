package contract

// NotificationRoomClosed is the notification type of a room the school
// closed for a day or a period (#8234): the staff planned on a block in the
// room within the closure hear about it in the notification feed of the OGS
// portal, and by push while the closure begins within 14
// days and the person did not switch it off. Facilities produces it;
// Delivery registers the type.
const NotificationRoomClosed = "room_closed"
