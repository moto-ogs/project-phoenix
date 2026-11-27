#!/usr/bin/env bash
# Interactive checklist for preparing the daily backup.

set -euo pipefail

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; YELLOW=""; RED=""
fi

TOTAL_STAGES=5
_STAGE_INDEX=0

# _clear — wipe the terminal so only the current step is on screen. No-op when
# output isn't a terminal, so piped logs stay readable.
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

# banner "Title" — opening frame: what this wizard does.
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  Diese Checkliste erklärt die Einrichtung durch einen Menschen.\n' "$DIM"
  printf '  Sie erfasst und speichert keine Werte und führt keine Einrichtung aus.\n'
  printf '  Abbruch jederzeit mit Ctrl-C.%s\n' "$RESET"
  pause "Ready to start?"
}

# stage "Name" — clear the screen, then announce a stage and show progress.
# Clearing keeps only the current step on screen.
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

# say "..." — a plain instruction line.
say()  { printf '  %s\n' "$1"; }
# step "..." — a numbered-feeling action the human takes in the browser.
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

# pause "msg" — wait for the human to confirm they've done the manual part.
pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

[[ -t 0 ]] || { echo 'Einrichtung nur interaktiv durch einen Menschen; siehe docs/operations/daily-backup.md'; exit 1; }
banner "moto: Tagessicherung vorbereiten"
stage "Offline-Schlüssel"
step "Auf getrenntem Rechner: umask 077; age-keygen -o /geschuetzter/offline-pfad/backup-identity"
step "Nur öffentlichen Empfänger mit age-keygen -y ermitteln und übertragen. Private Identität doppelt offline verwahren."
warn "${RED}Private Identität niemals auf Quellhost oder Backupziel ablegen.${RESET}"
note "Keine Werte hier eingeben. Es wird nichts gespeichert oder übertragen."
pause "Verwahrung und Wiederbeschaffung geprüft? Enter."
stage "Getrennter deutscher Standort"
step "Beim gewählten S3-Anbieter getrennten deutschen Rechenzentrumsstandort und eigenes Backup-Präfix bestätigen."
step "Getrennte Zugänge und unveränderbare Generationen einrichten; endgültige Löschung inklusive Versionen auf maximal 90 Tage begrenzen."
note "Anbieteroberfläche ist nicht vorgegeben. Keine Menüpfade geraten; Anbieter-Dokumentation verwenden."
pause "Standort, Rechte und Lifecycle im geschützten Betriebsnachweis erfasst? Enter."
stage "SOPS und Werkzeuge"
step "docs/operations/daily-backup.env.example je Umgebung (production, staging) in ein eigenes Betreiber-SOPS-Dokument außerhalb des Repos übernehmen."
step "Alle Leerwerte aus tatsächlichen Compose-/Volume- und Anbieterangaben füllen. Keine environments/*.sops.env ändern."
step "Mensch materialisiert /etc/moto-backup/production.env und staging.env mit SOPS, root 0600. Kein privater Backup-Schlüssel darin."
step "BACKUP_WORK_DIR=/run/moto-backup-<instanz>, BACKUP_CIPHER_DIR=/var/lib/moto-backup-cipher-<instanz>; keine Instanz nutzt Pfade, Ziel-Präfix oder Volume einer anderen."
step "Bash, Docker/Compose, Python 3.11+, age, rclone, findmnt und PATH prüfen; Klartextpfad auf tmpfs ohne Klartext-Swap; separater Chiffratpfad auf Disk."
step "Kapazität nach Runbook messen und BACKUP_MIN_FREE_BYTES mit Wachstumsreserve setzen; tmpfs/RAM passend bereitstellen."
step "Upload-Ablage: bei lokaler Ablage BACKUP_UPLOADS_VOLUME setzen. Bei UPLOADS_BACKEND=s3 liest die Sicherung den Bucket aus der Compose-.env; dann keine UPLOADS_*-Werte in /etc/moto-backup/<instanz>.env."
pause "Pflichtwerte, Platzreservierung, Werkzeuge und tatsächliche Upload-Ablage geprüft? Enter."
stage "Erster Lauf und isolierter Restore"
step "daily-backup.sh und daily_backup.py nach /usr/local/lib/moto-backup installieren; die drei Vorlagen-Units und moto-daily-backup@staging.timer.d/ aus scripts/systemd nach /etc/systemd/system kopieren."
step "Je Instanz: systemd-analyze verify moto-daily-backup@production.service moto-daily-backup@production.timer; systemctl daemon-reload; systemctl start moto-daily-backup@production.service (staging entsprechend)"
step "Nach Runbook auf GETRENNTER Maschine mit daily-restore.compose.yml wiederherstellen, nie parallel auf dem Produktionshost. Löschungen seit Sicherungszeitpunkt vor jedem App-Start erneut umsetzen."
warn "OnFailure schreibt ins Journal. Alloy-Anbindung und Alarmzustellung nach docs/operations/daily-backup.md einrichten und nachweisen."
pause "Wiederherstellung, Dateiabgleich, RLS und Löschprüfung nachgewiesen? Enter."
stage "Timer und Nachweis"
step "Erst nach erfolgreicher Wiederherstellung: systemctl enable --now moto-daily-backup@production.timer moto-daily-backup@staging.timer"
step "Mit systemctl list-timers 'moto-daily-backup@*' den nächsten Lauf beider Instanzen prüfen."
step "Tägliche menschliche Ergebnisprüfung bis zur nachgewiesenen Alarmzustellung benennen; Nachweis unter backup-restore/YYYY-MM-DD/ geschützt ablegen."
step "Anbieter, Standort und Zusagen mit AVV/TOM abgleichen. Keine Secrets oder Personendaten in Nachweistexte."
say "Checkliste beendet. Dieses Skript hat weder installiert noch aktiviert; Produktivnachweise bleiben beim Menschen."
