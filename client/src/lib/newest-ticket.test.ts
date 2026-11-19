import { describe, expect, it } from 'vitest';
import { newestTicket } from './newest-ticket';

describe('newestTicket', () => {
  it('only the newest ticket is current', () => {
    const next = newestTicket();
    const first = next();
    expect(first()).toBe(true);
    const second = next();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });
});
