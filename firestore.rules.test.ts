/**
 * Security Rules Verification Spec for Cubi alla Deriva
 * Verifies the "Dirty Dozen" adversarial payloads defined in security_spec.md
 * against the Firestore rules in firestore.rules.
 */
export const DIRTY_DOZEN_CASES = [
  { name: 'Unauthenticated read/write to /users/u1', expected: 'PERMISSION_DENIED' },
  { name: 'Unverified email creating /rooms/ISOLA-1234', expected: 'PERMISSION_DENIED' },
  { name: 'Cross-user read on /users/u1 by u2', expected: 'PERMISSION_DENIED' },
  { name: 'Blanket list on /users', expected: 'PERMISSION_DENIED' },
  { name: 'Unscoped list on /rooms without memberUids containment', expected: 'PERMISSION_DENIED' },
  { name: 'Host identity spoofing on room create', expected: 'PERMISSION_DENIED' },
  { name: 'Shadow field injection (isAdmin: true) on room create', expected: 'PERMISSION_DENIED' },
  { name: 'Timestamp spoofing (createdAt != request.time) on create', expected: 'PERMISSION_DENIED' },
  { name: 'Non-member mutating bankCubes or islandLevel', expected: 'PERMISSION_DENIED' },
  { name: 'Join action removing existing members or adding another UID', expected: 'PERMISSION_DENIED' },
  { name: 'Immutable hostUid/createdAt mutation on room update', expected: 'PERMISSION_DENIED' },
  { name: 'Out-of-bounds islandLevel (99), negative bankCubes, or oversized name', expected: 'PERMISSION_DENIED' },
] as const;
