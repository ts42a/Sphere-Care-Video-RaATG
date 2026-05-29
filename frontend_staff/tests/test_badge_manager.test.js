/**
 * Tests for BadgeManager logic
 * Covers: count capping at 99+, handleWsMessage, badge visibility
 */

function formatBadgeCount(n) {
  if (n <= 0) return null;
  return n > 99 ? '99+' : String(n);
}

function handleWsMessage(counts, msg) {
  if (msg.type !== 'badge_update') return false;
  if (typeof msg.messages === 'number') counts.messages = msg.messages;
  if (typeof msg.alerts === 'number')   counts.alerts   = msg.alerts;
  if (typeof msg.flags === 'number')    counts.flags    = msg.flags;
  return true;
}

describe('formatBadgeCount', () => {
  test('returns null for 0', () => {
    expect(formatBadgeCount(0)).toBeNull();
  });

  test('returns string number for 1-99', () => {
    expect(formatBadgeCount(5)).toBe('5');
    expect(formatBadgeCount(99)).toBe('99');
  });

  test('caps at 99+ for values over 99', () => {
    expect(formatBadgeCount(100)).toBe('99+');
    expect(formatBadgeCount(999)).toBe('99+');
  });

  test('returns null for negative', () => {
    expect(formatBadgeCount(-1)).toBeNull();
  });
});

describe('handleWsMessage', () => {
  test('ignores non-badge_update messages', () => {
    const counts = { messages: 0, alerts: 0, flags: 0 };
    const result = handleWsMessage(counts, { type: 'new_message', messages: 5 });
    expect(result).toBe(false);
    expect(counts.messages).toBe(0);
  });

  test('updates counts from badge_update', () => {
    const counts = { messages: 0, alerts: 0, flags: 0 };
    handleWsMessage(counts, { type: 'badge_update', messages: 3, alerts: 1, flags: 2 });
    expect(counts.messages).toBe(3);
    expect(counts.alerts).toBe(1);
    expect(counts.flags).toBe(2);
  });

  test('partial update only changes provided fields', () => {
    const counts = { messages: 5, alerts: 2, flags: 1 };
    handleWsMessage(counts, { type: 'badge_update', messages: 10 });
    expect(counts.messages).toBe(10);
    expect(counts.alerts).toBe(2);
    expect(counts.flags).toBe(1);
  });
});
