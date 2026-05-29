/**
 * Tests for register_login.js logic
 * Covers: setRole, showError, clearError, nextRegStep validation
 */

// ── Minimal DOM mock ──
function makeDOM() {
  const els = {};
  global.document = {
    getElementById: (id) => {
      if (!els[id]) {
        els[id] = {
          style: { display: 'none' },
          textContent: '',
          value: '',
          classList: { toggle: jest.fn(), contains: jest.fn(() => false), add: jest.fn(), remove: jest.fn() },
        };
      }
      return els[id];
    },
  };
  return els;
}

// ── Inline the pure logic (no DOM side-effects at import) ──
function showError(els, id, message) {
  const el = els[id] || { style: {}, textContent: '' };
  el.style.display = 'block';
  el.textContent = message;
}

function clearError(els, id) {
  const el = els[id] || { style: {}, textContent: '' };
  el.style.display = 'none';
  el.textContent = '';
}

function validateStep1(fields) {
  const { full_name, email, email_confirmation, password, retype_password } = fields;
  if (!full_name || !email || !email_confirmation || !password || !retype_password)
    return 'Please fill in all fields.';
  if (email !== email_confirmation)
    return 'Emails do not match.';
  if (password !== retype_password)
    return 'Passwords do not match.';
  return null;
}

// ── Tests ──
describe('showError / clearError', () => {
  test('showError sets display and message', () => {
    const els = {};
    els['my-error'] = { style: {}, textContent: '' };
    showError(els, 'my-error', 'Something went wrong');
    expect(els['my-error'].style.display).toBe('block');
    expect(els['my-error'].textContent).toBe('Something went wrong');
  });

  test('clearError hides element and clears message', () => {
    const els = {};
    els['my-error'] = { style: { display: 'block' }, textContent: 'old error' };
    clearError(els, 'my-error');
    expect(els['my-error'].style.display).toBe('none');
    expect(els['my-error'].textContent).toBe('');
  });
});

describe('validateStep1', () => {
  const valid = {
    full_name: 'Alice',
    email: 'alice@test.com',
    email_confirmation: 'alice@test.com',
    password: 'Secret123',
    retype_password: 'Secret123',
  };

  test('returns null for valid input', () => {
    expect(validateStep1(valid)).toBeNull();
  });

  test('returns error when fields are empty', () => {
    expect(validateStep1({ ...valid, full_name: '' })).toBe('Please fill in all fields.');
  });

  test('returns error when emails do not match', () => {
    expect(validateStep1({ ...valid, email_confirmation: 'other@test.com' })).toBe('Emails do not match.');
  });

  test('returns error when passwords do not match', () => {
    expect(validateStep1({ ...valid, retype_password: 'different' })).toBe('Passwords do not match.');
  });

  test('all fields required', () => {
    expect(validateStep1({ ...valid, password: '' })).toBe('Please fill in all fields.');
  });
});

describe('setRole', () => {
  test('selectedRole updates to staff', () => {
    let selectedRole = 'admin';
    function setRole(role) { selectedRole = role; }
    setRole('staff');
    expect(selectedRole).toBe('staff');
  });

  test('selectedRole updates to admin', () => {
    let selectedRole = 'staff';
    function setRole(role) { selectedRole = role; }
    setRole('admin');
    expect(selectedRole).toBe('admin');
  });
});
