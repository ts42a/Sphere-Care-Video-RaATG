/**
 * Tests for auth guard and session storage logic (script.js / dashboard_auth.js)
 */

function getUserFromSession(storage) {
  try {
    return JSON.parse(storage['user'] || 'null');
  } catch {
    return null;
  }
}

function getToken(storage) {
  return storage['access_token'] || storage['spherecare_token'] || null;
}

function isLoggedIn(storage) {
  return !!getToken(storage);
}

function migrateAuth(storage) {
  const accessToken = storage['access_token'];
  const legacyToken = storage['spherecare_token'];
  if (!accessToken && legacyToken) {
    storage['access_token'] = legacyToken;
  }
  if (accessToken && legacyToken !== accessToken) {
    storage['spherecare_token'] = accessToken;
  }
}

describe('isLoggedIn', () => {
  test('returns true when access_token present', () => {
    expect(isLoggedIn({ access_token: 'abc123' })).toBe(true);
  });

  test('returns true when spherecare_token present', () => {
    expect(isLoggedIn({ spherecare_token: 'legacy_token' })).toBe(true);
  });

  test('returns false when no token', () => {
    expect(isLoggedIn({})).toBe(false);
  });
});

describe('getUserFromSession', () => {
  test('parses user object correctly', () => {
    const storage = { user: JSON.stringify({ full_name: 'Alice', role: 'staff' }) };
    const user = getUserFromSession(storage);
    expect(user.full_name).toBe('Alice');
    expect(user.role).toBe('staff');
  });

  test('returns null when no user', () => {
    expect(getUserFromSession({})).toBeNull();
  });

  test('returns null for invalid JSON', () => {
    expect(getUserFromSession({ user: 'not-json' })).toBeNull();
  });
});

describe('migrateAuth', () => {
  test('copies legacy token to access_token', () => {
    const storage = { spherecare_token: 'old_token' };
    migrateAuth(storage);
    expect(storage['access_token']).toBe('old_token');
  });

  test('syncs access_token to spherecare_token', () => {
    const storage = { access_token: 'new_token' };
    migrateAuth(storage);
    expect(storage['spherecare_token']).toBe('new_token');
  });

  test('does not overwrite existing access_token', () => {
    const storage = { access_token: 'real_token', spherecare_token: 'old' };
    migrateAuth(storage);
    expect(storage['access_token']).toBe('real_token');
  });
});
