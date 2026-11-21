# Security Specification — Cubi alla Deriva

## 1. Data Invariants
1. **User Profile Ownership**: Only the authenticated, email-verified user matching `{uid}` can read, create, or update `/users/{uid}`. `list` on `/users` is denied.
2. **Valid Identifiers**: Every document ID (`uid`, `roomCode`) must satisfy `isValidId()` (`^[a-zA-Z0-9_\-]+$`, length 1..128; `roomCode` length 4..16).
3. **Room Ownership & Membership**:
   - On `create` of `/rooms/{roomCode}`, `hostUid` must equal `request.auth.uid`, `memberUids` must have size 1 and contain `request.auth.uid`, `islandLevel == 1`, `bankCubes >= 0`, `createdAt == request.time`, `updatedAt == request.time`.
   - `hostUid`, `roomCode`, and `createdAt` are immutable after creation.
   - `memberUids` is strictly bounded (`<= 12` members).
4. **Action-Based Room Updates**:
   - **Join Action**: A verified user not yet in `memberUids` may add ONLY their own `request.auth.uid` to `memberUids` (while keeping existing members intact and total `<= 12`), initialize their entry in `playerProgress`, and update `updatedAt == request.time`. They cannot modify `bankCubes`, `islandLevel`, `structures`, or `rafts`.
   - **Sync State Action**: Existing members (`request.auth.uid in existing().memberUids`) may update `bankCubes`, `islandLevel`, `structures`, `rafts`, `playerProgress`, and `updatedAt == request.time` within valid bounds (`islandLevel >= 1 && islandLevel <= 6`, `bankCubes >= 0`, `rafts.size() >= 1 && rafts.size() <= 3`).
5. **Query Security (`allow list`)**: Listing `/rooms` strictly enforces `request.auth.uid in resource.data.memberUids`.

## 2. Dirty Dozen Attack Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read or write to `/users/u1` or `/rooms/ISOLA-1234`.
2. Unverified email (`email_verified == false`) attempting to create `/rooms/ISOLA-1234`.
3. User `u2` attempting to read `/users/u1`.
4. User `u1` attempting to `list` `/users`.
5. User `u1` attempting to `list` `/rooms` without filtering to `memberUids` containing `u1` (or reading a room list of other users).
6. User `u1` creating `/rooms/ISOLA-1234` with `hostUid: "u2"` (Identity Spoofing).
7. User `u1` creating `/rooms/ISOLA-1234` with an extra shadow field `isAdmin: true` (Shadow Field Injection).
8. User `u1` creating `/rooms/ISOLA-1234` with `createdAt` spoofed in the past instead of `request.time`.
9. Non-member `u3` attempting to modify `bankCubes` or `islandLevel` on `/rooms/ISOLA-1234`.
10. Non-member `u3` attempting a `join` action that removes `u1` from `memberUids` or adds `u4` instead of `u3`.
11. Member `u1` attempting to mutate `hostUid` or `createdAt` on `/rooms/ISOLA-1234`.
12. Member `u1` attempting to set `islandLevel: 99`, `bankCubes: -50`, or `rafts` with 10 rafts, or an oversized 200KB `name` string.
