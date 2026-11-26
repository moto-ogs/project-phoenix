import type {
  ContextNavigationGroup,
  ContextSession,
  NavigationContext,
} from "~/lib/contract/active.generated";

export interface SupervisedRoom {
  id: string;
  name: string;
  groupId: string;
  groupName?: string;
  /**
   * True for a permanently released room ("offener Raum", #3065). Such a room
   * is shared: reachable by every caregiver, empty or not, and seeing it grants
   * no supervision and no booking right. The flag exists so the UI can keep
   * shared rooms visibly apart from the caller's own supervisions.
   */
  isOpenRoom?: boolean;
  /**
   * The caller supervises this session, or a session in this released room.
   * Only then does the navigation list a released room under „Aktuelle
   * Aufsicht“ (#4349); every other released room is reached through „Räume“
   * (#4372). With the school-wide overview, session entries without the flag
   * are foreign sessions; they stand after the own ones (#5035).
   */
  isOwnSupervision?: boolean;
  /** Active sessions in this released room, used to mark a `?session=` link. */
  sessionIds?: readonly string[];
}

export interface DerivedSupervision {
  isSupervising: boolean;
  ownSupervision: boolean;
  supervisedRoomId?: string;
  supervisedRoomName?: string;
  supervisedRooms: SupervisedRoom[];
  ownSupervisedRooms: SupervisedRoom[];
  ownSessions: ContextSession[];
  ownSessionRoomNames: string[];
  overviewEnabled: boolean;
  groups: ContextNavigationGroup[];
  ownGroupIds: string[];
  ownGroupRoomNames: string[];
}

export function isCompleteSupervisionSeed(answer: NavigationContext): boolean {
  return (
    answer.groups !== undefined &&
    answer.groups.status !== "unavailable" &&
    answer.released_rooms !== undefined &&
    answer.released_rooms.status !== "unavailable" &&
    answer.sessions !== undefined &&
    answer.sessions.status !== "unavailable" &&
    answer.sessions.overview_status !== "unavailable" &&
    answer.sessions.own_status !== "unavailable"
  );
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "de");
}

/**
 * The room id or one of its legacy session ids names a released room in which
 * the caller runs no supervision of their own. The navigation files such a
 * room under „Räume“, not under „Aktuelle Aufsicht“ (#4372).
 */
export function isSharedOpenRoom(
  rooms: readonly SupervisedRoom[],
  selection: Readonly<{
    roomId: string | null;
    sessionId: string | null;
  }>,
): boolean {
  const { roomId, sessionId } = selection;
  if (sessionId) {
    const selectedSession = rooms.find((room) =>
      room.isOpenRoom
        ? room.sessionIds?.includes(sessionId)
        : room.groupId === sessionId,
    );
    if (selectedSession) {
      return (
        selectedSession.isOpenRoom === true && !selectedSession.isOwnSupervision
      );
    }
  }
  return (
    roomId !== null &&
    rooms.some(
      (room) => room.isOpenRoom && !room.isOwnSupervision && room.id === roomId,
    )
  );
}

export function deriveSupervision(
  answer?: NavigationContext,
): DerivedSupervision {
  const groupSection =
    answer?.groups?.status === "ok" ? answer.groups : undefined;
  const sessionSection =
    answer?.sessions?.status === "ok" ? answer.sessions : undefined;
  const ownSessions =
    sessionSection?.own_status === "ok"
      ? (sessionSection.items ?? []).filter(
          (session) => session.is_own === true,
        )
      : [];
  const overviewEnabled = sessionSection?.overview_status === "ok";
  const sessions = overviewEnabled ? (sessionSection.items ?? []) : ownSessions;
  const ownSessionIds = new Set(ownSessions.map((session) => session.id));
  const ownRoomIds = new Set(ownSessions.map((session) => session.room_id));
  const sessionsByRoom = new Map<string, string[]>();
  for (const session of sessions) {
    const ids = sessionsByRoom.get(session.room_id) ?? [];
    ids.push(session.id);
    sessionsByRoom.set(session.room_id, ids);
  }

  const released =
    answer?.released_rooms?.status === "ok"
      ? answer.released_rooms.items
      : null;
  const releasedIds = new Set(released?.map((room) => room.id));
  const sharedRooms: SupervisedRoom[] = (released ?? [])
    .map((room) => ({
      id: room.id,
      name: room.name,
      groupId: "",
      isOpenRoom: true,
      isOwnSupervision: ownRoomIds.has(room.id),
      sessionIds: sessionsByRoom.get(room.id),
    }))
    .sort(byName);

  const rooms: SupervisedRoom[] = sessions
    .filter((session) => !releasedIds.has(session.room_id))
    .map((session) => ({
      id: session.room_id,
      name:
        (sessionsByRoom.get(session.room_id)?.length ?? 0) > 1
          ? `${session.activity_name} · ${session.room_name}`
          : session.room_name,
      groupId: session.id,
      groupName: session.activity_name,
      isOwnSupervision: ownSessionIds.has(session.id),
    }))
    .sort(
      (a, b) =>
        Number(b.isOwnSupervision) - Number(a.isOwnSupervision) || byName(a, b),
    );

  const personalRooms = new Map<string, SupervisedRoom>();
  for (const session of ownSessions) {
    if (personalRooms.has(session.room_id)) continue;
    personalRooms.set(session.room_id, {
      id: session.room_id,
      name: session.room_name,
      groupId: session.id,
      groupName: session.activity_name,
    });
  }

  const primary = ownSessions[0] ?? sessions[0];
  return {
    groups: [...(groupSection?.navigation ?? [])].sort(byName),
    ownGroupIds: groupSection?.own_group_ids ?? [],
    ownGroupRoomNames: groupSection?.own_room_names ?? [],
    isSupervising: sessions.length > 0,
    ownSupervision: ownSessions.length > 0,
    supervisedRoomId: primary?.room_id,
    supervisedRoomName: primary?.room_name,
    supervisedRooms: [...rooms, ...sharedRooms],
    ownSupervisedRooms: [...personalRooms.values()].sort(byName),
    ownSessions,
    ownSessionRoomNames: [...personalRooms.values()].map((room) => room.name),
    overviewEnabled,
  };
}
