"use strict";
const roles = ["driver", "guard", "mechanic"];
function deliveryTasks(m, members, member) {
  if (!m.delivery_version)
    return Array.from({ length: m.round_count }, (_, i) =>
      members.length === 1 && m.round_count === 3 ? roles[i] : member.role,
    );
  if (members.length === 1) return roles;
  const tasks = [member.role];
  if (members.length === 2 && member.user_id === m.owner_id)
    tasks.push(roles.find((role) => !members.some((p) => p.role === role)));
  return tasks;
}
module.exports = { deliveryTasks };
