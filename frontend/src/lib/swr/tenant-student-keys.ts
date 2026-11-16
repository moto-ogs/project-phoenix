/**
 * OGS-Portal, Kinder: Akten-Unterseiten, Listen, Importe, Gruppen- und Raumseiten.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
export const tenantStudentKeys = {
  /** The open care withdrawal of one child (`fetchStudentCareWithdrawal`). */
  careWithdrawal: (studentId: string) =>
    `student-care-withdrawal-${encodeURIComponent(studentId)}`,
  /** One child's feedback entries (`fetchStudentFeedback`). */
  feedback: (studentId: string) =>
    `student-feedback-${encodeURIComponent(studentId)}`,
  /** One child's attendance protocol (`fetchStudentAttendanceHistory`). */
  attendanceHistory: (studentId: string) =>
    `student-attendance-history-${encodeURIComponent(studentId)}`,
  /** The day evaluation of one Berlin day (`fetchDayLog`). */
  dayLog: (date: string) => `day-log-${date}`,
} as const;
