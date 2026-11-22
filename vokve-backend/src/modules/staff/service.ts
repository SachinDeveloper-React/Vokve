import { z } from 'zod';
import { ApiError, Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { StaffPrincipal } from '../../middleware/context.js';
import { hashPassword, listSessions, revokeSessions, temporaryPassword } from './auth.service.js';
import { StaffModel, type StaffDoc } from './models.js';
import {
  AGENT_GRANTABLE, ALL_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_PRESETS, effectivePermissions, isPermission,
  permissionLabel, type Permission, type StaffRole,
} from './permissions.js';

/**
 * Managing the people who run VOKVE (RULES Z9).
 *
 * The hierarchy, as rules this file enforces whatever the panel shows:
 *
 * - **Admins** (and the break-glass key) see and manage everybody: create
 *   admins, managers and agents, move an agent to another manager, change
 *   anybody's role.
 * - **Managers** see themselves and their own agents, and — with
 *   `staff.manage` — create agents under themselves and manage only those.
 *   They can give an agent only what they hold themselves.
 * - **Agents** manage nobody.
 * - Nobody suspends, deletes or demotes themselves, and the last active
 *   admin cannot be removed — there would be nobody left to undo it.
 */

type Who = StaffPrincipal;
const isTop = (who: Who) => who.kind === 'root' || who.role === 'admin';

const ref = (who: Who) => ({ id: who.id, role: who.role, name: who.name, email: who.email });

async function load(id: string): Promise<StaffDoc> {
  const staff = (await StaffModel.findById(id).lean()) as StaffDoc | null;
  if (!staff || staff.status === 'deleted') throw Errors.notFound('That staff account');
  return staff;
}

/** Whether `who` may read `target` — themselves, their own agents, or anyone for an admin. */
function canSee(who: Who, target: StaffDoc): boolean {
  if (isTop(who)) return true;
  if (target._id === who.id) return true;
  return who.role === 'manager' && target.role === 'agent' && target.managerId === who.id;
}

/** Whether `who` may change `target`. Never themselves through this door. */
function assertCanManage(who: Who, target: StaffDoc): void {
  if (target._id === who.id) {
    throw Errors.forbidden('NOT_ON_YOURSELF', 'You cannot do that to your own account. Use My account, or ask somebody above you.');
  }
  if (isTop(who)) return;
  if (who.role === 'manager' && target.role === 'agent' && target.managerId === who.id) return;
  throw Errors.forbidden('NOT_YOUR_TEAM', who.role === 'manager' ? 'You can only manage the agents under you.' : 'Only an admin can do that.');
}

function assertTop(who: Who, what: string): void {
  if (!isTop(who)) throw Errors.forbidden('ADMIN_ONLY', `Only an admin can ${what}.`);
}

async function assertNotLastAdmin(target: StaffDoc): Promise<void> {
  if (target.role !== 'admin' || target.status !== 'active') return;
  const others = await StaffModel.countDocuments({ role: 'admin', status: 'active', _id: { $ne: target._id } });
  if (others === 0) {
    throw Errors.conflict('LAST_ADMIN', 'This is the last active admin. Make somebody else an admin first, so there is still somebody who can undo this.');
  }
}

/** The manager whose permissions bound an agent's. */
async function activeManager(id: string | null | undefined): Promise<StaffDoc> {
  if (!id) throw Errors.validation({ managerId: 'An agent needs a manager.' });
  const manager = (await StaffModel.findById(id).lean()) as StaffDoc | null;
  if (!manager || manager.role !== 'manager' || manager.status !== 'active') {
    throw Errors.validation({ managerId: 'That is not an active manager.' });
  }
  return manager;
}

/**
 * The permissions a grant may hold. For a manager: anything in the
 * catalogue. For an agent: what an agent can hold at all, and only what
 * their manager holds right now — and, when a manager is the one granting,
 * only what that manager holds (the same set: it is their own agent).
 */
function checkGrant(role: StaffRole, requested: string[], manager: StaffDoc | null): Permission[] {
  const unknown = requested.filter(p => !isPermission(p));
  if (unknown.length) throw Errors.validation({ permissions: `Not permissions: ${unknown.join(', ')}.` });
  const unique = [...new Set(requested)] as Permission[];
  if (role === 'admin') return [];
  if (role === 'manager') return unique;

  const notForAgents = unique.filter(p => !AGENT_GRANTABLE.includes(p));
  if (notForAgents.length) {
    throw Errors.validation({ permissions: `Agents cannot hold: ${notForAgents.map(permissionLabel).join('; ')}.` });
  }
  const above = effectivePermissions({ role: 'manager', permissions: manager?.permissions ?? [] });
  const beyond = unique.filter(p => !above.has(p));
  if (beyond.length) {
    throw Errors.validation({
      permissions: `${manager?.name ?? 'The manager'} does not have these, so their agent cannot: ${beyond.map(permissionLabel).join('; ')}.`,
    });
  }
  return unique;
}

export function view(staff: StaffDoc, manager: StaffDoc | null, extra: { agents?: number } = {}) {
  const effective = effectivePermissions(
    { role: staff.role as StaffRole, permissions: staff.permissions },
    manager ? { role: manager.role as StaffRole, permissions: manager.permissions } : null,
  );
  return {
    id: staff._id,
    email: staff.status === 'deleted' ? (staff.formerEmail ?? staff.email) : staff.email,
    name: staff.name,
    role: staff.role,
    status: staff.status,
    manager: manager ? { id: manager._id, name: manager.name, email: manager.email, status: manager.status } : null,
    /** Blocked by the hierarchy rather than by their own row. */
    blockedByManager: staff.role === 'agent' && (!manager || manager.status !== 'active'),
    permissions: staff.role === 'admin' ? ALL_PERMISSIONS : staff.permissions,
    effectivePermissions: [...effective],
    /** Granted but not working, because the manager no longer has them. */
    dormantPermissions: staff.role === 'agent' ? staff.permissions.filter(p => !effective.has(p as Permission)) : [],
    mustChangePassword: staff.mustChangePassword,
    totpEnabled: Boolean(staff.totp?.enabledAt),
    lockedUntil: staff.lockedUntil && staff.lockedUntil > new Date() ? staff.lockedUntil.toISOString() : null,
    lastLoginAt: staff.lastLoginAt?.toISOString() ?? null,
    lastActiveAt: staff.lastActiveAt?.toISOString() ?? null,
    createdAt: staff.createdAt?.toISOString() ?? null,
    createdBy: staff.createdBy ?? null,
    suspendedAt: staff.suspendedAt?.toISOString() ?? null,
    suspendedBy: staff.suspendedBy ?? null,
    suspendReason: staff.suspendReason ?? null,
    agents: extra.agents ?? null,
  };
}

async function managerOf(staff: StaffDoc): Promise<StaffDoc | null> {
  return staff.managerId ? ((await StaffModel.findById(staff.managerId).lean()) as StaffDoc | null) : null;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** The catalogue the permission picker draws, and the presets beside it. */
export function catalogue() {
  return {
    groups: PERMISSION_GROUPS.map(group => ({
      key: group.key,
      label: group.label,
      permissions: group.permissions.map(p => ({ key: p.key, label: p.label, agentGrantable: AGENT_GRANTABLE.includes(p.key) })),
    })),
    presets: PERMISSION_PRESETS,
  };
}

export async function me(who: Who) {
  if (who.kind === 'root') {
    return {
      kind: 'root' as const,
      id: who.id,
      name: who.name,
      email: null,
      role: 'root' as const,
      manager: null,
      permissions: ALL_PERMISSIONS,
      effectivePermissions: ALL_PERMISSIONS,
      setup: { changePassword: false, enrollTotp: false },
      totpEnabled: false,
    };
  }
  const staff = await load(who.id);
  const manager = await managerOf(staff);
  return {
    kind: 'staff' as const,
    ...view(staff, manager),
    effectivePermissions: [...who.permissions],
    setup: { changePassword: Boolean(staff.mustChangePassword), enrollTotp: !staff.totp?.enabledAt },
  };
}

export const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.enum(['admin', 'manager', 'agent']).optional(),
  status: z.enum(['active', 'suspended', 'any']).default('any'),
  managerId: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export async function list(who: Who, query: z.infer<typeof listQuery>) {
  const filter: Record<string, unknown> = { status: query.status === 'any' ? { $ne: 'deleted' } : query.status };
  if (!isTop(who)) {
    // A manager's world is themselves and their agents; an agent's, nobody.
    if (who.role !== 'manager') throw Errors.forbidden('NOT_YOUR_TEAM', 'You have no team to list.');
    filter.$or = [{ _id: who.id }, { role: 'agent', managerId: who.id }];
  }
  if (query.role) filter.role = query.role;
  if (query.managerId) filter.managerId = query.managerId;
  if (query.q) {
    const like = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$and = [{ $or: [{ name: like }, { email: like }] }];
  }

  const [rows, total] = await Promise.all([
    StaffModel.find(filter).sort({ role: 1, name: 1 }).skip(query.offset).limit(query.limit).lean() as Promise<StaffDoc[]>,
    StaffModel.countDocuments(filter),
  ]);
  const managerIds = [...new Set(rows.map(r => r.managerId).filter((id): id is string => Boolean(id)))];
  const managers = new Map(((await StaffModel.find({ _id: { $in: managerIds } }).lean()) as StaffDoc[]).map(m => [m._id, m]));
  const agentCounts = new Map(
    (await StaffModel.aggregate<{ _id: string; n: number }>([
      { $match: { role: 'agent', status: { $ne: 'deleted' }, managerId: { $in: rows.filter(r => r.role === 'manager').map(r => r._id) } } },
      { $group: { _id: '$managerId', n: { $sum: 1 } } },
    ])).map(row => [row._id, row.n]),
  );
  const summary = isTop(who)
    ? Object.fromEntries(
        (await StaffModel.aggregate<{ _id: { role: string; status: string }; n: number }>([
          { $match: { status: { $ne: 'deleted' } } },
          { $group: { _id: { role: '$role', status: '$status' }, n: { $sum: 1 } } },
        ])).map(row => [`${row._id.role}.${row._id.status}`, row.n]),
      )
    : null;

  return {
    data: rows.map(row => view(row, row.managerId ? (managers.get(row.managerId) ?? null) : null, { agents: agentCounts.get(row._id) ?? (row.role === 'manager' ? 0 : undefined) })),
    total,
    limit: query.limit,
    offset: query.offset,
    summary,
  };
}

export async function get(who: Who, id: string) {
  const staff = await load(id);
  if (!canSee(who, staff)) throw Errors.notFound('That staff account');
  const [manager, agents] = await Promise.all([
    managerOf(staff),
    staff.role === 'manager' ? (StaffModel.find({ role: 'agent', managerId: staff._id, status: { $ne: 'deleted' } }).sort({ name: 1 }).lean() as Promise<StaffDoc[]>) : Promise.resolve([]),
  ]);
  return {
    ...view(staff, manager, { agents: staff.role === 'manager' ? agents.length : undefined }),
    team: agents.map(agent => view(agent, staff)),
    /** What the caller may do to this person — the panel draws its buttons from it. */
    can: {
      manage: target(who, staff),
      reassign: isTop(who) && staff.role === 'agent' && staff._id !== who.id,
      changeRole: isTop(who) && staff._id !== who.id,
    },
  };
}

function target(who: Who, staff: StaffDoc): boolean {
  try {
    assertCanManage(who, staff);
    return true;
  } catch {
    return false;
  }
}

export async function sessionsOf(who: Who, id: string) {
  const staff = await load(id);
  if (!canSee(who, staff)) throw Errors.notFound('That staff account');
  return { data: await listSessions(staff._id) };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export const createBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(['admin', 'manager', 'agent']),
    managerId: z.string().max(80).nullable().optional(),
    permissions: z.array(z.string().max(60)).max(ALL_PERMISSIONS.length).default([]),
  })
  .strict();

export async function create(who: Who, body: z.infer<typeof createBody>) {
  let manager: StaffDoc | null = null;
  if (body.role === 'admin' || body.role === 'manager') {
    assertTop(who, `create ${body.role === 'admin' ? 'an admin' : 'a manager'}`);
  } else if (isTop(who)) {
    manager = await activeManager(body.managerId);
  } else if (who.role === 'manager') {
    // A manager's agents are their own: whatever the body says.
    if (body.managerId && body.managerId !== who.id) throw Errors.forbidden('NOT_YOUR_TEAM', 'You can only add agents to your own team.');
    manager = await activeManager(who.id);
  } else {
    throw Errors.forbidden('NOT_YOUR_TEAM', 'Agents cannot create accounts.');
  }

  const permissions = checkGrant(body.role, body.permissions, manager);
  if (await StaffModel.exists({ email: body.email })) {
    throw Errors.validation({ email: 'A staff account already uses that email.' });
  }
  const password = temporaryPassword();
  const created = await StaffModel.create({
    _id: newId('stf'),
    email: body.email,
    name: body.name,
    role: body.role,
    managerId: body.role === 'agent' ? manager!._id : null,
    permissions,
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    createdBy: ref(who),
  });
  const doc = created.toObject() as unknown as StaffDoc;
  return {
    staff: view(doc, manager),
    /** Shown once, to the person who created the account, to hand over. Never stored in the clear. */
    temporaryPassword: password,
  };
}

export const updateBody = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    permissions: z.array(z.string().max(60)).max(ALL_PERMISSIONS.length).optional(),
  })
  .strict()
  .refine(body => body.name !== undefined || body.permissions !== undefined, 'Change something');

export async function update(who: Who, id: string, body: z.infer<typeof updateBody>) {
  const staff = await load(id);
  assertCanManage(who, staff);
  const set: Record<string, unknown> = {};
  if (body.name !== undefined) set.name = body.name;
  let removedFromAgents = 0;
  if (body.permissions !== undefined) {
    if (staff.role === 'admin') throw Errors.validation({ permissions: 'An admin holds every permission; there is nothing to choose.' });
    const manager = staff.role === 'agent' ? await activeManager(staff.managerId) : null;
    set.permissions = checkGrant(staff.role as StaffRole, body.permissions, manager);
    if (staff.role === 'manager') {
      // What the manager no longer holds, their agents no longer hold either —
      // trimmed on the record too, so a grant given back later is a decision
      // made again rather than a dormant one waking up.
      const kept = new Set(set.permissions as string[]);
      const agents = (await StaffModel.find({ role: 'agent', managerId: staff._id }).lean()) as StaffDoc[];
      for (const agent of agents) {
        const trimmed = agent.permissions.filter(p => kept.has(p));
        if (trimmed.length !== agent.permissions.length) {
          await StaffModel.updateOne({ _id: agent._id }, { $set: { permissions: trimmed } });
          removedFromAgents += 1;
        }
      }
    }
  }
  await StaffModel.updateOne({ _id: staff._id }, { $set: set });
  return { ...(await get(who, id)), agentsTrimmed: removedFromAgents };
}

export const suspendBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

export async function suspend(who: Who, id: string, reason: string) {
  const staff = await load(id);
  assertCanManage(who, staff);
  if (staff.status === 'suspended') throw Errors.conflict('ALREADY_SUSPENDED', 'That account is already suspended.');
  await assertNotLastAdmin(staff);
  await StaffModel.updateOne({ _id: staff._id }, { $set: { status: 'suspended', suspendedAt: new Date(), suspendedBy: ref(who), suspendReason: reason } });
  let signedOut = await revokeSessions(staff._id, 'suspended');
  // A manager's agents stop with them (owner's call): signed out now, and
  // refused at sign-in until an admin moves them or the manager is back.
  let agentsBlocked = 0;
  if (staff.role === 'manager') {
    const agents = (await StaffModel.find({ role: 'agent', managerId: staff._id, status: 'active' }, { _id: 1 }).lean()) as StaffDoc[];
    agentsBlocked = agents.length;
    for (const agent of agents) signedOut += await revokeSessions(agent._id, 'manager_suspended');
  }
  return { ok: true, sessionsEnded: signedOut, agentsBlocked };
}

export async function reactivate(who: Who, id: string) {
  const staff = await load(id);
  assertCanManage(who, staff);
  if (staff.status === 'active') throw Errors.conflict('ALREADY_ACTIVE', 'That account is already active.');
  await StaffModel.updateOne(
    { _id: staff._id },
    { $set: { status: 'active', suspendedAt: null, suspendedBy: null, suspendReason: null, failedLogins: 0, lockedUntil: null } },
  );
  return get(who, id);
}

export async function resetPassword(who: Who, id: string) {
  const staff = await load(id);
  assertCanManage(who, staff);
  const password = temporaryPassword();
  await StaffModel.updateOne(
    { _id: staff._id },
    { $set: { passwordHash: await hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null } },
  );
  const sessionsEnded = await revokeSessions(staff._id, 'password_reset');
  return { temporaryPassword: password, sessionsEnded };
}

export async function resetTotp(who: Who, id: string) {
  const staff = await load(id);
  assertCanManage(who, staff);
  await StaffModel.updateOne(
    { _id: staff._id },
    { $set: { 'totp.secret': null, 'totp.enabledAt': null, 'totp.lastStep': null, 'totp.pendingSecret': null, 'totp.pendingAt': null } },
  );
  const sessionsEnded = await revokeSessions(staff._id, 'totp_reset');
  return { ok: true, sessionsEnded };
}

export async function logoutEverywhere(who: Who, id: string) {
  const staff = await load(id);
  assertCanManage(who, staff);
  return { ok: true, sessionsEnded: await revokeSessions(staff._id, 'signed_out_by_manager') };
}

export const reassignBody = z.object({ managerId: z.string().min(1).max(80) }).strict();

/**
 * Moves an agent to another manager (admins only). Grants the new manager
 * does not hold are dropped, and said so — an agent never carries more than
 * the person they now answer to.
 */
export async function reassign(who: Who, id: string, managerId: string) {
  assertTop(who, 'move an agent to another manager');
  const staff = await load(id);
  if (staff.role !== 'agent') throw Errors.validation({ managerId: 'Only an agent has a manager.' });
  const manager = await activeManager(managerId);
  const above = effectivePermissions({ role: 'manager', permissions: manager.permissions });
  const kept = staff.permissions.filter(p => above.has(p as Permission));
  const dropped = staff.permissions.filter(p => !above.has(p as Permission));
  await StaffModel.updateOne({ _id: staff._id }, { $set: { managerId: manager._id, permissions: kept } });
  const sessionsEnded = await revokeSessions(staff._id, 'reassigned');
  return { ...(await get(who, id)), dropped, sessionsEnded };
}

export const roleBody = z
  .object({ role: z.enum(['admin', 'manager', 'agent']), managerId: z.string().max(80).optional() })
  .strict();

/** Promotes or demotes (admins only), keeping the hierarchy whole on the way. */
export async function changeRole(who: Who, id: string, body: z.infer<typeof roleBody>) {
  assertTop(who, "change somebody's role");
  const staff = await load(id);
  if (staff._id === who.id) throw Errors.forbidden('NOT_ON_YOURSELF', 'You cannot change your own role.');
  if (staff.role === body.role) throw Errors.conflict('SAME_ROLE', `They are already ${body.role === 'admin' ? 'an admin' : `a ${body.role}`}.`);
  if (staff.role === 'admin') await assertNotLastAdmin(staff);
  if (staff.role === 'manager') {
    const agents = await StaffModel.countDocuments({ role: 'agent', managerId: staff._id, status: { $ne: 'deleted' } });
    if (agents > 0) {
      throw Errors.conflict('HAS_AGENTS', `${staff.name} still manages ${agents} agent${agents === 1 ? '' : 's'}. Move them to another manager first.`, { agents });
    }
  }

  const set: Record<string, unknown> = { role: body.role };
  let dropped: string[] = [];
  if (body.role === 'agent') {
    const manager = await activeManager(body.managerId);
    const above = effectivePermissions({ role: 'manager', permissions: manager.permissions });
    const current = staff.role === 'admin' ? [] : staff.permissions;
    set.managerId = manager._id;
    set.permissions = current.filter(p => AGENT_GRANTABLE.includes(p as Permission) && above.has(p as Permission));
    dropped = current.filter(p => !(set.permissions as string[]).includes(p));
  } else {
    set.managerId = null;
    if (body.role === 'admin') set.permissions = [];
  }
  await StaffModel.updateOne({ _id: staff._id }, { $set: set });
  const sessionsEnded = await revokeSessions(staff._id, 'role_changed');
  return { ...(await get(who, id)), dropped, sessionsEnded };
}

export async function remove(who: Who, id: string) {
  const staff = await load(id);
  assertCanManage(who, staff);
  await assertNotLastAdmin(staff);
  if (staff.role === 'manager') {
    const agents = await StaffModel.countDocuments({ role: 'agent', managerId: staff._id, status: { $ne: 'deleted' } });
    if (agents > 0) {
      throw Errors.conflict('HAS_AGENTS', `${staff.name} still manages ${agents} agent${agents === 1 ? '' : 's'}. Move them to another manager first.`, { agents });
    }
  }
  // Kept, not deleted: the activity log names this person on every row they
  // wrote, and "who was stf_…?" must still have an answer. The address is
  // freed so it can be given to somebody new.
  await StaffModel.updateOne(
    { _id: staff._id },
    { $set: { status: 'deleted', deletedAt: new Date(), formerEmail: staff.email, email: `${staff._id}@deleted.invalid`, permissions: [] } },
  );
  const sessionsEnded = await revokeSessions(staff._id, 'deleted');
  return { ok: true, sessionsEnded };
}

/** For the CLI's bootstrap: the first admin, when there is no other way in. */
export async function createFirstAdmin(email: string, name: string) {
  const normalised = email.trim().toLowerCase();
  if (await StaffModel.exists({ email: normalised })) throw new ApiError(409, 'EXISTS', 'A staff account already uses that email.');
  const password = temporaryPassword();
  await StaffModel.create({
    _id: newId('stf'),
    email: normalised,
    name: name.trim(),
    role: 'admin',
    managerId: null,
    permissions: [],
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    createdBy: { id: 'cli', role: 'root', name: 'command line', email: null },
  });
  return password;
}
