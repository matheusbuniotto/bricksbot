import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SpaceMembersDialog } from './SpaceMembersDialog';

describe('SpaceMembersDialog Component', () => {
  const dummySpace = {
    id: 'space-1',
    name: 'Analytics Team',
    ownerId: 'owner@example.com',
    createdAt: '2026-01-01T00:00:00Z',
  };

  test('renders nothing when isOpen is false', () => {
    const html = renderToString(<SpaceMembersDialog space={dummySpace} isOpen={false} onClose={() => {}} />);
    expect(html).toBe('');
  });

  test('renders nothing when space is null', () => {
    const html = renderToString(<SpaceMembersDialog space={null} isOpen={true} onClose={() => {}} />);
    expect(html).toBe('');
  });

  test('renders dialog container and title when open', () => {
    const html = renderToString(<SpaceMembersDialog space={dummySpace} isOpen={true} onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Members —');
    expect(html).toContain('Analytics Team');
    expect(html).toContain('class="dialog space-members-dialog"');
    expect(html).toContain('space-members-empty');
  });
});
