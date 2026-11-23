package identityaccess

import (
	"errors"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The parent step after the silent enrollment of imported contracts (#7760,
// ADR 0309 section 5): a guardian who already uses the parents portal and may
// see a selected child whose care runs today gets one short mail that the
// care is now visible there, naming every such child once. The school sends
// it deliberately from the bulk invitation (NotifyActive); the silent run
// never does. The mail goes to the login address of the account that holds
// the access and names the children's first names, the school and the way to
// the portal, nothing else: no account data, no health data, no contract
// amounts.

// MailKindGuardianCareVisible is the Delivery outbox kind of the mail.
const MailKindGuardianCareVisible = "guardian_care_visible"

// ChildCarePeriod is one approved care period of a child (Enrollment), the
// periods the parents portal shows the child's care from.
type ChildCarePeriod struct {
	StudentID int64
	// RequestChildID is the approved child of the application whose
	// bookings the portal lists for the period.
	RequestChildID int64
	Start          calendar.Date
	End            calendar.Date
}

// GuardianCareNotice is one mail to queue: one guardian, the children it
// covers.
type GuardianCareNotice struct {
	GuardianProfileID int64
	StudentIDs        []int64
	// Recipient carries the guardian's name and the login address of the
	// account, never the contact address of the profile.
	Recipient       GuardianMailRecipient
	ChildFirstNames []string
	SchoolName      string
	// Locale is the parents-portal language of the guardian's account; any
	// other value reads German.
	Locale string
}

// GuardianCareVisibleMail is what the queued mail carries.
type GuardianCareVisibleMail struct {
	Recipient       string
	FirstName       string
	LastName        string
	ChildFirstNames []string
	SchoolName      string
	PortalURL       string
	LogoURL         string
	Locale          string
}

// GuardianCareVisibleMailOf builds the queued mail. The link is the parents
// portal login. A blank address gets no mail.
func GuardianCareVisibleMailOf(notice GuardianCareNotice, origin string) (GuardianCareVisibleMail, bool) {
	address := strings.TrimSpace(notice.Recipient.Email)
	if address == "" {
		return GuardianCareVisibleMail{}, false
	}
	origin = MailOrigin(origin)
	names := make([]string, 0, len(notice.ChildFirstNames))
	for _, name := range notice.ChildFirstNames {
		if name = strings.TrimSpace(name); name != "" {
			names = append(names, name)
		}
	}
	return GuardianCareVisibleMail{
		Recipient: address, FirstName: strings.TrimSpace(notice.Recipient.FirstName),
		LastName: strings.TrimSpace(notice.Recipient.LastName), ChildFirstNames: names,
		SchoolName: strings.TrimSpace(notice.SchoolName), PortalURL: origin + "/login", LogoURL: origin + motoLogoPath,
		Locale: parentLocale(notice.Locale),
	}, true
}

// careVisibleCopy is the text of the mail in one language, for one child and
// for several (…Many). %[1]s in Subject and Intro is the children's first
// names; Where: %[1]s the label of the care area in the parents portal,
// %[2]s the names. AskSchool: %[1]s the school, in the nominative. And joins
// the last two names.
type careVisibleCopy struct {
	Subject, SubjectMany, Title, Greeting, GreetingNamed, Intro, IntroMany, Where, WhereMany string
	Nothing, Ask, AskSchool, Button, LinkHint, CareArea, And                                 string
}

// careVisibleCopies holds every language of the parents portal. CareArea is
// the portal's own label of the area (parentChild.areas.care.title). A name
// stands where no case ending is needed: in Russian, Ukrainian, Polish and
// Albanian after a colon or as the subject in the nominative ("ребёнок Лина",
// "dziecko Mia"); German, English and Turkish need no case ending.
var careVisibleCopies = map[string]careVisibleCopy{
	"de": {
		Subject:       "Die Betreuung von %[1]s ist jetzt im Elternportal sichtbar",
		SubjectMany:   "Die Betreuung von %[1]s ist jetzt im Elternportal sichtbar",
		Title:         "Neu im Elternportal",
		Greeting:      "Hallo,",
		GreetingNamed: "Hallo %[1]s,",
		Intro:         "die Betreuung von %[1]s steht jetzt in moto. Du siehst sie ab sofort im Elternportal.",
		IntroMany:     "die Betreuung von %[1]s steht jetzt in moto. Du siehst sie ab sofort im Elternportal.",
		Where:         "Melde dich im Elternportal an. Wähle dein Kind und dann „%[1]s“. Dort steht, an welchen Tagen %[2]s betreut wird.",
		WhereMany:     "Melde dich im Elternportal an. Wähle ein Kind und dann „%[1]s“. Dort steht, an welchen Tagen es betreut wird.",
		Nothing:       "Du musst nichts tun. Die Betreuung läuft weiter wie bisher.",
		Ask:           "Stimmt etwas nicht? Dann wende dich an deine Schule.",
		AskSchool:     "Stimmt etwas nicht? Dann wende dich an die Schule: %[1]s.",
		Button:        "Zum Elternportal",
		LinkHint:      "Falls der Button nicht funktioniert, kopiere diesen Link:",
		CareArea:      "Betreuung & Wochenplan",
		And:           "und",
	},
	"en": {
		Subject:       "The care of %[1]s is now visible in the parents portal",
		SubjectMany:   "The care of %[1]s is now visible in the parents portal",
		Title:         "New in the parents portal",
		Greeting:      "Hello,",
		GreetingNamed: "Hello %[1]s,",
		Intro:         "the care of %[1]s is now in moto. You can see it in the parents portal from now on.",
		IntroMany:     "the care of %[1]s is now in moto. You can see it in the parents portal from now on.",
		Where:         "Sign in to the parents portal. Choose your child and then “%[1]s”. There you see on which days %[2]s is cared for.",
		WhereMany:     "Sign in to the parents portal. Choose a child and then “%[1]s”. There you see on which days the child is cared for.",
		Nothing:       "You do not need to do anything. The care continues as before.",
		Ask:           "Something is not right? Then contact your school.",
		AskSchool:     "Something is not right? Then contact the school: %[1]s.",
		Button:        "Open the parents portal",
		LinkHint:      "If the button does not work, copy this link:",
		CareArea:      "Care & weekly plan",
		And:           "and",
	},
	"ru": {
		Subject:       "Продлёнка теперь видна в родительском портале: %[1]s",
		SubjectMany:   "Продлёнка теперь видна в родительском портале: %[1]s",
		Title:         "Новое в родительском портале",
		Greeting:      "Здравствуйте!",
		GreetingNamed: "Здравствуйте, %[1]s!",
		Intro:         "Продлёнка вашего ребёнка теперь внесена в moto: %[1]s. С этого момента вы видите её в родительском портале.",
		IntroMany:     "Продлёнка ваших детей теперь внесена в moto: %[1]s. С этого момента вы видите её в родительском портале.",
		Where:         "Войдите в родительский портал. Выберите ребёнка, затем «%[1]s». Там указано, в какие дни ребёнок %[2]s находится на продлёнке.",
		WhereMany:     "Войдите в родительский портал. Выберите ребёнка, затем «%[1]s». Там указано, в какие дни ребёнок находится на продлёнке.",
		Nothing:       "Вам ничего не нужно делать. Продлёнка продолжается как прежде.",
		Ask:           "Что-то не так? Обратитесь в свою школу.",
		AskSchool:     "Что-то не так? Тогда свяжитесь со школой: %[1]s.",
		Button:        "Открыть родительский портал",
		LinkHint:      "Если кнопка не работает, скопируйте эту ссылку:",
		CareArea:      "Продлёнка и план недели",
		And:           "и",
	},
	"sq": {
		Subject:       "%[1]s: kujdesi tani shihet në portalin e prindërve",
		SubjectMany:   "%[1]s: kujdesi tani shihet në portalin e prindërve",
		Title:         "E re në portalin e prindërve",
		Greeting:      "Përshëndetje,",
		GreetingNamed: "Përshëndetje %[1]s,",
		Intro:         "kujdesi për fëmijën tuaj tani është në moto: %[1]s. Që tani e shihni në portalin e prindërve.",
		IntroMany:     "kujdesi për fëmijët tuaj tani është në moto: %[1]s. Që tani e shihni në portalin e prindërve.",
		Where:         "Hyni në portalin e prindërve. Zgjidhni fëmijën tuaj dhe pastaj „%[1]s“. Aty shihni në cilat ditë kujdesemi për fëmijën: %[2]s.",
		WhereMany:     "Hyni në portalin e prindërve. Zgjidhni një fëmijë dhe pastaj „%[1]s“. Aty shihni në cilat ditë kujdesemi për të.",
		Nothing:       "Nuk keni nevojë të bëni asgjë. Kujdesi vazhdon si më parë.",
		Ask:           "Diçka nuk shkon? Atëherë drejtohuni shkollës suaj.",
		AskSchool:     "Diçka nuk shkon? Atëherë drejtohuni shkollës: %[1]s.",
		Button:        "Hap portalin e prindërve",
		LinkHint:      "Nëse butoni nuk funksionon, kopjoni këtë lidhje:",
		CareArea:      "Kujdesi dhe plani javor",
		And:           "dhe",
	},
	"pl": {
		Subject:       "%[1]s: opieka jest teraz widoczna w portalu dla rodziców",
		SubjectMany:   "%[1]s: opieka jest teraz widoczna w portalu dla rodziców",
		Title:         "Nowość w portalu dla rodziców",
		Greeting:      "Dzień dobry,",
		GreetingNamed: "Dzień dobry %[1]s,",
		Intro:         "opieka nad Państwa dzieckiem jest teraz zapisana w moto: %[1]s. Od teraz widzą ją Państwo w portalu dla rodziców.",
		IntroMany:     "opieka nad Państwa dziećmi jest teraz zapisana w moto: %[1]s. Od teraz widzą ją Państwo w portalu dla rodziców.",
		Where:         "Proszę zalogować się do portalu dla rodziców i wybrać dziecko, a potem „%[1]s”. Tam widać, w które dni dziecko %[2]s jest pod opieką.",
		WhereMany:     "Proszę zalogować się do portalu dla rodziców i wybrać dziecko, a potem „%[1]s”. Tam widać, w które dni dziecko jest pod opieką.",
		Nothing:       "Nie muszą Państwo nic robić. Opieka trwa tak jak dotąd.",
		Ask:           "Coś się nie zgadza? Proszę skontaktować się ze szkołą.",
		AskSchool:     "Coś się nie zgadza? Proszę skontaktować się ze szkołą: %[1]s.",
		Button:        "Otwórz portal dla rodziców",
		LinkHint:      "Jeśli przycisk nie działa, proszę skopiować ten link:",
		CareArea:      "Opieka i plan tygodnia",
		And:           "i",
	},
	"tr": {
		Subject:       "%[1]s için bakım artık veli portalında görünüyor",
		SubjectMany:   "%[1]s için bakım artık veli portalında görünüyor",
		Title:         "Veli portalında yeni",
		Greeting:      "Merhaba,",
		GreetingNamed: "Merhaba %[1]s,",
		Intro:         "%[1]s için bakım artık moto'da kayıtlı. Bundan sonra veli portalında görebilirsiniz.",
		IntroMany:     "%[1]s için bakım artık moto'da kayıtlı. Bundan sonra veli portalında görebilirsiniz.",
		Where:         "Veli portalına giriş yapın. Çocuğunuzu ve ardından “%[1]s” seçin. Orada %[2]s için hangi günlerde bakım olduğunu görürsünüz.",
		WhereMany:     "Veli portalına giriş yapın. Bir çocuğunuzu ve ardından “%[1]s” seçin. Orada hangi günlerde bakım olduğunu görürsünüz.",
		Nothing:       "Bir şey yapmanız gerekmiyor. Bakım eskisi gibi devam ediyor.",
		Ask:           "Bir sorun mu var? O zaman okulunuza başvurun.",
		AskSchool:     "Bir sorun mu var? O zaman okula başvurun: %[1]s.",
		Button:        "Veli portalını açın",
		LinkHint:      "Düğme çalışmazsa bu bağlantıyı kopyalayın:",
		CareArea:      "Bakım ve haftalık plan",
		And:           "ve",
	},
	"uk": {
		Subject:       "Догляд тепер видно в батьківському порталі: %[1]s",
		SubjectMany:   "Догляд тепер видно в батьківському порталі: %[1]s",
		Title:         "Нове в батьківському порталі",
		Greeting:      "Вітаємо!",
		GreetingNamed: "Вітаємо, %[1]s!",
		Intro:         "Догляд за вашою дитиною тепер внесено в moto: %[1]s. Відтепер ви бачите його в батьківському порталі.",
		IntroMany:     "Догляд за вашими дітьми тепер внесено в moto: %[1]s. Відтепер ви бачите його в батьківському порталі.",
		Where:         "Увійдіть у батьківський портал. Виберіть дитину, а потім «%[1]s». Там вказано, у які дні дитина %[2]s перебуває під доглядом.",
		WhereMany:     "Увійдіть у батьківський портал. Виберіть дитину, а потім «%[1]s». Там вказано, у які дні дитина перебуває під доглядом.",
		Nothing:       "Вам нічого не потрібно робити. Догляд триває, як і раніше.",
		Ask:           "Щось не так? Зверніться до своєї школи.",
		AskSchool:     "Щось не так? Тоді зв’яжіться зі школою: %[1]s.",
		Button:        "Відкрити батьківський портал",
		LinkHint:      "Якщо кнопка не працює, скопіюйте це посилання:",
		CareArea:      "Догляд і план на тиждень",
		And:           "і",
	},
}

var (
	errCareVisibleRecipient = errors.New("guardian care visible payload missing recipient_email")
	errCareVisibleChild     = errors.New("guardian care visible payload missing child_first_names")
	errCareVisiblePortalURL = errors.New("guardian care visible payload missing portal_url")
)

// joinNames lists the names with commas and the language's "and" before
// the last: "Lina", "Lina und Ben", "Lina, Ben und Ida".
func joinNames(names []string, and string) string {
	if len(names) < 2 {
		return strings.Join(names, "")
	}
	return strings.Join(names[:len(names)-1], ", ") + " " + and + " " + names[len(names)-1]
}

// GuardianCareVisibleMailContent renders a queued mail in the guardian's
// language.
func GuardianCareVisibleMailContent(mail GuardianCareVisibleMail) (Mail, error) {
	switch {
	case mail.Recipient == "":
		return Mail{}, errCareVisibleRecipient
	case len(mail.ChildFirstNames) == 0:
		return Mail{}, errCareVisibleChild
	case mail.PortalURL == "":
		return Mail{}, errCareVisiblePortalURL
	}
	lang := parentLocale(mail.Locale)
	text, ok := careVisibleCopies[lang]
	if !ok {
		lang, text = "de", careVisibleCopies["de"]
	}
	greeting := text.Greeting
	if name := strings.TrimSpace(mail.FirstName + " " + mail.LastName); name != "" {
		greeting = fmt.Sprintf(text.GreetingNamed, name)
	}
	ask := text.Ask
	if mail.SchoolName != "" {
		ask = fmt.Sprintf(text.AskSchool, mail.SchoolName)
	}
	names := joinNames(mail.ChildFirstNames, text.And)
	subject, intro, where := text.Subject, text.Intro, fmt.Sprintf(text.Where, text.CareArea, names)
	if len(mail.ChildFirstNames) > 1 {
		subject, intro, where = text.SubjectMany, text.IntroMany, fmt.Sprintf(text.WhereMany, text.CareArea)
	}
	return Mail{
		Subject:  fmt.Sprintf(subject, names),
		Template: "guardian-care-visible.html",
		Content: withFooter(lang, map[string]any{
			"Lang":      lang,
			"LogoURL":   mail.LogoURL,
			"PortalURL": mail.PortalURL,
			"Title":     text.Title,
			"Greeting":  greeting,
			"Intro":     fmt.Sprintf(intro, names),
			"Where":     where,
			"Nothing":   text.Nothing,
			"Ask":       ask,
			"Button":    text.Button,
			"LinkHint":  text.LinkHint,
		}),
	}, nil
}
