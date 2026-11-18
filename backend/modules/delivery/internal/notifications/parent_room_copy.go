package notifications

import "github.com/moto-ogs/project-phoenix/modules/delivery/internal/adapters/localization"

// ParentRoomChangedCopy is the lock-screen copy of a room change for the
// families (#7141). Like every parent push it names neither child nor
// appointment nor room: the feed entry carries those and is read only after
// login.
func ParentRoomChangedCopy(locale string) (string, string) {
	switch localization.NormalizeLocale(locale) {
	case "en":
		return "Room changed", "An appointment for your child takes place in another room."
	case "ru":
		return "Помещение изменено", "Занятие вашего ребёнка пройдёт в другом помещении."
	case "sq":
		return "Salla u ndryshua", "Një takim i fëmijës suaj zhvillohet në një sallë tjetër."
	case "pl":
		return "Zmiana sali", "Zajęcia Państwa dziecka odbędą się w innej sali."
	case "tr":
		return "Oda değişti", "Çocuğunuzun bir etkinliği başka bir odada yapılacak."
	case "uk":
		return "Приміщення змінено", "Заняття вашої дитини пройде в іншому приміщенні."
	default:
		return "Raum geändert", "Ein Termin deines Kindes findet in einem anderen Raum statt."
	}
}
