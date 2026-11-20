import { ATTACHMENT_EXTENSIONS, attachmentKindFor, type AttachmentKind } from '../../shared/chat/attachments.js';

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const startsWith = (head: Uint8Array, magic: Uint8Array | string) =>
  Buffer.from(head).subarray(0, magic.length).equals(Buffer.from(magic));

/** Text that is really markup (HTML, SVG, XML) would render if it were ever served inline. */
function looksLikeMarkup(head: Uint8Array): boolean {
  return Buffer.from(head)
    .subarray(0, 512)
    .toString('utf8')
    .replace(/^\ufeff/, '')
    .trimStart()
    .startsWith('<');
}

/** The extension picks the kind; the leading bytes must agree, so a renamed .exe or .html is refused. */
export function validateAttachment(
  fileName: string,
  head: Uint8Array
): { ok: true; kind: AttachmentKind } | { ok: false; error: string } {
  const kind = attachmentKindFor(fileName);
  if (!kind) {
    return { ok: false, error: `Unsupported file type. Allowed: ${Object.keys(ATTACHMENT_EXTENSIONS).join(', ')}` };
  }
  if (head.length === 0) return { ok: false, error: 'The file is empty' };

  const extension = fileName.split('.').pop()!.toLowerCase();
  const matches =
    kind === 'pdf'
      ? startsWith(head, '%PDF-')
      : kind === 'excel'
        ? startsWith(head, extension === 'xls' ? OLE_MAGIC : 'PK\x03\x04')
        : !head.includes(0) && !looksLikeMarkup(head) && !startsWith(head, 'PK\x03\x04') && !startsWith(head, '%PDF-');
  return matches ? { ok: true, kind } : { ok: false, error: `The contents do not look like a .${extension} file` };
}
