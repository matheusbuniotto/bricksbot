import { describe, expect, it } from 'vitest';
import { BOT_COLORS, BOT_SHAPES, decodeLook, encodeLook } from './BotFace';

describe('bot look encoding', () => {
  it('round-trips every shape and color through the 2-char avatarLabel', () => {
    for (let shape = 0; shape < BOT_SHAPES.length; shape++) {
      for (let color = 0; color < BOT_COLORS.length; color++) {
        const label = encodeLook({ shape, color });
        expect(label).toHaveLength(2);
        expect(decodeLook(label)).toEqual({ shape, color });
      }
    }
  });

  it('rejects legacy and malformed labels', () => {
    for (const label of ['P', 'A', '', 'zz', 'abc', undefined]) {
      expect(decodeLook(label)).toBeNull();
    }
  });
});
