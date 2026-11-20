import { describe, expect, test } from 'vitest';
import { buildPreview } from './preview.js';
import { validateAttachment } from './validate.js';

const bytes = (text: string | number[]) => Buffer.from(text as string);

describe('validateAttachment', () => {
  test('accepts a csv, pdf, xlsx and xls whose bytes agree with the extension', () => {
    expect(validateAttachment('sales.csv', bytes('a,b\n1,2\n'))).toEqual({ ok: true, kind: 'csv' });
    expect(validateAttachment('sales.TSV', bytes('a\tb\n'))).toEqual({ ok: true, kind: 'csv' });
    expect(validateAttachment('report.pdf', bytes('%PDF-1.7\n'))).toEqual({ ok: true, kind: 'pdf' });
    expect(validateAttachment('book.xlsx', bytes('PK\x03\x04rest'))).toEqual({ ok: true, kind: 'excel' });
    expect(validateAttachment('old.xls', bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]))).toEqual({
      ok: true,
      kind: 'excel',
    });
  });

  test.each([
    ['page.html', '<html><script>alert(1)</script>'],
    ['logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['tool.exe', 'MZ\x90\x00'],
    ['noextension', 'a,b'],
    ['archive.zip', 'PK\x03\x04'],
  ])('refuses %s', (name, content) => {
    expect(validateAttachment(name, bytes(content)).ok).toBe(false);
  });

  test('refuses files that only wear an allowed extension', () => {
    expect(validateAttachment('page.csv', bytes('  <!doctype html><html>')).ok).toBe(false);
    expect(validateAttachment('logo.csv', bytes('<svg/>')).ok).toBe(false);
    expect(validateAttachment('tool.csv', bytes('MZ\x00\x01\x02')).ok).toBe(false);
    expect(validateAttachment('tool.pdf', bytes('MZ\x90\x00')).ok).toBe(false);
    expect(validateAttachment('book.xlsx', bytes('%PDF-1.7')).ok).toBe(false);
    expect(validateAttachment('book.xls', bytes('PK\x03\x04')).ok).toBe(false);
    expect(validateAttachment('empty.csv', bytes('')).ok).toBe(false);
  });
});

describe('buildPreview', () => {
  test('keeps a csv header and its first five rows', () => {
    const csv = ['id,name', ...Array.from({ length: 20 }, (_, i) => `${i + 1},row${i + 1}`)].join('\n');
    expect(buildPreview('csv', bytes(String.fromCharCode(0xfeff) + csv))?.split('\n')).toEqual([
      'id,name',
      '1,row1',
      '2,row2',
      '3,row3',
      '4,row4',
      '5,row5',
    ]);
  });

  test('has none for binary kinds', () => {
    expect(buildPreview('pdf', bytes('%PDF-1.7'))).toBeUndefined();
    expect(buildPreview('excel', bytes('PK\x03\x04'))).toBeUndefined();
  });
});
