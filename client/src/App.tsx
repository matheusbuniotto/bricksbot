import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, History, Search, SquarePen } from 'lucide-react';
import type { PendingChoice } from '../../shared/chat/choice-notice';
import type { Bot, Chat, MarketplaceBot, Message, SearchHit, Space } from '../../shared/chat/types';
import type { ApprovalDecision, ApprovalRequest } from '../../shared/agents/types';
import type { AttachmentConfig, AttachmentRef } from '../../shared/chat/attachments';
import { ApprovalCards } from './components/ApprovalCards';
import { ChoiceCards } from './components/ChoiceCards';
import { BotDetailsSheet } from './components/BotDetailsSheet';
import type { RoutineUpdatePatch } from './components/RoutinesPanel';
import { botColor, markBotFresh, registerBotLooks } from './components/BotFace';
import { useMouseFollow } from './components/BotPicker';
import { BotRoster } from './components/BotRoster';
import { ChatComposer } from './components/ChatComposer';
import { ChatHistory } from './components/ChatHistory';
import { ChatSearch } from './components/ChatSearch';
import { ChatTranscript } from './components/ChatTranscript';
import {
  archiveBot,
  archiveChat,
  createBot,
  createChat,
  createSpace,
  decideApproval,
  deleteBot,
  deleteBotSandbox,
  fetchBotChat,
  fetchBots,
  fetchChat,
  fetchChats,
  fetchMarketplaceBots,
  fetchSpaces,
  installMarketplaceBot,
  moveBot,
  renameChat,
  revokeAutoApproval,
  sendChatMessage,
  stopActiveRun,
  stopBotSandbox,
  submitChoice,
  unarchiveBot,
  updateBot,
  fetchModels,
  type ModelCatalogView,
  type RunOutcome,
  type RunUpdate,
} from './lib/chat-api';
import type { SandboxUiStatus } from '../../shared/sandbox/types';
import { fetchAttachmentConfig } from './lib/attachments-api';
import { createRoutine, deleteRoutine, fetchRoutines, runRoutine, updateRoutine } from './lib/routines-api';
import { applyTheme, readStoredTheme, type Theme } from './lib/theme';
import { chatRoute, parseChatRoute } from './lib/chat-route';
import { newestTicket } from './lib/newest-ticket';
import { isWaitingOnYou } from './lib/waiting-on-you';
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
  const [chats, setChats] = useState<Chat[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // The chat on screen, readable from async work that started before the user moved to another one.
  const chatRef = useRef<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [pendingChoices, setPendingChoices] = useState<PendingChoice[]>([]);
  const [autoApprovedTools, setAutoApprovedTools] = useState<string[]>([]);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  // What the run in progress shows before its messages are saved: streaming text and tool rows.
  const [live, setLive] = useState<{
    chatId: string;
    text: string;
    tools: Array<{ id: string; label: string; done: boolean }>;
  } | null>(null);
  const [runningTool, setRunningTool] = useState<{
    label: string;
    startedAt: string;
  } | null>(null);
  const [choiceBusyId, setChoiceBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [marketplaceBots, setMarketplaceBots] = useState<MarketplaceBot[]>([]);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogView | null>(null);
  const [attachmentConfig, setAttachmentConfig] = useState<AttachmentConfig | null>(null);
  const [routineBusyId, setRoutineBusyId] = useState<string | null>(null);
  const [lastWebhookSecret, setLastWebhookSecret] = useState<string | null>(null);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxUiStatus | null>(null);
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState<boolean>(() => localStorage.getItem('bricksbot.detailsOpen') === '1');
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
  const botRoutines = selectedBotId ? routines.filter((routine) => routine.botId === selectedBotId) : [];

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

  // Loads overlap (a run's commits, its end, switching bots); only the newest may touch the screen.
  const nextLoad = useRef(newestTicket()).current;
  const loadChat = useCallback(
    async (botId: string, chatId?: string) => {
      const isNewest = nextLoad();
      const data = chatId ? await fetchChat(chatId) : await fetchBotChat(botId);
      if (!isNewest()) return false;
      chatRef.current = data.chat;
      setChat(data.chat);
      setMessages(data.messages);
      setPendingApprovals(data.pendingApprovals);
      setPendingChoices(data.pendingChoices ?? []);
      setAutoApprovedTools(data.autoApprovedTools ?? []);
      setSandboxStatus(data.sandboxStatus ?? null);
      if ((data.chat.kind ?? 'user') === 'user') {
        setPreviews((prev) => ({ ...prev, [botId]: lastUserFacingPreview(data.messages) }));
      }
      // Every chat has a link of its own; the first load replaces the empty address instead of adding a history step.
      const route = chatRoute(data.chat.botId, data.chat.id);
      if (!window.location.hash) window.history.replaceState(null, '', route);
      else if (window.location.hash !== route) window.location.hash = route;
      return true;
    },
    [nextLoad]
  );

  /** Shows the bot's latest chat, or the one named. */
  const openChat = useCallback(
    async (botId: string, chatId?: string) => {
      setSelectedBotId(botId);
      setError(null);
      setHistoryOpen(false);
      setSearchOpen(false);
      try {
        await loadChat(botId, chatId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to open chat');
      }
    },
    [loadChat]
  );

  /** Refreshes the chat on screen after something changed it, unless the user has moved on. */
  const reloadShownChat = useCallback(async () => {
    const shown = chatRef.current;
    if (shown) await loadChat(shown.botId, shown.id);
  }, [loadChat]);

  // Back and forward, or a pasted link, move between chats.
  useEffect(() => {
    const onHashChange = () => {
      const route = parseChatRoute(window.location.hash);
      const shown = chatRef.current;
      if (route && (route.chatId ? route.chatId !== shown?.id : route.botId !== shown?.botId)) {
        void openChat(route.botId, route.chatId);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [openChat]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The list is read when history opens, and again when the open chat changes (a new title, a new message).
  useEffect(() => {
    if (!historyOpen || !selectedBotId) return;
    let cancelled = false;
    setChats((prev) => prev.filter((other) => other.botId === selectedBotId));
    fetchChats(selectedBotId).then(
      (list) => !cancelled && setChats(list),
      () => undefined
    );
    return () => {
      cancelled = true;
    };
  }, [historyOpen, selectedBotId, chat?.id, chat?.title, chat?.updatedAt]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextSpaces, nextBots, nextArchived, nextRoutines, nextModels, nextAttachments] = await Promise.all([
          fetchSpaces(),
          fetchBots(undefined, 'active'),
          fetchBots(undefined, 'archived'),
          fetchRoutines().catch(() => [] as Routine[]),
          fetchModels().catch(() => null),
          fetchAttachmentConfig().catch(() => null),
        ]);
        if (cancelled) return;
        setModelCatalog(nextModels);
        setAttachmentConfig(nextAttachments);
        setSpaces(nextSpaces);
        setBots(nextBots);
        setArchivedBots(nextArchived);
        setRoutines(nextRoutines);
        syncPreviewsFromBots([...nextBots, ...nextArchived]);
        // A link to a chat opens it; one that no longer works falls back to the bot's latest chat.
        const linked = parseChatRoute(window.location.hash);
        const linkedBot = linked && [...nextBots, ...nextArchived].find((bot) => bot.id === linked.botId);
        const nextSelected = linkedBot?.id ?? nextBots.find((bot) => bot.isPrimary)?.id ?? nextBots[0]?.id ?? null;
        setSelectedBotId(nextSelected);
        if (nextSelected) {
          const linkedChatId = linkedBot ? linked?.chatId : undefined;
          const opened = linkedChatId ? await loadChat(nextSelected, linkedChatId).catch(() => false) : false;
          if (!opened) await loadChat(nextSelected);
        }
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

  function handleSelectBot(botId: string) {
    return openChat(botId);
  }

  async function handleNewChat() {
    if (!selectedBotId) return;
    setHistoryOpen(false);
    // A chat with nothing said yet already is a new chat.
    if (chat && (chat.kind ?? 'user') === 'user' && messages.length === 0) return;
    try {
      await openChat(selectedBotId, (await createChat(selectedBotId)).id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start a new chat');
    }
  }

  async function handleRenameChat(target: Chat, title: string) {
    try {
      const renamed = await renameChat(target.id, title);
      setChats((prev) => prev.map((other) => (other.id === renamed.id ? renamed : other)));
      if (chat?.id === renamed.id) setChat(renamed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rename chat');
    }
  }

  async function handleArchiveChat(target: Chat) {
    try {
      await archiveChat(target.id);
      setChats((prev) => prev.filter((other) => other.id !== target.id));
      if (chat?.id === target.id) await openChat(target.botId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive chat');
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

  async function handleCreateBot(name: string, spaceId: string | null, avatarLabel?: string, description?: string) {
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
    patch: { description?: string; isShared?: boolean; model?: string | null }
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

  async function selectFallbackBot(nextBots: Bot[]) {
    const fallback = nextBots.find((bot) => bot.isPrimary)?.id ?? nextBots[0]?.id ?? null;
    setSelectedBotId(fallback);
    if (fallback) await loadChat(fallback);
    else {
      setChat(null);
      setMessages([]);
    }
  }

  async function handleDeleteBot(botId: string) {
    setError(null);
    try {
      await deleteBot(botId);
      const { nextBots } = await refreshRoster();
      if (selectedBotId === botId) await selectFallbackBot(nextBots);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete bot');
    }
  }

  async function handleLeaveSpace(spaceId: string) {
    setError(null);
    setSpaces((prev) => prev.filter((space) => space.id !== spaceId));
    try {
      const { nextBots } = await refreshRoster();
      if (!nextBots.some((bot) => bot.id === selectedBotId)) await selectFallbackBot(nextBots);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh after leaving');
    }
  }

  function showRunUpdate(chatId: string, update: RunUpdate) {
    const { type, payload } = update;
    const change = (patch: (current: NonNullable<typeof live>) => NonNullable<typeof live>) =>
      setLive((prev) => patch(prev?.chatId === chatId ? prev : { chatId, text: '', tools: [] }));
    if (type === 'llm.delta') {
      change((current) => ({ ...current, text: current.text + (payload.text as string) }));
    } else if (type === 'tool.started') {
      const tool = { id: String(payload.toolCallId), label: toolLabel(String(payload.name)), done: false };
      change((current) => ({ ...current, tools: [...current.tools, tool] }));
    } else if (type === 'tool.finished') {
      change((current) => ({
        ...current,
        tools: current.tools.map((tool) => (tool.id === payload.toolCallId ? { ...tool, done: true } : tool)),
      }));
    } else if (type === 'assistant.committed' && chatRef.current?.id === chatId) {
      // Swap the streamed text for the saved message in one step, so it does not blink out.
      void reloadShownChat().then(() => change((current) => ({ ...current, text: '' })));
    }
  }

  /** A run ended: show what it left behind, and why when it failed (detached runs report only through the run). */
  async function settleRun(outcome: RunOutcome) {
    setLive(null);
    if (outcome.status === 'failed') setError(outcome.error ?? 'The run failed');
    await reloadShownChat();
    await refreshRoster();
  }

  async function handleSend(content: string, attachments: AttachmentRef[]) {
    if (!chat || !selectedBotId) return;
    setError(null);
    const optimisticId = `pending-${Date.now()}`;
    const optimisticMessage: Message = {
      id: optimisticId,
      chatId: chat.id,
      role: 'user',
      content,
      attachments: attachments.length ? attachments : undefined,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);
    setBots((prev) => prev.map((bot) => (bot.id === selectedBotId ? { ...bot, presence: 'thinking' } : bot)));
    try {
      const outcome = await sendChatMessage(
        chat.id,
        content,
        (update) => showRunUpdate(chat.id, update),
        undefined,
        attachments.map((file) => file.id)
      );
      await settleRun(outcome);
    } catch (err) {
      setLive(null);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setError(err instanceof Error ? err.message : 'Unable to send message');
      setBots((prev) => prev.map((bot) => (bot.id === selectedBotId ? { ...bot, presence: 'online' } : bot)));
      throw err;
    }
  }

  async function handleStop() {
    if (!chat) return;
    try {
      await stopActiveRun(chat.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to stop the run');
    }
  }

  async function handleDecide(id: string, decision: ApprovalDecision) {
    const approval = pendingApprovals.find((item) => item.id === id) ?? null;
    const chatId = approval?.chatId ?? chat?.id;
    if (!chatId) return;
    const accepted = decision === 'once' || decision === 'all_the_time';
    setApprovalBusyId(id);
    setError(null);

    if (accepted && approval) {
      // Always allow clears the whole same-tool wave on the server — mirror that locally.
      setPendingApprovals((prev) =>
        decision === 'all_the_time'
          ? prev.filter((item) => item.toolCall.name !== approval.toolCall.name)
          : prev.filter((item) => item.id !== id)
      );
      setRunningTool({
        label: toolLabel(approval.toolCall.name),
        startedAt: new Date().toISOString(),
      });
      if (selectedBotId) {
        setBots((prev) => prev.map((bot) => (bot.id === selectedBotId ? { ...bot, presence: 'working' } : bot)));
      }
    }

    try {
      const outcome = await decideApproval(chatId, id, decision, (update) => showRunUpdate(chatId, update));
      await settleRun(outcome);
    } catch (err) {
      setLive(null);
      if (accepted && approval) {
        setPendingApprovals((prev) => (prev.some((item) => item.id === approval.id) ? prev : [approval, ...prev]));
      }
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setRunningTool(null);
      setApprovalBusyId(null);
    }
  }

  async function handleSelectChoice(choiceId: string, selectedOption: string) {
    // A choice from a routine or handoff chat is answered in that chat, not the open one.
    const chatId = pendingChoices.find((item) => item.id === choiceId)?.chatId ?? chat?.id;
    if (!chatId) return;
    setChoiceBusyId(choiceId);
    setError(null);
    try {
      const outcome = await submitChoice(chatId, choiceId, selectedOption, (update) => showRunUpdate(chatId, update));
      await settleRun(outcome);
    } catch (err) {
      setLive(null);
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
    model?: string | null;
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

  async function handleUpdateRoutine(id: string, patch: RoutineUpdatePatch) {
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
      await reloadShownChat();
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
    if (!selectedBotId || !chat) return;
    setSandboxBusy(true);
    setError(null);
    try {
      const next = await stopBotSandbox(selectedBotId, chat.id);
      setSandboxStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to stop sandbox');
    } finally {
      setSandboxBusy(false);
    }
  }

  async function handleDeleteSandbox() {
    if (!selectedBotId || !chat) return;
    setSandboxBusy(true);
    setError(null);
    try {
      const next = await deleteBotSandbox(selectedBotId, chat.id);
      setSandboxStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete sandbox');
    } finally {
      setSandboxBusy(false);
    }
  }

  const visibleMessages = messages;
  const waitingOnYou = isWaitingOnYou(chat?.id, pendingApprovals, pendingChoices);

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
        connectorsOpen={connectorsOpen}
        theme={theme}
        onThemeChange={handleThemeChange}
        onCreateOpenChange={setCreateOpen}
        onMarketplaceOpenChange={setMarketplaceOpen}
        onConnectorsOpenChange={setConnectorsOpen}
        onSelectBot={handleSelectBot}
        onCreateBot={handleCreateBot}
        onInstallMarketplaceBot={handleInstallMarketplaceBot}
        onToggleShareBot={handleToggleShareBot}
        onLeaveSpace={handleLeaveSpace}
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
              aria-label={detailsOpen ? `Hide details for ${selectedBot.name}` : `Show details for ${selectedBot.name}`}
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
            <button
              type="button"
              className={historyOpen ? 'chat-pill chat-pill-history is-open' : 'chat-pill chat-pill-history'}
              aria-expanded={historyOpen}
              aria-label="Chat history"
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <History size={14} strokeWidth={1.75} aria-hidden />
              <span className="chat-pill-name">{chat?.title ?? 'Chats'}</span>
            </button>
            <button
              type="button"
              className="chat-heading-button"
              aria-label="New chat"
              title="New chat"
              onClick={() => void handleNewChat()}
            >
              <SquarePen size={16} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="chat-heading-button"
              aria-label="Search conversations"
              title="Search conversations (Ctrl or Cmd + K)"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={16} strokeWidth={1.75} />
            </button>
          </div>
        ) : null}

        {historyOpen && selectedBot ? (
          <ChatHistory
            chats={chats}
            currentChatId={chat?.id ?? null}
            onOpen={(other) => void openChat(other.botId, other.id)}
            onRename={(other, title) => void handleRenameChat(other, title)}
            onArchive={(other) => void handleArchiveChat(other)}
            onClose={() => setHistoryOpen(false)}
          />
        ) : null}

        {error ? <p className="chat-error">{error}</p> : null}

        {loading ? (
          <div className="chat-loading">Loading</div>
        ) : (
          <>
            <ChatTranscript
              streamingText={live?.chatId === chat?.id ? live?.text : ''}
              liveTools={live?.chatId === chat?.id ? live?.tools : []}
              thinking={
                Boolean(runningTool) || selectedBot?.presence === 'thinking' || selectedBot?.presence === 'working'
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
                key={chat?.id}
                disabled={!chat || waitingOnYou || Boolean(runningTool)}
                placeholder={
                  runningTool
                    ? `Running ${runningTool.label}…`
                    : selectedBot
                      ? `Message ${selectedBot.name}`
                      : 'Message'
                }
                accent={accent}
                running={Boolean(runningTool)}
                chatId={chat?.id}
                attachments={attachmentConfig}
                onSend={handleSend}
                onStop={handleStop}
              />
            </div>
          </>
        )}
      </section>

      {searchOpen ? (
        <ChatSearch
          bots={rosterBots}
          onOpen={(hit: SearchHit) => void openChat(hit.botId, hit.chatId)}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}

      {selectedBot && detailsOpen ? (
        <BotDetailsSheet
          bot={selectedBot}
          messages={visibleMessages}
          chatId={chat?.id}
          attachments={attachmentConfig}
          routines={botRoutines}
          models={modelCatalog}
          routineBusyId={routineBusyId}
          lastWebhookSecret={lastWebhookSecret}
          sandboxStatus={sandboxStatus}
          sandboxBusy={sandboxBusy}
          autoApprovedTools={autoApprovedTools}
          onRevokeAutoApproval={handleRevokeAutoApproval}
          onOpenConnectors={() => setConnectorsOpen(true)}
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
