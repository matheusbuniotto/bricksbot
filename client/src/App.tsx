import { useCallback, useEffect, useState } from 'react';
import type { Bot, Chat, Message, Space } from '../../shared/chat/types';
import type { ApprovalDecision, ApprovalRequest } from '../../shared/llm/types';
import { ApprovalCards } from './components/ApprovalCards';
import { BotFace, botColor } from './components/BotFace';
import { BotRoster } from './components/BotRoster';
import { ChatComposer } from './components/ChatComposer';
import { ChatTranscript } from './components/ChatTranscript';
import {
  createBot,
  createSpace,
  decideApproval,
  fetchBotChat,
  fetchBots,
  fetchSpaces,
  revokeAutoApproval,
  sendChatMessage,
} from './lib/chat-api';
import { applyTheme, readStoredTheme, type Theme } from './lib/theme';

function lastPreview(messages: Message[]): string {
  const last = [...messages].reverse().find((message) => message.role !== 'tool');
  return last?.content ?? '';
}

export default function App() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [autoApprovedTools, setAutoApprovedTools] = useState<string[]>([]);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function handleThemeChange(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }

  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? null;
  const accent = selectedBot ? botColor(selectedBot.id, selectedBot.isPrimary) : 'oklch(0.58 0.22 25)';

  const loadChat = useCallback(async (botId: string) => {
    const data = await fetchBotChat(botId);
    setChat(data.chat);
    setMessages(data.messages);
    setPendingApprovals(data.pendingApprovals);
    setAutoApprovedTools(data.autoApprovedTools ?? []);
    setPreviews((prev) => ({ ...prev, [botId]: lastPreview(data.messages) }));
  }, []);

  const hydratePreviews = useCallback((nextBots: Bot[]) => {
    void Promise.all(
      nextBots.map(async (bot) => {
        try {
          const data = await fetchBotChat(bot.id);
          return [bot.id, lastPreview(data.messages)] as const;
        } catch {
          return [bot.id, ''] as const;
        }
      })
    ).then((entries) => {
      setPreviews((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextSpaces, nextBots] = await Promise.all([fetchSpaces(), fetchBots()]);
        if (cancelled) return;
        setSpaces(nextSpaces);
        setBots(nextBots);
        const nextSelected = nextBots.find((bot) => bot.isPrimary)?.id ?? nextBots[0]?.id ?? null;
        setSelectedBotId(nextSelected);
        if (nextSelected) await loadChat(nextSelected);
        hydratePreviews(nextBots);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydratePreviews, loadChat]);

  async function handleSelectBot(botId: string) {
    setSelectedBotId(botId);
    setError(null);
    try {
      await loadChat(botId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open chat');
    }
  }

  async function handleCreateSpace(name: string) {
    setError(null);
    try {
      const space = await createSpace(name);
      setSpaces((prev) => [...prev, space]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create section');
    }
  }

  async function handleCreateBot(name: string, spaceId: string) {
    setError(null);
    try {
      const bot = await createBot({ name, spaceId });
      const nextBots = await fetchBots();
      setBots(nextBots);
      setSelectedBotId(bot.id);
      setPreviews((prev) => ({ ...prev, [bot.id]: '' }));
      await loadChat(bot.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create bot');
    }
  }

  async function handleSend(content: string) {
    if (!chat || !selectedBotId) return;
    setError(null);
    const optimisticId = `pending-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, chatId: chat.id, role: 'user', content, createdAt: new Date().toISOString() } as unknown as Message,
    ]);
    setBots((prev) => prev.map((bot) => (bot.id === selectedBotId ? { ...bot, presence: 'thinking' } : bot)));
    try {
      const result = await sendChatMessage(chat.id, content);
      setPendingApprovals(result.pendingApprovals);
      if (result.autoApprovedTools) {
        setAutoApprovedTools(result.autoApprovedTools);
      }
      // Reload full history so handoff/tool/system rows from the turn appear.
      await loadChat(selectedBotId);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setError(err instanceof Error ? err.message : 'Unable to send message');
      throw err;
    } finally {
      setBots((prev) => prev.map((bot) => (bot.id === selectedBotId ? { ...bot, presence: 'online' } : bot)));
    }
  }

  async function handleDecide(
    id: string,
    decision: ApprovalDecision
  ) {
    setApprovalBusyId(id);
    setError(null);
    try {
      const result = await decideApproval(id, decision);
      setPendingApprovals(result.pendingApprovals);
      if (result.autoApprovedTools) {
        setAutoApprovedTools(result.autoApprovedTools);
      }
      if (selectedBotId) await loadChat(selectedBotId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setApprovalBusyId(null);
    }
  }

  async function handleRevokeAutoApproval(toolName?: string) {
    if (!chat) return;
    try {
      const result = await revokeAutoApproval(chat.id, toolName);
      setAutoApprovedTools(result.autoApprovedTools);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke auto-approval');
    }
  }

  const visibleMessages = messages;

  return (
    <div className="app-shell">
      <BotRoster
        spaces={spaces}
        bots={bots}
        previews={previews}
        selectedBotId={selectedBotId}
        createOpen={createOpen}
        theme={theme}
        onThemeChange={handleThemeChange}
        onCreateOpenChange={setCreateOpen}
        onSelectBot={handleSelectBot}
        onCreateBot={handleCreateBot}
        onCreateSpace={handleCreateSpace}
      />

      <section className="chat-pane" aria-label={selectedBot ? `Chat with ${selectedBot.name}` : 'Chat'}>
        {selectedBot ? (
          <div className="chat-heading">
            <div className="chat-pill">
              <BotFace color={accent} size={26} />
              <span>{selectedBot.name}</span>
            </div>

            {autoApprovedTools.length > 0 ? (
              <div className="auto-approvals-bar" role="status" aria-label="Active auto-approvals">
                <span className="auto-approvals-title">Auto-approved:</span>
                <div className="auto-approvals-chips">
                  {autoApprovedTools.map((tool) => (
                    <span key={tool} className="auto-tool-chip">
                      <code>{tool}</code>
                      <button
                        type="button"
                        aria-label={`Revoke auto-approval for ${tool}`}
                        onClick={() => void handleRevokeAutoApproval(tool)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="chat-error">{error}</p> : null}

        {loading ? (
          <div className="chat-loading">Loading</div>
        ) : (
          <>
            <ChatTranscript
              thinking={selectedBot?.presence === 'thinking'}
              messages={visibleMessages}
              botName={selectedBot?.name ?? null}
              accent={accent}
              bots={bots}
              onOpenBot={(botId) => void handleSelectBot(botId)}
            />
            <ApprovalCards approvals={pendingApprovals} busyId={approvalBusyId} onDecide={handleDecide} />
            <div className="composer-wrap">
              <ChatComposer
                disabled={!chat || pendingApprovals.length > 0}
                placeholder={selectedBot ? `Message ${selectedBot.name}` : 'Message'}
                accent={accent}
                onSend={handleSend}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
