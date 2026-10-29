import { Button } from '@databricks/appkit-ui/react';
import { useState, type FormEvent } from 'react';
import type { BotMemory, BotSkill } from '../../../shared/memory/types';

const fieldClass =
  'w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function MemoryPanel({
  botId,
  botName,
  memories,
  skills,
  onSaveMemory,
  onCreateSkill,
  onDeleteSkill,
}: {
  botId: string | null;
  botName: string | null;
  memories: BotMemory[];
  skills: BotSkill[];
  onSaveMemory: (key: string, content: string) => Promise<void>;
  onCreateSkill: (name: string, body: string) => Promise<void>;
  onDeleteSkill: (skillId: string) => Promise<void>;
}) {
  const [memoryKey, setMemoryKey] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [skillName, setSkillName] = useState('');
  const [skillBody, setSkillBody] = useState('');
  const [savingMemory, setSavingMemory] = useState(false);
  const [savingSkill, setSavingSkill] = useState(false);

  async function handleSaveMemory(event: FormEvent) {
    event.preventDefault();
    if (!botId || !memoryKey.trim() || !memoryContent.trim()) return;
    setSavingMemory(true);
    try {
      await onSaveMemory(memoryKey.trim(), memoryContent.trim());
    } finally {
      setSavingMemory(false);
    }
  }

  async function handleCreateSkill(event: FormEvent) {
    event.preventDefault();
    if (!botId || !skillName.trim() || !skillBody.trim()) return;
    setSavingSkill(true);
    try {
      await onCreateSkill(skillName.trim(), skillBody.trim());
      setSkillName('');
      setSkillBody('');
    } finally {
      setSavingSkill(false);
    }
  }

  return (
    <div className="border-b border-border/80 px-4 md:px-6 py-3 shrink-0 max-h-64 overflow-y-auto">
      <p className="text-xs text-muted-foreground mb-3">
        {botName
          ? `${botName} remembers these facts and skills on the next reply.`
          : 'Select a bot to edit memory and skills.'}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Memory</p>
          <form className="space-y-2" onSubmit={handleSaveMemory}>
            <input
              aria-label="Memory key"
              value={memoryKey}
              onChange={(event) => setMemoryKey(event.target.value)}
              placeholder="Key"
              disabled={!botId}
              className={fieldClass}
            />
            <textarea
              aria-label="Memory content"
              value={memoryContent}
              onChange={(event) => setMemoryContent(event.target.value)}
              placeholder="What this bot should remember"
              rows={2}
              disabled={!botId}
              className={`${fieldClass} resize-none`}
            />
            <Button type="submit" size="sm" disabled={!botId || savingMemory}>
              {savingMemory ? 'Saving…' : 'Save memory'}
            </Button>
          </form>
          <ul className="space-y-1">
            {memories.length === 0 ? (
              <li className="text-xs text-muted-foreground">No memories yet.</li>
            ) : (
              memories.map((memory) => (
                <li key={memory.id}>
                  <button
                    type="button"
                    className="w-full text-left text-xs truncate rounded px-1 py-0.5 hover:bg-muted"
                    onClick={() => {
                      setMemoryKey(memory.key);
                      setMemoryContent(memory.content);
                    }}
                  >
                    <span className="font-medium">{memory.key}</span>
                    <span className="text-muted-foreground"> · {memory.content}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Skills</p>
          <form className="space-y-2" onSubmit={handleCreateSkill}>
            <input
              aria-label="Skill name"
              value={skillName}
              onChange={(event) => setSkillName(event.target.value)}
              placeholder="Skill name"
              disabled={!botId}
              className={fieldClass}
            />
            <textarea
              aria-label="Skill body"
              value={skillBody}
              onChange={(event) => setSkillBody(event.target.value)}
              placeholder="Markdown instructions for this bot"
              rows={2}
              disabled={!botId}
              className={`${fieldClass} resize-none`}
            />
            <Button type="submit" size="sm" disabled={!botId || savingSkill}>
              {savingSkill ? 'Adding…' : 'Add skill'}
            </Button>
          </form>
          <ul className="space-y-1">
            {skills.length === 0 ? (
              <li className="text-xs text-muted-foreground">No skills yet.</li>
            ) : (
              skills.map((skill) => (
                <li key={skill.id} className="flex items-start justify-between gap-2">
                  <p className="text-xs min-w-0">
                    <span className="font-medium">{skill.name}</span>
                    <span className="block truncate text-muted-foreground">{skill.body}</span>
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete skill ${skill.name}`}
                    onClick={() => void onDeleteSkill(skill.id)}
                  >
                    Delete
                  </Button>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
