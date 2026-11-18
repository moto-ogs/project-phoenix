package contract

// NotificationMealPlanChanged is the notification type of a changed meal
// plan (#7145): the guardians of the children with a meal booked on the
// changed day hear about it in the notification feed of the parents portal,
// and by push only who switched the type on. Meal Plan produces it; Delivery
// registers the type.
const NotificationMealPlanChanged = "meal_plan_changed"
