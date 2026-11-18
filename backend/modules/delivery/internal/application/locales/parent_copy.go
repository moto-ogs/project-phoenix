package locales

import (
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Existing stored copy-kind protocol values.
const (
	ParentAnnouncementReminder = "announcement_reminder"
	ParentCareCancelled        = "care_cancelled"
	ParentPollPublished        = "poll"
	ParentPollReminder         = "poll_reminder"
)

// ParentAnnouncementCopy is the canonical parent announcement and poll copy.
func ParentAnnouncementCopy(locale, kind string) (string, string) {
	switch Normalize(locale) {
	case "en":
		return parentAnnouncementCopyEN(kind)
	case "ru":
		return parentAnnouncementCopyRU(kind)
	case "sq":
		return parentAnnouncementCopySQ(kind)
	case "pl":
		return parentAnnouncementCopyPL(kind)
	case "tr":
		return parentAnnouncementCopyTR(kind)
	case "uk":
		return parentAnnouncementCopyUK(kind)
	default:
		return parentAnnouncementCopyDE(kind)
	}
}

func parentAnnouncementCopyEN(kind string) (string, string) {
	switch kind {
	case ParentPollPublished:
		return "New poll", "A school is asking for your response in the parent portal."
	case ParentPollReminder:
		return "Reminder: poll open", "A response for your child is still missing in the parent portal."
	case ParentAnnouncementReminder:
		return "Reminder: parent announcement", "Your after-school care reminds you of an announcement in the parent portal."
	case ParentCareCancelled:
		return "Care cancelled", "The after-school care has cancelled one of your child's sessions."
	default:
		return "New parent announcement", "A new announcement is available in the parent portal."
	}
}

func parentAnnouncementCopyRU(kind string) (string, string) {
	switch kind {
	case ParentPollPublished:
		return "Новый опрос", "Школа просит вас ответить в родительском портале."
	case ParentPollReminder:
		return "Напоминание: опрос открыт", "В родительском портале ещё нет ответа за вашего ребёнка."
	case ParentAnnouncementReminder:
		return "Напоминание: объявление", "Продлёнка напоминает вам об объявлении в родительском портале."
	case ParentCareCancelled:
		return "Занятие отменено", "Группа продлённого дня отменила одно из занятий вашего ребёнка."
	default:
		return "Новое объявление для родителей", "В родительском портале доступно новое объявление."
	}
}

func parentAnnouncementCopySQ(kind string) (string, string) {
	switch kind {
	case ParentPollPublished:
		return "Anketë e re", "Një shkollë kërkon përgjigjen tuaj në portalin e prindërve."
	case ParentPollReminder:
		return "Kujtesë: anketa është e hapur", "Në portalin e prindërve mungon ende një përgjigje për fëmijën tuaj."
	case ParentAnnouncementReminder:
		return "Kujtesë: njoftim për prindërit", "Kujdesi pas shkollës ju kujton një njoftim në portalin e prindërve."
	case ParentCareCancelled:
		return "Kujdesi anulohet", "Kujdesi pas shkollës ka anuluar një nga takimet e fëmijës suaj."
	default:
		return "Njoftim i ri për prindërit", "Një njoftim i ri është i disponueshëm në portalin e prindërve."
	}
}

func parentAnnouncementCopyPL(kind string) (string, string) {
	switch kind {
	case ParentPollPublished:
		return "Nowa ankieta", "Szkoła prosi o Państwa odpowiedź w portalu dla rodziców."
	case ParentPollReminder:
		return "Przypomnienie: ankieta otwarta", "W portalu dla rodziców brakuje jeszcze odpowiedzi za Państwa dziecko."
	case ParentAnnouncementReminder:
		return "Przypomnienie: ogłoszenie dla rodziców", "OGS przypomina o ogłoszeniu w portalu dla rodziców."
	case ParentCareCancelled:
		return "Opieka odwołana", "OGS odwołała jeden z terminów opieki Państwa dziecka."
	default:
		return "Nowe ogłoszenie dla rodziców", "W portalu dla rodziców jest nowe ogłoszenie."
	}
}

func parentAnnouncementCopyTR(kind string) (string, string) {
	switch kind {
	case ParentPollPublished:
		return "Yeni anket", "Bir okul veli portalında yanıtınızı bekliyor."
	case ParentPollReminder:
		return "Hatırlatma: anket açık", "Veli portalında çocuğunuz için bir yanıt hâlâ eksik."
	case ParentAnnouncementReminder:
		return "Hatırlatma: veli duyurusu", "OGS, veli portalındaki bir duyuruyu hatırlatıyor."
	case ParentCareCancelled:
		return "Bakım iptal edildi", "OGS, çocuğunuzun bakım günlerinden birini iptal etti."
	default:
		return "Veliler için yeni duyuru", "Veli portalında yeni bir duyuru var."
	}
}

func parentAnnouncementCopyUK(kind string) (string, string) {
	switch kind {
	case ParentPollPublished:
		return "Нове опитування", "Школа просить вас відповісти в батьківському порталі."
	case ParentPollReminder:
		return "Нагадування: опитування відкрите", "У батьківському порталі ще немає відповіді за вашу дитину."
	case ParentAnnouncementReminder:
		return "Нагадування: оголошення для батьків", "OGS нагадує вам про оголошення в батьківському порталі."
	case ParentCareCancelled:
		return "Догляд скасовано", "OGS скасувала один із днів догляду вашої дитини."
	default:
		return "Нове оголошення для батьків", "У батьківському порталі є нове оголошення."
	}
}

func parentAnnouncementCopyDE(kind string) (string, string) {
	switch kind {
	case ParentPollPublished:
		return "Neue Umfrage", "Eine Schule bittet um deine Rückmeldung im Elternportal."
	case ParentPollReminder:
		return "Erinnerung: Umfrage offen", "Für dein Kind fehlt noch eine Rückmeldung im Elternportal."
	case ParentAnnouncementReminder:
		return "Erinnerung: Elternmitteilung", "Deine OGS erinnert dich an eine Mitteilung im Elternportal."
	case ParentCareCancelled:
		return "Betreuung fällt aus", "Die OGS hat einen Betreuungstermin deines Kindes abgesagt."
	default:
		return "Neue Elternmitteilung", "Eine neue Mitteilung ist im Elternportal verfügbar."
	}
}

// ParentMessageCopy is the canonical generic parent message notice.
func ParentMessageCopy(locale string) (string, string) {
	switch Normalize(locale) {
	case "en":
		return "New message from the OGS", "You have a new message in the parent portal."
	case "ru":
		return "Новое сообщение от продлёнки", "У вас новое сообщение в родительском портале."
	case "sq":
		return "Mesazh i ri nga OGS-ja", "Keni një mesazh të ri në portalin e prindërve."
	case "pl":
		return "Nowa wiadomość od OGS", "Mają Państwo nową wiadomość w portalu dla rodziców."
	case "tr":
		return "OGS'den yeni mesaj", "Veli portalında yeni bir mesajınız var."
	case "uk":
		return "Нове повідомлення від OGS", "У вас нове повідомлення в батьківському порталі."
	default:
		return "Neue Nachricht der OGS", "Du hast eine neue Nachricht im Elternportal."
	}
}

// ParentBillingDocumentCopy is the push that a Träger put a document in the
// inbox of the parents portal (#4671). Like every parent push it names no
// child and no amount; the document waits in the portal.
func ParentBillingDocumentCopy(locale string) (string, string) {
	switch Normalize(locale) {
	case "en":
		return "New document from the provider", "You have a new document in the parent portal."
	case "ru":
		return "Новый документ от организации", "У вас новый документ в родительском портале."
	case "sq":
		return "Dokument i ri nga ofruesi", "Keni një dokument të ri në portalin e prindërve."
	case "pl":
		return "Nowy dokument od organizatora", "Mają Państwo nowy dokument w portalu dla rodziców."
	case "tr":
		return "Kurumdan yeni belge", "Veli portalında yeni bir belgeniz var."
	case "uk":
		return "Новий документ від організації", "У вас новий документ у батьківському порталі."
	default:
		return "Neues Dokument vom Träger", "Du hast ein neues Dokument im Elternportal."
	}
}

// ParentMealPlanChangedCopy is the push that the meal plan changed on a day
// a child has a meal booked (#7145). Like every parent push it names no child
// and no dish; the notice in the parents portal says which week changed.
func ParentMealPlanChangedCopy(locale string) (string, string) {
	switch Normalize(locale) {
	case "en":
		return "Meal plan changed", "The meal plan has changed. Please check your meal booking in the parent portal."
	case "ru":
		return "Меню изменено", "Меню изменилось. Пожалуйста, проверьте заказ питания в родительском портале."
	case "sq":
		return "Menyja ndryshoi", "Menyja e ushqimit ka ndryshuar. Ju lutemi kontrolloni rezervimin e ushqimit në portalin e prindërve."
	case "pl":
		return "Zmiana jadłospisu", "Jadłospis się zmienił. Prosimy sprawdzić zamówienie posiłków w portalu dla rodziców."
	case "tr":
		return "Yemek planı değişti", "Yemek planı değişti. Lütfen veli portalında yemek rezervasyonunuzu kontrol edin."
	case "uk":
		return "Меню змінено", "Меню змінилося. Будь ласка, перевірте замовлення харчування в батьківському порталі."
	default:
		return "Speiseplan geändert", "Der Speiseplan hat sich geändert. Bitte prüfe die Essensbuchung im Elternportal."
	}
}

// ParentMealPlanChangedFeedCopy is the notification feed entry for a changed
// meal plan. Unlike the push, it names the affected week so parents can open
// the matching plan after they sign in.
func ParentMealPlanChangedFeedCopy(locale string, monday calendar.Date) (string, string) {
	from, until := monday.Format("02.01."), monday.AddDays(4).Format("02.01.2006")
	switch Normalize(locale) {
	case "en":
		return "Meal plan changed", fmt.Sprintf(
			"The meal plan for the week from %s to %s has changed. Please check whether your child's meal booking is still correct.", from, until)
	case "ru":
		return "Меню изменено", fmt.Sprintf(
			"Меню на неделю с %s по %s изменилось. Пожалуйста, проверьте, актуален ли заказ питания вашего ребёнка.", from, until)
	case "sq":
		return "Menyja ndryshoi", fmt.Sprintf(
			"Menyja për javën nga %s deri më %s ka ndryshuar. Ju lutemi kontrolloni nëse rezervimi i ushqimit për fëmijën tuaj është ende i saktë.", from, until)
	case "pl":
		return "Zmiana jadłospisu", fmt.Sprintf(
			"Jadłospis na tydzień od %s do %s zmienił się. Prosimy sprawdzić, czy zamówienie posiłków dla Państwa dziecka jest nadal aktualne.", from, until)
	case "tr":
		return "Yemek planı değişti", fmt.Sprintf(
			"%s ile %s arasındaki haftanın yemek planı değişti. Lütfen çocuğunuzun yemek rezervasyonunun hâlâ uygun olup olmadığını kontrol edin.", from, until)
	case "uk":
		return "Меню змінено", fmt.Sprintf(
			"Меню на тиждень з %s до %s змінилося. Будь ласка, перевірте, чи замовлення харчування вашої дитини ще актуальне.", from, until)
	default:
		return "Speiseplan geändert", fmt.Sprintf(
			"Der Speiseplan für die Woche vom %s bis %s hat sich geändert. Bitte prüfe, ob die Essensbuchung deines Kindes noch passt.", from, until)
	}
}
