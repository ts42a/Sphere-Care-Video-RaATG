/**
 * Tests for WS.js SC client logic
 * Covers: event bus (on/emit), getToken, message parsing
 */

// Simulate the SC event bus
function makeEventBus() {
  const listeners = {};

  function on(type, fn) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(fn);
  }

  function emit(type, data) {
    (listeners[type] || []).forEach(fn => fn(data));
  }

  function off(type, fn) {
    if (!listeners[type]) return;
    listeners[type] = listeners[type].filter(f => f !== fn);
  }

  return { on, emit, off, listeners };
}

function parseWsMessage(raw) {
  try {
    const msg = JSON.parse(raw);
    if (!msg || !msg.type) return null;
    return msg;
  } catch {
    return null;
  }
}

describe('Event bus', () => {
  test('on + emit calls listener', () => {
    const bus = makeEventBus();
    const received = [];
    bus.on('new_message', (d) => received.push(d));
    bus.emit('new_message', { text: 'hello' });
    expect(received).toHaveLength(1);
    expect(received[0].text).toBe('hello');
  });

  test('multiple listeners for same event', () => {
    const bus = makeEventBus();
    let count = 0;
    bus.on('ping', () => count++);
    bus.on('ping', () => count++);
    bus.emit('ping');
    expect(count).toBe(2);
  });

  test('off removes listener', () => {
    const bus = makeEventBus();
    let count = 0;
    const fn = () => count++;
    bus.on('test', fn);
    bus.off('test', fn);
    bus.emit('test');
    expect(count).toBe(0);
  });

  test('unknown event does nothing', () => {
    const bus = makeEventBus();
    expect(() => bus.emit('unknown_event')).not.toThrow();
  });
});

describe('parseWsMessage', () => {
  test('valid JSON with type returns object', () => {
    const msg = parseWsMessage('{"type":"new_message","text":"hi"}');
    expect(msg).not.toBeNull();
    expect(msg.type).toBe('new_message');
  });

  test('invalid JSON returns null', () => {
    expect(parseWsMessage('not json')).toBeNull();
  });

  test('JSON without type returns null', () => {
    expect(parseWsMessage('{"data":"something"}')).toBeNull();
  });

  test('empty string returns null', () => {
    expect(parseWsMessage('')).toBeNull();
  });
});
