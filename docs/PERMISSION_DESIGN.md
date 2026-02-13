# Permission & Role Design (High-Level, Scalable)

## Current State vs Desired State

| Role | Current | Desired |
|------|---------|---------|
| **OWNER (Creator)** | Same as invited OWNER | Full control, **only one who can invite to org** |
| **OWNER (Invited)** | Can invite (same as creator) | Full access EXCEPT cannot invite to org |
| **ADMIN** | Can invite, manage org | Create projects, add project members, full project control |
| **MEMBER** | Limited | Work on assigned projects only, no project creation |

---

## Option A: Add `ownerId` to Organization (Recommended)

### Schema Change

```prisma
model Organization {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  ownerId     String?  // NEW: The user who created the org (single source of truth)
  isActive    Boolean  @default(true)
  isDeleted   Boolean  @default(false)
  // ...
  
  owner       User?    @relation(fields: [ownerId], references: [id])
}
```

### Permission Matrix

| Action | Org Creator (ownerId) | Invited OWNER | ADMIN | MEMBER |
|--------|----------------------|---------------|-------|--------|
| **Invite to Org** | ✅ | ❌ | ❌ | ❌ |
| **Create Project** | ✅ | ✅ | ✅ | ❌ |
| **Delete Project** | ✅ (own only) | ✅ (own only) | ❌ | ❌ |
| **Add User to Project** | ✅ | ✅ | ✅ | ❌ |
| **Remove User from Project** | ✅ | ✅ | ✅ | ❌ |
| **Update Org Settings** | ✅ | ✅ | ❌ | ❌ |
| **Update Member Org Role** | ✅ | ❌ | ❌ | ❌ |
| **Work on Tasks (project)** | ✅ | ✅ | ✅ | ✅ |
| **Delete Org** | ✅ | ❌ | ❌ | ❌ |

### Check Logic (Pseudocode)

```typescript
// Can invite to org?
canInviteToOrg(userId, orgId) => org.ownerId === userId

// Can create project?
canCreateProject(userId, orgId) => 
  orgMember.role === OWNER || orgMember.role === ADMIN

// Can add user to project?
canAddToProject(userId, projectId) =>
  orgMember.role === OWNER || orgMember.role === ADMIN
  OR isProjectOwner(projectId, userId)
```

---

## Option B: Permission-Based (More Scalable for Future)

For long-term scalability, use explicit permissions instead of inferring from roles:

```prisma
enum OrgPermission {
  INVITE_MEMBERS
  CREATE_PROJECTS
  MANAGE_ORG_SETTINGS
  UPDATE_MEMBER_ROLES
  DELETE_ORG
  // ...extensible
}

model OrgMember {
  // ...existing
  permissions  OrgPermission[]  // Override role defaults
}
```

**Pros**: Flexible, can add permissions without schema changes to roles  
**Cons**: More complex, migration effort

---

## Implementation Phases

### Phase 1: Add `ownerId` to Organization (Minimal Change)

1. **Migration**: Add `ownerId` to Organization
2. **Backfill**: Set `ownerId` = first OrgMember with role OWNER and earliest `joinedAt`
3. **Update create flow**: Set `org.ownerId = userId` when creating org
4. **Update invite check**: 
   - In `invites.service.sendInvite`: Check `org.ownerId === requesterId` instead of `role === OWNER || role === ADMIN`

### Phase 2: Restrict Who Can Invite

| Location | Current | New |
|----------|---------|-----|
| `invites.service.sendInvite` | OWNER \|\| ADMIN | `org.ownerId === requesterId` |
| `organizations.service.inviteMember` | OWNER \|\| ADMIN | `org.ownerId === requesterId` |

### Phase 3: Project Creation Guard

| Location | Current | New |
|----------|---------|-----|
| `projects.service.create` | OWNER \|\| ADMIN | Same (OWNER \|\| ADMIN) |
| `projects.controller` | @Roles(ADMIN, OWNER) | Same |

### Phase 4: Add User to Project

- Only OWNER, ADMIN, or Project Owner can add users to project
- MEMBER cannot invite others to projects (already enforced if you check org role before allowing project invite)

---

## Key Files to Modify

1. **Schema**: `prisma/schema.prisma` — Add `ownerId` to Organization
2. **Invites**: `invites.service.ts` — Change permission check from role to `org.ownerId`
3. **Organizations**: `organizations.service.ts` — Same for `inviteMember`, `updateMemberRole`
4. **Projects**: No change for create (ADMIN/OWNER) — MEMBER already blocked by `@Roles` guard
5. **Optional**: Create `PermissionsService` or `can(userId, action, resource)` helper for reuse

---

## Summary

| Decision | Recommendation |
|----------|----------------|
| **Org Creator vs Invited OWNER** | Add `Organization.ownerId` |
| **Who can invite** | Only org creator (`ownerId`) |
| **Who can create project** | OWNER or ADMIN (no change) |
| **Who can add to project** | OWNER, ADMIN, or Project Owner |
| **MEMBER** | Already restricted by guards; ensure project create/invite flows check org role |
