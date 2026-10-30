import { useCallback, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { PendingChoice } from '../../shared/chat/choice-notice';
import type { Bot, Chat, Message, Space } from '../../shared/chat/types';
import type { ApprovalDecision, ApprovalRequest } from '../../shared/agents/types';
import { ApprovalCards } from './components/ApprovalCards';
import { ChoiceCards } from './components/ChoiceCards';
import { BotDetailsSheet } from './components/BotDetailsSheet';
import { BotFace, botColor, markBotFresh, registerBotLooks } from './components/BotFace';
import { useMouseFollow } from './components/BotPicker';
import { BotRoster } from './components/BotRoster';
import { ChatComposer } from './components/ChatComposer';
import { ChatTranscript } from './components/ChatTranscript';
import {
  archiveBot,
  createBot,
  createSpace,
  decideApproval,
  deleteBot,
  deleteBotSandbox,
  fetchBotChat,
  fetchBots,
  fetchSpaces,
  moveBot,
  revokeAutoApproval,
  sendChatMessage,
  stopBotSandbox,
  submitChoice,
  unarchiveBot,
  updateBot,
} from './lib/chat-api';
import type { SandboxUiStatus } from '../../shared/sandbox/types';
import {
  createRoutine,
  deleteRoutine,
  fetchRoutines,
  runRoutine,
  updateRoutine,
} from './lib/routines-api';
import { applyTheme, readStoredTheme, type Theme } from './lib/theme';
import {
  lastUserFacingPreview,
  presenceTooltip,
  rosterPreviewForPresence,
  toolLabel,
} from './lib/user-facing';
import type { Routine } from '../../shared/routines/types';

export default function App() {
  useMouseFollow();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  registerBotLooks(bots);
  const [archivedBots, setArchivedBots] = useState<Bot[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [pendingChoices, setPendingChoices] = useState<PendingChoice[]>([]);
  const [autoApprovedTools, setAutoApprovedTools] = useState<string[]>([]);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [choiceBusyId, setChoiceBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineBusyId, setRoutineBusyId] = useState<string | null>(null);
  const [lastWebhookSecret, setLastWebhookSecret] = useState<string | null>(null);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxUiStatus | null>(null);
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState<boolean>(
    () => localStorage.getItem('bricksbot.detailsOpen') === '1',
  );
  const toggleDetails = useCallback(() => {
    setDetailsOpen((open) => {
      localStorage.setItem('bricksbot.detailsOpen', open ? '0' : '1');
      return !open;
    });
  }, []);
  const closeDetails = useCallback(() => {
    setDetailsOpen(false);
    localStorage.setItem('bricksbot.detailsOpen', '0');
  }, []);

  function handleThemeChange(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }

  const rosterBots = [...bots, ...archivedBots];
  const selectedBot = rosterBots.find((bot) => bot.id === selectedBotId) ?? null;
  const accent = selectedBot ? botColor(selectedBot.id, selectedBot.isPrimary) : 'oklch(0.58 0.22 25)';
  const botRoutines = selectedBotId
    ? routines.filter((routine) => routine.botId === selectedBotId)
    : [];

  const refreshRoster = useCallback(async () => {
    const [nextBots, nextArchived] = await Promise.all([
      fetchBots(undefined, 'active'),
      fetchBots(undefined, 'archived'),
    ]);
    setBots(nextBots);
    setArchivedBots(nextArchived);
    return { nextBots, nextArchived };
  }, []);

  const refreshRoutines = useCallback(async () => {
    const next = await fetchRoutines();
    setRoutines(next);
    return next;
  }, []);

  const loadChat = useCallback(async (botId: string) => {
    const data = await fetchBotChat(botId);
    setChat(data.chat);
    setMessages(data.messages);
    setPendingApprovals(data.pendingApprovals);
    setPendingChoices(data.pendingChoices ?? []);
    setAutoApprovedTools(data.autoApprovedTools ?? []);
    setSandboxStatus(data.sandboxStatus ?? null);
    setPreviews((prev) => ({ ...prev, [botId]: lastUserFacingPreview(data.messages) }));
  }, []);

  const hydratePreviews = useCallback((nextBots: Bot[]) => {
    void Promise.all(
      nextBots.map(async (bot) => {
        try {
          const data = await fetchBotChat(bot.id);
          return [bot.id, lastUserFacingPreview(data.messages)] as const;
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
        const [nextSpaces, nextBots, nextArchived, nextRoutines] = await Promise.all([
          fetchSpaces(),
          fetchBots(undefined, 'active'),
          fetchBots(undefined, 'archived'),
          fetchRoutines().catch(() => [] as Routine[]),
        ]);
        if (cancelled) return;
        setSpaces(nextSpaces);
        setBots(nextBots);
        setArchivedBots(nextArchived);
        setRoutines(nextRoutines);
        const nextSelected = nextBots.find((bot) => bot.isPrimary)?.id ?? nextBots[0]?.id ?? null;
        setSelectedBotId(nextSelected);
        if (nextSelected) await loadChat(nextSelected);
        hydratePreviews([...nextBots, ...nextArchived]);
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

  async function handleCreateSpace(name: string): Promise<string | void> {
    setError(null);
    try {
      const space = await createSpace(name);
      setSpaces((prev) => [...prev, space]);
      return space.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create section');
    }
  }

  async function handleCreateBot(name: string, spaceId: string | null, avatarLabel?: string) {
    setError(null);
    try {
      const bot = await createBot({ name, spaceId, avatarLabel });
      markBotFresh(bot.id);
      await refreshRoster();
      setSelectedBotId(bot.id);
      setPreviews((prev) => ({ ...prev, [bot.id]: '' }));
      await loadChat(bot.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create bot');
    }
  }

  async function handleRenameBot(botId: string, name: string) {
    setError(null);
    try {
      await updateBot(botId, { name });
      await refreshRoster();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rename bot');
    }
  }

  async function handleChangeLook(botId: string, avatarLabel: string) {
    setError(null);
    try {
      await updateBot(botId, { avatarLabel });
      await refreshRoster();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to change look');
    }
  }

  async function handleMoveBot(botId: string, spaceId: string | null, index: number) {
    setError(null);
    try {
      await moveBot(botId, { spaceId, index });
      await refreshRoster();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to move bot');
    }
  }

  async function handleArchiveBot(botId: string) {
    setError(null);
    try {
      await archiveBot(botId);
      const { nextBots } = await refreshRoster();
      if (selectedBotId === botId) {
        const fallback = nextBots.find((bot) => bot.isPrimary)?.id ?? nextBots[0]?.id ?? null;
        setSelectedBotId(fallback);
        if (fallback) await loadChat(fallback);
        else {
          setChat(null);
          setMessages([]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive bot');
    }
  }

  async function handleUnarchiveBot(botId: string) {
    setError(null);
    try {
      await unarchiveBot(botId);
      await refreshRoster();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to restore bot');
    }
  }

  async function handleDeleteBot(botId: string) {
    setError(null);
    try {
      await deleteBot(botId);
      const { nextBots } = await refreshRoster();
      if (selectedBotId === botId) {
        const fallback = nextBots.find((bot) => bot.isPrimary)?.id ?? nextBots[0]?.id ?? null;
        setSelectedBotId(fallback);
        if (fallback) await loadChat(fallback);
        else {
          setChat(null);
          setMessages([]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete bot');
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
      setPendingChoices(result.pendingChoices ?? []);
      if (result.autoApprovedTools) {
        setAutoApprovedTools(result.autoApprovedTools);
      }
      // Reload full history so handoff/tool/system rows from the turn appear.
      await loadChat(selectedBotId);
      // Server sets waiting when approvals/choices are pending — don't force online.
      await refreshRoster();
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setError(err instanceof Error ? err.message : 'Unable to send message');
      setBots((prev) => prev.map((bot) => (bot.id === selectedBotId ? { ...bot, presence: 'online' } : bot)));
      throw err;
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
      setPendingChoices(result.pendingChoices ?? []);
      if (result.autoApprovedTools) {
        setAutoApprovedTools(result.autoApprovedTools);
      }
      if (selectedBotId) await loadChat(selectedBotId);
      const { nextBots } = await refreshRoster();
      hydratePreviews(nextBots);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setApprovalBusyId(null);
    }
  }

  async function handleSelectChoice(choiceId: string, selectedOption: string) {
    if (!chat) return;
    setChoiceBusyId(choiceId);
    setError(null);
    try {
      const result = await submitChoice(chat.id, choiceId, selectedOption);
      setPendingApprovals(result.pendingApprovals);
      setPendingChoices(result.pendingChoices ?? []);
      if (result.autoApprovedTools) {
        setAutoApprovedTools(result.autoApprovedTools);
      }
      if (selectedBotId) await loadChat(selectedBotId);
      const { nextBots } = await refreshRoster();
      hydratePreviews(nextBots);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Choice failed');
    } finally {
      setChoiceBusyId(null);
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

  async function handleCreateRoutine(input: {
    botId: string;
    name: string;
    cron: string;
    prompt: string;
  }) {
    setError(null);
    try {
      const result = await createRoutine(input);
      setLastWebhookSecret(result.webhookSecret);
      await refreshRoutines();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create routine');
    }
  }

  async function handleUpdateRoutine(
    id: string,
    patch: { name?: string; cron?: string; prompt?: string; enabled?: boolean },
  ) {
    setError(null);
    try {
      await updateRoutine(id, patch);
      await refreshRoutines();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update routine');
    }
  }

  async function handleRunRoutine(id: string) {
    setRoutineBusyId(id);
    setError(null);
    try {
      await runRoutine(id);
      await refreshRoutines();
      if (selectedBotId) await loadChat(selectedBotId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Routine run failed');
    } finally {
      setRoutineBusyId(null);
    }
  }

  async function handleDeleteRoutine(id: string) {
    setRoutineBusyId(id);
    setError(null);
    try {
      await deleteRoutine(id);
      await refreshRoutines();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete routine');
    } finally {
      setRoutineBusyId(null);
    }
  }

  async function handleStopSandbox() {
    if (!selectedBotId) return;
    setSandboxBusy(true);
    setError(null);
    try {
      const next = await stopBotSandbox(selectedBotId);
      setSandboxStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to stop sandbox');
    } finally {
      setSandboxBusy(false);
    }
  }

  async function handleDeleteSandbox() {
    if (!selectedBotId) return;
    setSandboxBusy(true);
    setError(null);
    try {
      const next = await deleteBotSandbox(selectedBotId);
      setSandboxStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete sandbox');
    } finally {
      setSandboxBusy(false);
    }
  }

  const visibleMessages = messages;

  return (
    <div className="app-shell">
      <BotRoster
        spaces={spaces}
        bots={bots}
        archivedBots={archivedBots}
        previews={previews}
        selectedBotId={selectedBotId}
        createOpen={createOpen}
        theme={theme}
        onThemeChange={handleThemeChange}
        onCreateOpenChange={setCreateOpen}
        onSelectBot={handleSelectBot}
        onCreateBot={handleCreateBot}
        onCreateSpace={handleCreateSpace}
        onRenameBot={handleRenameBot}
        onChangeLook={handleChangeLook}
        onMoveBot={handleMoveBot}
        onArchiveBot={handleArchiveBot}
        onUnarchiveBot={handleUnarchiveBot}
        onDeleteBot={handleDeleteBot}
      />

      <section className="chat-pane" aria-label={selectedBot ? `Chat with ${selectedBot.name}` : 'Chat'}>
        {selectedBot ? (
          <div className="chat-heading">
            <button
              type="button"
              className={detailsOpen ? 'chat-pill is-open' : 'chat-pill'}
              aria-pressed={detailsOpen}
              aria-label={
                detailsOpen
                  ? `Hide details for ${selectedBot.name}`
                  : `Show details for ${selectedBot.name}`
              }
              onClick={(event) => {
                // Details pane is md+ only; keep the pill as identity chrome on narrow screens.
                if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
                  event.preventDefault();
                  return;
                }
                toggleDetails();
              }}
            >
              <BotFace
                color={accent}
                size={26}
                botId={selectedBot.id}
                track
                presence={selectedBot.presence}
              />
              <span className="chat-pill-copy">
                <span className="chat-pill-name">{selectedBot.name}</span>
                <span className="chat-pill-preview" aria-hidden="true">
                  {rosterPreviewForPresence(
                    selectedBot.presence,
                    previews[selectedBot.id] ?? '',
                  ) || presenceTooltip(selectedBot.presence)}
                </span>
              </span>
              <ChevronRight className="chat-pill-chevron" size={14} strokeWidth={2} aria-hidden />
            </button>

            {autoApprovedTools.length > 0 ? (
              <div className="auto-approvals-bar" role="status" aria-label="Active auto-approvals">
                <span className="auto-approvals-title">Auto-approved:</span>
                <div className="auto-approvals-chips">
                  {autoApprovedTools.map((tool) => (
                    <span key={tool} className="auto-tool-chip">
                      <span>{toolLabel(tool)}</span>
                      <button
                        type="button"
                        aria-label={`Revoke auto-approval for ${toolLabel(tool)}`}
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
              thinking={
                selectedBot?.presence === 'thinking' || selectedBot?.presence === 'working'
              }
              messages={visibleMessages}
              botName={selectedBot?.name ?? null}
              accent={accent}
              botId={selectedBot?.id}
              bots={rosterBots}
              onOpenBot={(botId) => void handleSelectBot(botId)}
            />
            <ApprovalCards approvals={pendingApprovals} busyId={approvalBusyId} onDecide={handleDecide} />
            {/* CHOICE_CARDS — pending ask_choice prompts (below approvals, above composer) */}
            <ChoiceCards
              chatId={chat?.id ?? null}
              choices={pendingChoices}
              busyId={choiceBusyId}
              onSelect={handleSelectChoice}
            />
            <div className="composer-wrap">
              <ChatComposer
                disabled={!chat || pendingApprovals.length > 0 || pendingChoices.length > 0}
                placeholder={selectedBot ? `Message ${selectedBot.name}` : 'Message'}
                accent={accent}
                onSend={handleSend}
              />
            </div>
          </>
        )}
      </section>

      {selectedBot && detailsOpen ? (
        <BotDetailsSheet
          bot={selectedBot}
          messages={visibleMessages}
          routines={botRoutines}
          routineBusyId={routineBusyId}
          lastWebhookSecret={lastWebhookSecret}
          sandboxStatus={sandboxStatus}
          sandboxBusy={sandboxBusy}
          onCreateRoutine={handleCreateRoutine}
          onUpdateRoutine={handleUpdateRoutine}
          onRunRoutine={handleRunRoutine}
          onDeleteRoutine={handleDeleteRoutine}
          onStopSandbox={handleStopSandbox}
          onDeleteSandbox={handleDeleteSandbox}
          onClose={closeDetails}
        />
      ) : null}
    </div>
  );
}
