// Who is using the app right now. Kept in memory only:
// closing the app or locking it clears the token, so the PIN is asked again.
export const session = $state({
  token: null,    // Worker session token (null when unlocked offline)
  user: null,     // { tenant_id, username, full_name, role, company_name, device_code }
  offline: false  // true when unlocked with the PIN saved on the phone
});
