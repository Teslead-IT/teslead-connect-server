/**
 * Backfill Organization.ownerId from OrgMember table
 *
 * This script populates ownerId for organizations that don't have it set.
 * It's needed because ownerId was added in a new update, and production
 * has many existing organizations without this field.
 *
 * Selection logic (in order of preference):
 * 1. First active member with OWNER role (by joinedAt)
 * 2. First active member with ADMIN role (by joinedAt)
 * 3. First active member with any role (by joinedAt - likely the creator)
 *
 * Usage:
 *   pnpm run backfill:owner              # Apply changes
 *   pnpm run backfill:owner -- --dry-run # Preview only, no DB writes
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (DRY_RUN) {
    console.log('*** DRY RUN - No changes will be written ***\n');
  }
  console.log('Starting organization ownerId backfill...\n');

  // Find all organizations where ownerId is null
  const orgsWithoutOwner = await prisma.organization.findMany({
    where: {
      ownerId: null,
      isDeleted: false,
    },
    select: { id: true, name: true },
  });

  console.log(`Found ${orgsWithoutOwner.length} organizations without ownerId\n`);

  if (orgsWithoutOwner.length === 0) {
    console.log('Nothing to update.');
    return;
  }

  let updated = 0;
  let skipped = 0;
  const skippedOrgs: string[] = [];

  const ROLE_PRIORITY: Record<string, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };

  for (const org of orgsWithoutOwner) {
    // Get all active members with userId (must be linked users, not pending invites)
    const members = await prisma.orgMember.findMany({
      where: {
        orgId: org.id,
        status: 'ACTIVE',
        isActive: true,
        userId: { not: null }, // Must have linked user
      },
      orderBy: { joinedAt: 'asc' },
      select: { userId: true, role: true, joinedAt: true },
    });

    // Pick best candidate: OWNER first, then ADMIN, then MEMBER; oldest joined first
    const ownerCandidate = members
      .filter((m) => m.userId)
      .sort((a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99))[0];

    if (!ownerCandidate?.userId) {
      skipped++;
      skippedOrgs.push(`${org.name} (${org.id}) - no active member with userId`);
      continue;
    }

    if (!DRY_RUN) {
      await prisma.organization.update({
        where: { id: org.id },
        data: { ownerId: ownerCandidate.userId! },
      });
    }

    updated++;
    const action = DRY_RUN ? 'Would set' : 'Set';
    console.log(`${DRY_RUN ? '[DRY] ' : '✓ '}${org.name}: ${action} ownerId to user (${ownerCandidate.role}, joined ${ownerCandidate.joinedAt.toISOString()})`);
  }

  console.log('\n--- Summary ---');
  console.log(`${DRY_RUN ? 'Would update' : 'Updated'}: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  if (skippedOrgs.length > 0) {
    console.log('\nSkipped organizations (no active member to assign as owner):');
    skippedOrgs.forEach((s) => console.log(`  - ${s}`));
  }
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
