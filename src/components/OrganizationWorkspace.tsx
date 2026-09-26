import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Activity,
  Building2,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserRound,
  UserX,
} from 'lucide-react';
import {
  readApiResponse,
  type MembershipRole,
} from '../session';

type MembershipStatus =
  | 'ACTIVE'
  | 'REVOKED';

type OrganizationMember = {
  userId: string;
  email: string;
  displayName?: string;
  userStatus: string;
  role: MembershipRole;
  membershipStatus:
    MembershipStatus;
  createdAt: number;
  updatedAt: number;
};

type MemberCapabilities = {
  canManageMembers: boolean;
  canManageOwners: boolean;
};

type MembershipAuditEntry = {
  id: string;
  accountId: string;
  actorUserId: string;
  targetUserId: string;
  action:
    | 'ROLE_CHANGED'
    | 'STATUS_CHANGED';
  previousRole: MembershipRole;
  nextRole: MembershipRole;
  previousStatus:
    MembershipStatus;
  nextStatus:
    MembershipStatus;
  occurredAt: number;
};

interface OrganizationWorkspaceProps {
  accountId: string;
  currentUserId: string;
  membershipRole: MembershipRole;
}

function csrfToken(): string {
  if (typeof document === 'undefined') {
    return '';
  }

  const entry = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) =>
      item.startsWith('ka_csrf=')
    );

  if (!entry) return '';
  return decodeURIComponent(
    entry.slice('ka_csrf='.length)
  );
}

function dateTime(value: number): string {
  return new Date(value).toLocaleString();
}

function roleClass(
  role: MembershipRole
): string {
  if (role === 'OWNER') {
    return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  }
  if (role === 'ADMIN') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function statusClass(
  status: MembershipStatus
): string {
  return status === 'ACTIVE'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-slate-200 bg-slate-100 text-slate-500';
}

export const OrganizationWorkspace:
  React.FC<
    OrganizationWorkspaceProps
  > = ({
    accountId,
    currentUserId,
    membershipRole,
  }) => {
    const [members, setMembers] =
      useState<OrganizationMember[]>([]);
    const [capabilities, setCapabilities] =
      useState<MemberCapabilities>({
        canManageMembers: false,
        canManageOwners: false,
      });
    const [audit, setAudit] = useState<
      MembershipAuditEntry[]
    >([]);
    const [isLoading, setIsLoading] =
      useState(true);
    const [busyMemberId, setBusyMemberId] =
      useState<string | null>(null);
    const [notice, setNotice] =
      useState<string | null>(null);
    const [error, setError] =
      useState<string | null>(null);

    const memberById = useMemo(
      () =>
        new Map(
          members.map((member) => [
            member.userId,
            member,
          ])
        ),
      [members]
    );

    const load = useCallback(
      async () => {
        setIsLoading(true);
        setError(null);

        try {
          const response = await fetch(
            '/api/organization/members',
            {
              credentials:
                'same-origin',
            }
          );
          const body =
            await readApiResponse<{
              accountId: string;
              members:
                OrganizationMember[];
              capabilities:
                MemberCapabilities;
            }>(
              response,
              'Could not load organization members.'
            );

          setMembers(body.members || []);
          setCapabilities(
            body.capabilities || {
              canManageMembers: false,
              canManageOwners: false,
            }
          );

          if (
            body.capabilities
              ?.canManageMembers
          ) {
            const auditResponse =
              await fetch(
                '/api/organization/membership-audit?limit=50',
                {
                  credentials:
                    'same-origin',
                }
              );
            const auditBody =
              await readApiResponse<{
                entries:
                  MembershipAuditEntry[];
              }>(
                auditResponse,
                'Could not load membership audit history.'
              );
            setAudit(
              auditBody.entries || []
            );
          } else {
            setAudit([]);
          }
        } catch (err: any) {
          setError(
            err?.message ||
              'Could not load organization.'
          );
        } finally {
          setIsLoading(false);
        }
      },
      [accountId]
    );

    useEffect(() => {
      void load();
    }, [load]);

    const updateRole = async (
      member: OrganizationMember,
      role: MembershipRole
    ) => {
      if (
        !capabilities.canManageMembers ||
        role === member.role
      ) {
        return;
      }

      setBusyMemberId(member.userId);
      setError(null);
      setNotice(null);

      try {
        const response = await fetch(
          '/api/organization/members/' +
            encodeURIComponent(
              member.userId
            ) +
            '/role',
          {
            method: 'PATCH',
            credentials:
              'same-origin',
            headers: {
              'Content-Type':
                'application/json',
              'X-CSRF-Token':
                csrfToken(),
            },
            body: JSON.stringify({
              role,
            }),
          }
        );

        await readApiResponse(
          response,
          'Could not change member role.'
        );

        setNotice(
          'Membership role updated.'
        );
        await load();
      } catch (err: any) {
        setError(
          err?.message ||
            'Could not change member role.'
        );
      } finally {
        setBusyMemberId(null);
      }
    };

    const updateStatus = async (
      member: OrganizationMember,
      status: MembershipStatus
    ) => {
      if (
        !capabilities.canManageMembers ||
        status ===
          member.membershipStatus
      ) {
        return;
      }

      setBusyMemberId(member.userId);
      setError(null);
      setNotice(null);

      try {
        const response = await fetch(
          '/api/organization/members/' +
            encodeURIComponent(
              member.userId
            ) +
            '/status',
          {
            method: 'PATCH',
            credentials:
              'same-origin',
            headers: {
              'Content-Type':
                'application/json',
              'X-CSRF-Token':
                csrfToken(),
            },
            body: JSON.stringify({
              status,
            }),
          }
        );

        await readApiResponse(
          response,
          'Could not change membership status.'
        );

        setNotice(
          status === 'ACTIVE'
            ? 'Membership restored.'
            : 'Membership revoked.'
        );
        await load();
      } catch (err: any) {
        setError(
          err?.message ||
            'Could not change membership status.'
        );
      } finally {
        setBusyMemberId(null);
      }
    };

    const canEditMember = (
      member: OrganizationMember
    ): boolean => {
      if (
        !capabilities.canManageMembers ||
        member.userId ===
          currentUserId
      ) {
        return false;
      }

      if (
        member.role === 'OWNER' &&
        !capabilities.canManageOwners
      ) {
        return false;
      }

      return true;
    };

    const availableRoles = (
      member: OrganizationMember
    ): MembershipRole[] => {
      const roles: MembershipRole[] =
        capabilities.canManageOwners
          ? [
              'OWNER',
              'ADMIN',
              'MEMBER',
            ]
          : ['ADMIN', 'MEMBER'];

      return roles.includes(member.role)
        ? roles
        : [member.role, ...roles];
    };

    return (
      <main
        id="organization-workspace"
        className="flex-1 min-h-0 overflow-y-auto bg-[#f7f7f3]"
      >
        <div className="max-w-7xl mx-auto px-5 md:px-8 py-7 md:py-9">
          <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-6">
            <div className="max-w-3xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-700 mb-2">
                Organization
              </div>
              <h2 className="text-3xl md:text-4xl font-semibold tracking-[-0.035em] leading-[1.08] text-slate-950">
                Members & access
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                Review who can access this
                organization and how their
                membership is governed. Role
                and status changes are
                enforced by the server and
                recorded in the membership
                audit trail.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-500">
                  Account {accountId}
                </span>
                <span
                  className={
                    'rounded-full border px-2.5 py-1 font-semibold ' +
                    roleClass(
                      membershipRole
                    )
                  }
                >
                  Your role: {membershipRole}
                </span>
              </div>
            </div>

            <button
              id="organization-refresh"
              type="button"
              onClick={() => void load()}
              disabled={isLoading}
              className="inline-flex self-start items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                className={
                  'w-3.5 h-3.5 ' +
                  (isLoading
                    ? 'animate-spin'
                    : '')
                }
              />
              Refresh
            </button>
          </header>

          {!capabilities.canManageMembers && (
            <div
              id="organization-read-only-boundary"
              className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs leading-5 text-indigo-800"
            >
              Your MEMBER role can review
              organization membership, but
              only OWNER and ADMIN members
              can change roles or membership
              status.
            </div>
          )}

          {capabilities.canManageMembers && (
            <div
              id="organization-no-invite-contract"
              className="mb-5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-600"
            >
              This release manages existing
              memberships only. Invitations
              and user onboarding are not
              exposed because the server does
              not yet define a durable
              invitation/join contract.
            </div>
          )}

          {(notice || error) && (
            <div
              className={
                'mb-5 rounded-xl border px-4 py-3 text-xs ' +
                (error
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800')
              }
            >
              {error || notice}
            </div>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <UserRound className="w-4 h-4 text-indigo-600" />
                  Members
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {members.length} membership
                  {members.length === 1
                    ? ''
                    : 's'}{' '}
                  in the selected account.
                </p>
              </div>
              <Building2 className="w-5 h-5 text-slate-300" />
            </div>

            {isLoading ? (
              <div className="px-5 py-10 text-center text-xs text-slate-500">
                Loading members…
              </div>
            ) : members.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs text-slate-500">
                No memberships found.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {members.map((member) => {
                  const editable =
                    canEditMember(member);
                  const busy =
                    busyMemberId ===
                    member.userId;

                  return (
                    <div
                      key={member.userId}
                      id={
                        'organization-member-' +
                        member.userId
                      }
                      className="grid grid-cols-1 xl:grid-cols-[minmax(240px,1.4fr)_150px_145px_minmax(220px,.8fr)] gap-3 xl:items-center px-5 py-4"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900">
                            {member.displayName ||
                              member.email}
                          </span>
                          {member.userId ===
                            currentUserId && (
                            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[9px] font-semibold text-indigo-700">
                              You
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-500">
                          {member.email}
                        </div>
                        <div className="mt-1 text-[9px] text-slate-400">
                          Joined{' '}
                          {dateTime(
                            member.createdAt
                          )}
                        </div>
                      </div>

                      <div>
                        {editable ? (
                          <select
                            id={
                              'organization-role-' +
                              member.userId
                            }
                            value={member.role}
                            disabled={busy}
                            onChange={(event) =>
                              void updateRole(
                                member,
                                event.target
                                  .value as
                                  MembershipRole
                              )
                            }
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50"
                          >
                            {availableRoles(
                              member
                            ).map((role) => (
                              <option
                                key={role}
                                value={role}
                              >
                                {role}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={
                              'inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ' +
                              roleClass(
                                member.role
                              )
                            }
                          >
                            {member.role}
                          </span>
                        )}
                      </div>

                      <div>
                        <span
                          className={
                            'inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ' +
                            statusClass(
                              member
                                .membershipStatus
                            )
                          }
                        >
                          {member.membershipStatus}
                        </span>
                      </div>

                      <div className="flex xl:justify-end">
                        {editable ? (
                          <button
                            id={
                              'organization-status-' +
                              member.userId
                            }
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void updateStatus(
                                member,
                                member.membershipStatus ===
                                  'ACTIVE'
                                  ? 'REVOKED'
                                  : 'ACTIVE'
                              )
                            }
                            className={
                              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-semibold disabled:opacity-50 ' +
                              (member.membershipStatus ===
                              'ACTIVE'
                                ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100')
                            }
                          >
                            {member.membershipStatus ===
                            'ACTIVE' ? (
                              <>
                                <UserX className="w-3.5 h-3.5" />
                                Revoke access
                              </>
                            ) : (
                              <>
                                <UserCheck className="w-3.5 h-3.5" />
                                Restore access
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400">
                            {member.userId ===
                            currentUserId
                              ? 'Self-management is protected'
                              : member.role ===
                                    'OWNER' &&
                                  !capabilities.canManageOwners
                                ? 'OWNER protected'
                                : 'Read only'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {capabilities.canManageMembers && (
            <section
              id="organization-membership-audit"
              className="mt-5 rounded-2xl border border-slate-200 bg-white overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Activity className="w-4 h-4 text-emerald-600" />
                    Membership audit
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Recent privileged role
                    and status changes.
                  </p>
                </div>
                <ShieldCheck className="w-5 h-5 text-slate-300" />
              </div>

              {audit.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-slate-500">
                  No membership changes have
                  been recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {audit.map((entry) => {
                    const actor =
                      memberById.get(
                        entry.actorUserId
                      );
                    const target =
                      memberById.get(
                        entry.targetUserId
                      );

                    return (
                      <div
                        key={entry.id}
                        className="grid grid-cols-1 md:grid-cols-[minmax(180px,1fr)_minmax(220px,1.4fr)_auto] gap-2 px-5 py-3 text-[11px]"
                      >
                        <div className="text-slate-600">
                          <span className="font-semibold text-slate-800">
                            {actor?.displayName ||
                              actor?.email ||
                              entry.actorUserId}
                          </span>
                          {' → '}
                          <span className="font-semibold text-slate-800">
                            {target?.displayName ||
                              target?.email ||
                              entry.targetUserId}
                          </span>
                        </div>
                        <div className="text-slate-500">
                          {entry.action ===
                          'ROLE_CHANGED'
                            ? entry.previousRole +
                              ' → ' +
                              entry.nextRole
                            : entry.previousStatus +
                              ' → ' +
                              entry.nextStatus}
                        </div>
                        <div className="text-slate-400 md:text-right">
                          {dateTime(
                            entry.occurredAt
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    );
  };
