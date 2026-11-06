/** Import a SKILL.md (Agent Skills format) from GitHub into a bot skill. */

const MAX_SKILL_CHARS = 32_000;
const FETCH_TIMEOUT_MS = 15_000;
const ALLOWED_HOSTS = new Set(['raw.githubusercontent.com', 'github.com']);

export interface ImportedSkill {
  name: string;
  body: string;
}

/** Convert github.com blob URLs to raw URLs; reject anything outside GitHub over HTTPS. */
export function toRawSkillUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error('Skill URL is required');
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('Skill URL must be an https GitHub link (github.com or raw.githubusercontent.com)');
  }
  if (parsed.hostname.toLowerCase() === 'github.com') {
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
    if (!match) throw new Error('Skill URL must point to a file, e.g. github.com/org/repo/blob/main/skill/SKILL.md');
    return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`;
  }
  return parsed.toString();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Name from `name:` frontmatter, else parent folder of the file URL. */
export function deriveSkillName(text: string, rawUrl: string): string {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fromFront = front?.[1].match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1];
  if (fromFront && slugify(fromFront)) return slugify(fromFront);
  const segments = new URL(rawUrl).pathname.split('/').filter(Boolean);
  const file = segments.pop() ?? '';
  const folder = /^skill\.md$/i.test(file) ? segments.pop() : file.replace(/\.md$/i, '');
  const slug = slugify(folder ?? '');
  if (!slug) throw new Error('Skill name is required (add `name:` frontmatter)');
  return slug;
}

export async function importSkillFromUrl(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<ImportedSkill> {
  const rawUrl = toRawSkillUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(rawUrl, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'text/plain' },
    });
    if (!response.ok) throw new Error(`Could not fetch skill (${response.status})`);
    const text = (await response.text()).trim();
    if (!text) throw new Error('Skill body is required');
    if (text.length > MAX_SKILL_CHARS) {
      throw new Error(`Skill is too large (max ${MAX_SKILL_CHARS} characters)`);
    }
    return { name: deriveSkillName(text, rawUrl), body: text };
  } finally {
    clearTimeout(timer);
  }
}
