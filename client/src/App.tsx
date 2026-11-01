import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PendingChoice } from '../../shared/chat/choice-notice';
import type { Bot, Chat, MarketplaceBot, Message, Space } from '../../shared/chat/types';
import type { ApprovalDecision, ApprovalRequest } from '../../shared/agents/types';
import { ApprovalCards } from './components/ApprovalCards';
import { ChoiceCards } from './components/ChoiceCards';
import { BotDetailsSheet } from './components/BotDetailsSheet';
import { botColor, markBotFresh, registerBotLooks } from './components/BotFace';
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
  fetchMarketplaceBots,
  fetchSpaces,
  installMarketplaceBot,
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
import { lastUserFacingPreview, toolLabel } from './lib/user-facing';
import type { Routine } from '../../shared/routines/types';

const DETAILS_WIDTH_KEY = 'bricksbot.detailsWidth';
const DETAILS_WIDTH_DEFAULT = 360;
const DETAILS_WIDTH_MIN = 280;
const DETAILS_WIDTH_MAX = 720;

function readDetailsWidth(): number {
  const raw = Number(localStorage.getItem(DETAILS_WIDTH_KEY));
  if (!Number.isFinite(raw)) return DETAILS_WIDTH_DEFAULT;
  return Math.min(DETAILS_WIDTH_MAX, Math.max(DETAILS_WIDTH_MIN, raw));
}

export default function App() {
  useMouseFollow();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [archivedBots, setArchivedBots] = useState<Bot[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [pendingChoices, setPendingChoices] = useState<PendingChoice[]>([]);
  const [autoApprovedTools, setAutoApprovedTools] = useState<string[]>([]);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [runningTool, setRunningTool] = useState<{
    label: string;
    startedAt: string;
  } | null>(null);
  const [choiceBusyId, setChoiceBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [marketplaceBots, setMarketplaceBots] = useState<MarketplaceBot[]>([]);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
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
  const [detailsWidth, setDetailsWidth] = useState<number>(() => readDetailsWidth());
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
  const handleDetailsWidthChange = useCallback((width: number) => {
    const next = Math.min(DETAILS_WIDTH_MAX, Math.max(DETAILS_WIDTH_MIN, Math.round(width)));
    setDetailsWidth(next);
    localStorage.setItem(DETAILS_WIDTH_KEY, String(next));
  }, []);

  function handleThemeChange(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }

  const rosterBots = [...bots, ...archivedBots];
  registerBotLooks(rosterBots);
  const selectedBot = rosterBots.find((bot) => bot.id === selectedBotId) ?? null;
  const accent = selectedBot ? botColor(selectedBot.id, selectedBot.isPrimary) : 'oklch(0.58 0.22 25)';
  const botRoutines = selectedBotId
    ? routines.filter((routine) => routine.botId === selectedBotId)
    : [];

  const syncPreviewsFromBots = useCallback((botsList: Bot[]) => {
    setPreviews((prev) => {
      const next = { ...prev };
      for (const bot of botsList) {
        if (bot.lastPreview !== undefined) {
          next[bot.id] = bot.lastPreview;
        }
      }
      return next;
    });
  }, []);

  const refreshRoster = useCallback(async () => {
    const [nextBots, nextArchived] = await Promise.all([
      fetchBots(undefined, 'active'),
      fetchBots(undefined, 'archived'),
    ]);
    setBots(nextBots);
    setArchivedBots(nextArchived);
    syncPreviewsFromBots([...nextBots, ...nextArchived]);
    return { nextBots, nextArchived };
  }, [syncPreviewsFromBots]);

  const refreshRoutines = useCallback(async () => {
    const next = await fetchRoutines();
    setRoutines(next);
    return next;
  }, []);

  const refreshMarketplace = useCallback(async () => {
    try {
      const list = await fetchMarketplaceBots();
      setMarketplaceBots(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (marketplaceOpen) {
      void refreshMarketplace();
    }
  }, [marketplaceOpen, refreshMarketplace]);

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
        syncPreviewsFromBots([...nextBots, ...nextArchived]);
        const nextSelected = nextBots.find((bot) => bot.isPrimary)?.id ?? nextBots[0]?.id ?? null;
        setSelectedBotId(nextSelected);
        if (nextSelected) await loadChat(nextSelected);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadChat, syncPreviewsFromBots]);

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

  async function handleCreateBot(
    name: string,
    spaceId: string | null,
    avatarLabel?: string,
    description?: string,
  ) {
    setError(null);
    try {
      const bot = await createBot({ name, spaceId, avatarLabel, description });
      markBotFresh(bot.id);
      await refreshRoster();
      setSelectedBotId(bot.id);
      setPreviews((prev) => ({ ...prev, [bot.id]: '' }));
      await loadChat(bot.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create bot');
    }
  }

  async function handleToggleShareBot(botId: string, isShared: boolean) {
    setError(null);
    try {
      await updateBot(botId, { isShared });
      await refreshRoster();
      if (marketplaceOpen) {
        await refreshMarketplace();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update bot sharing');
    }
  }

  async function handleUpdateBotConfig(
    botId: string,
    patch: { description?: string; isShared?: boolean },
  ) {
    setError(null);
    try {
      await updateBot(botId, patch);
      await refreshRoster();
      if (marketplaceOpen) {
        await refreshMarketplace();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update bot');
    }
  }

  async function handleInstallMarketplaceBot(botId: string, spaceId: string | null) {
    setError(null);
    try {
      const installed = await installMarketplaceBot(botId, spaceId);
      markBotFresh(installed.id);
      await refreshRoster();
      setSelectedBotId(installed.id);
      setPreviews((prev) => ({ ...prev, [installed.id]: '' }));
      await loadChat(installed.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to install marketplace bot');
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
    setBots((prev) => prev.map((bot) => (bot.id === botId ? { ...bot, avatarLabel } : bot)));
    setArchivedBots((prev) => prev.map((bot) => (bot.id === botId ? { ...bot, avatarLabel } : bot)));
    try {
      await updateBot(botId, { avatarLabel });
      await refreshRoster();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to change look');
      await refreshRoster();
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
    const optimisticMessage: Message = {
      id: optimisticId,
      chatId: chat.id,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);
    setBots((prev) => prev.map((bot) => (bot.id === selectedBotId ? { ...bot, presence: 'thinking' } : bot)));
    try {
      const result = await sendChatMessage(chat.id, content);
      setPendingApprovals(result.pendingApprovals);
      setPendingChoices(result.pendingChoices ?? []);
      if (result.autoApprovedTools) {
        setAutoApprovedTools(result.autoApprovedTools);
      }
      await loadChat(selectedBotId);
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
    const approval = pendingApprovals.find((item) => item.id === id) ?? null;
    const accepted = decision === 'once' || decision === 'all_the_time';
    setApprovalBusyId(id);
    setError(null);

    if (accepted && approval) {
      // Always allow clears the whole same-tool wave on the server — mirror that locally.
      setPendingApprovals((prev) =>
        decision === 'all_the_time'
          ? prev.filter((item) => item.toolCall.name !== approval.toolCall.name)
          : prev.filter((item) => item.id !== id),
      );
      setRunningTool({
        label: toolLabel(approval.toolCall.name),
        startedAt: new Date().toISOString(),
      });
      if (selectedBotId) {
        setBots((prev) =>
          prev.map((bot) => (bot.id === selectedBotId ? { ...bot, presence: 'working' } : bot)),
        );
      }
    }

    try {
      const result = await decideApproval(id, decision);
      setPendingApprovals(result.pendingApprovals);
      setPendingChoices(result.pendingChoices ?? []);
      if (result.autoApprovedTools) {
        setAutoApprovedTools(result.autoApprovedTools);
      }
      if (selectedBotId) await loadChat(selectedBotId);
      await refreshRoster();
    } catch (err) {
      if (accepted && approval) {
        setPendingApprovals((prev) =>
          prev.some((item) => item.id === approval.id) ? prev : [approval, ...prev],
        );
      }
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setRunningTool(null);
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
      await refreshRoster();
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
        marketplaceBots={marketplaceBots}
        previews={previews}
        selectedBotId={selectedBotId}
        createOpen={createOpen}
        marketplaceOpen={marketplaceOpen}
        theme={theme}
        onThemeChange={handleThemeChange}
        onCreateOpenChange={setCreateOpen}
        onMarketplaceOpenChange={setMarketplaceOpen}
        onSelectBot={handleSelectBot}
        onCreateBot={handleCreateBot}
        onInstallMarketplaceBot={handleInstallMarketplaceBot}
        onToggleShareBot={handleToggleShareBot}
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
              <span className="chat-pill-name">{selectedBot.name}</span>
              {detailsOpen ? (
                <ChevronLeft className="chat-pill-chevron" size={14} strokeWidth={2} aria-hidden />
              ) : (
                <ChevronRight className="chat-pill-chevron" size={14} strokeWidth={2} aria-hidden />
              )}
            </button>

          </div>
        ) : null}

        {error ? <p className="chat-error">{error}</p> : null}

        {loading ? (
          <div className="chat-loading">Loading</div>
        ) : (
          <>
            <ChatTranscript
              thinking={
                Boolean(runningTool) ||
                selectedBot?.presence === 'thinking' ||
                selectedBot?.presence === 'working'
              }
              thinkingLabel={
                runningTool
                  ? `Running ${runningTool.label}`
                  : selectedBot?.presence === 'working'
                    ? 'Working'
                    : 'Thinking'
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
                disabled={
                  !chat ||
                  pendingApprovals.length > 0 ||
                  pendingChoices.length > 0 ||
                  Boolean(runningTool)
                }
                placeholder={
                  runningTool
                    ? `Running ${runningTool.label}…`
                    : selectedBot
                      ? `Message ${selectedBot.name}`
                      : 'Message'
                }
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
          autoApprovedTools={autoApprovedTools}
          onRevokeAutoApproval={handleRevokeAutoApproval}
          width={detailsWidth}
          minWidth={DETAILS_WIDTH_MIN}
          maxWidth={DETAILS_WIDTH_MAX}
          onWidthChange={handleDetailsWidthChange}
          onCreateRoutine={handleCreateRoutine}
          onUpdateRoutine={handleUpdateRoutine}
          onRunRoutine={handleRunRoutine}
          onDeleteRoutine={handleDeleteRoutine}
          onStopSandbox={handleStopSandbox}
          onDeleteSandbox={handleDeleteSandbox}
          onClose={closeDetails}
          onChangeLook={handleChangeLook}
          onUpdateBotConfig={handleUpdateBotConfig}
        />
      ) : null}
    </div>
  );
}
