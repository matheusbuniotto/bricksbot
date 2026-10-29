import { describe, expect, test, vi } from 'vitest';
import {
  createVolumeReadTool,
  validateVolumePath,
  volumeReadToolDefinition,
} from './volume-read.js';

describe('validateVolumePath', () => {
  test('accepts valid /Volumes/ path', () => {
    expect(validateVolumePath('/Volumes/cat/schema/vol/data.csv')).toBeNull();
    expect(validateVolumePath('/Volumes/cat/schema/vol/')).toBeNull();
  });

  test('rejects paths not starting with /Volumes/', () => {
    expect(validateVolumePath('/tmp/file.txt')).toMatch(/only accesses Unity Catalog Volumes/);
    expect(validateVolumePath('Volumes/cat/schema/vol')).toMatch(/only accesses Unity Catalog Volumes/);
  });

  test('rejects path traversal', () => {
    expect(validateVolumePath('/Volumes/cat/schema/vol/../etc/passwd')).toMatch(/path traversal/);
  });

  test('rejects empty paths', () => {
    expect(validateVolumePath('')).toMatch(/requires a path/);
  });
});

describe('createVolumeReadTool', () => {
  test('has correct definition', () => {
    expect(volumeReadToolDefinition.name).toBe('volume_read');
    expect(volumeReadToolDefinition.parameters).toMatchObject({
      required: ['action', 'path'],
    });
  });

  test('preflight validates action and path', () => {
    const tool = createVolumeReadTool();
    expect(tool.preflight({ action: 'invalid', path: '/Volumes/a/b/c' })).toMatch(
      /action to be "read" or "list"/
    );
    expect(tool.preflight({ action: 'read', path: '/etc/passwd' })).toMatch(
      /only accesses Unity Catalog Volumes/
    );
    expect(tool.preflight({ action: 'read', path: '/Volumes/a/b/c/data.json' })).toBeNull();
  });

  test('reads file using fsImpl', async () => {
    const readFile = vi.fn(async (p: string) => `content of ${p}`);
    const readdir = vi.fn(async () => ['a.txt', 'b.csv']);
    const tool = createVolumeReadTool({ fsImpl: { readFile, readdir } });

    const content = await tool.execute({ action: 'read', path: '/Volumes/a/b/c/test.txt' });
    expect(content).toBe('content of /Volumes/a/b/c/test.txt');
    expect(readFile).toHaveBeenCalledWith('/Volumes/a/b/c/test.txt');

    const list = await tool.execute({ action: 'list', path: '/Volumes/a/b/c' });
    expect(list).toBe('a.txt\nb.csv');
    expect(readdir).toHaveBeenCalledWith('/Volumes/a/b/c');
  });

  test('returns error when action is invalid', async () => {
    const tool = createVolumeReadTool();
    const result = await tool.execute({ action: 'delete', path: '/Volumes/a/b/c' });
    expect(result).toMatch(/action must be "read" or "list"/);
  });
});
