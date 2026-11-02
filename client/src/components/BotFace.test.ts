import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOT,
  SHAPES,
  COLORS,
  HAT_NAMES,
  GLASSES_NAMES,
  decodeBot,
  encodeBot,
  renderBot,
  hatChip,
  glassesChip,
} from './bricksbot-avatar';
import { BotFace, decodeLook, encodeLook, botLook, registerBotLooks } from './BotFace';

describe('bricksbot avatar system', () => {
  it('round-trips all valid configurations through encodeBot / decodeBot', () => {
    const config = { shape: 2, color: 5, hat: 3, glasses: 1 };
    const encoded = encodeBot(config);
    expect(encoded).toBe('2.5.3.1');
    expect(decodeBot(encoded)).toEqual(config);
  });

  it('falls back to default config on invalid or malformed string', () => {
    expect(decodeBot('')).toEqual(DEFAULT_BOT);
    expect(decodeBot('random')).toEqual(DEFAULT_BOT);
    expect(decodeBot('1.2.3')).toEqual(DEFAULT_BOT);
    expect(decodeBot('999.999.999.999')).toEqual(DEFAULT_BOT);
    expect(decodeBot(undefined)).toEqual(DEFAULT_BOT);
  });

  it('renders all 15 shapes in all 11 colors without crashing', () => {
    for (let shape = 0; shape < SHAPES.length; shape++) {
      for (let color = 0; color < COLORS.length; color++) {
        const svg = renderBot({ shape, color, hat: 0, glasses: 0 }, 48);
        expect(svg).toContain('<svg');
        expect(svg).toContain("class='bt'");
      }
    }
  });

  it('renders every hat and glasses combination on shapes', () => {
    for (let hat = 0; hat < HAT_NAMES.length; hat++) {
      for (let glasses = 0; glasses < GLASSES_NAMES.length; glasses++) {
        const svg = renderBot({ shape: 1, color: 7, hat, glasses }, 64);
        expect(svg).toContain('<svg');
      }
    }
  });

  it('renders chips for accessories', () => {
    for (let hat = 1; hat < HAT_NAMES.length; hat++) {
      const chip = hatChip(hat, 7);
      expect(chip).toContain('<svg');
    }
    for (let g = 1; g < GLASSES_NAMES.length; g++) {
      const chip = glassesChip(g, 7);
      expect(chip).toContain('<svg');
    }
  });

  it('round-trips through BotFace encodeLook / decodeLook', () => {
    const config = { shape: 3, color: 4, hat: 2, glasses: 2 };
    const encoded = encodeLook(config);
    expect(decodeLook(encoded)).toEqual(config);
    expect(decodeLook('invalid')).toBeNull();
  });

  it('migrates legacy 2-char avatar labels to brick config', () => {
    expect(decodeLook('ah')).toEqual({ shape: 0, color: 7, hat: 0, glasses: 0 });
    expect(decodeLook('bj')).toEqual({ shape: 1, color: 9, hat: 0, glasses: 0 });
    expect(decodeLook('zz')).toBeNull();
    expect(decodeLook('P')).toBeNull();
  });

  it('botLook prefers stored labels and falls back for primaries', () => {
    registerBotLooks([
      { id: 'primary-1', avatarLabel: 'P', isPrimary: true },
      { id: 'mate-1', avatarLabel: '2.5.1.1', isPrimary: false },
    ]);
    expect(botLook('primary-1', true)).toEqual(DEFAULT_BOT);
    expect(botLook('mate-1', false)).toEqual({ shape: 2, color: 5, hat: 1, glasses: 1 });
  });

  it('updates rendered BotFace markup when a bot look is edited for the same botId', () => {
    registerBotLooks([{ id: 'bot-edit-1', avatarLabel: '0.2.0.0', isPrimary: false }]);
    const before = renderToStaticMarkup(createElement(BotFace, { botId: 'bot-edit-1', size: 48 }));
    expect(before).toContain(COLORS[2][0]);

    registerBotLooks([{ id: 'bot-edit-1', avatarLabel: '4.6.2.1', isPrimary: false }]);
    const after = renderToStaticMarkup(createElement(BotFace, { botId: 'bot-edit-1', size: 48 }));
    expect(after).not.toBe(before);
    expect(after).toContain(COLORS[6][0]);
  });
});
