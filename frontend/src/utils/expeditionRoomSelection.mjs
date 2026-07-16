function isVisibleRoom(room) {
  return room && !['hidden', 'locked'].includes(room.state);
}

function isActionableRoom(room) {
  return room?.state === 'unlocked' && !room.clearedAt && !room.bossDefeated;
}

export function preferredExpeditionRoomKey(rooms = [], selectedRoomKey = null, pinnedRoomKey = null) {
  if (pinnedRoomKey) {
    const pinnedRoom = rooms.find(room => room.key === pinnedRoomKey);
    if (isActionableRoom(pinnedRoom)) return pinnedRoom.key;
  }

  const selected = rooms.find(room => room.key === selectedRoomKey);
  if (selected && isActionableRoom(selected)) return selected.key;

  const open = rooms.find(room => isActionableRoom(room));
  if (open) return open.key;
  if (selected && isVisibleRoom(selected)) return selected.key;

  return rooms.find(room => room.state === 'cleared')?.key
    || rooms.find(room => isVisibleRoom(room))?.key
    || null;
}
