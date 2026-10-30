import { useCallback, useEffect, useState } from 'react';
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
  fetchBotChat,
  fetchBots,
  fetchSpaces,
  moveBot,
  revokeAutoApproval,
  sendChatMessage,
  submitChoice,
  unarchiveBot,
  updateBot,
} from './lib/chat-api';
import {
  createSkill,
  deleteSkill,
  fetchMemories,
  fetchSkills,
  upsertMemory,
} from './lib/memory-api';
import {
  createRoutine,
  fetchRoutines,
  fetchSetupStatus,
  runRoutine,
  updateRoutine,
  type SetupStatus,
} from './lib/routines-api';
import { applyTheme, readStoredTheme, type Theme } from './lib/theme';
import { lastUserFacingPreview, presenceTooltip, toolLabel } from './lib/user-facing';
import type { BotMemory, BotSkill } from '../../shared/agents/memory/types';
import type { Routine } from '../../shared/routines/types';

const INSTALL_DISMISS_KEY = 'bricksbot-install-wizard-dismissed';

function readInstallWizardDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

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
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [installWizardDismissed, setInstallWizardDismissed] = useState(() =>
    readInstallWizardDismissed(),
  );
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineBusyId, setRoutineBusyId] = useState<string | null>(null);
  const [lastWebhookSecret, setLastWebhookSecret] = useState<string | null>(null);
  const [memories, setMemories] = useState<BotMemory[]>([]);
  const [skills, setSkills] = useState<BotSkill[]>([]);

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

  const loadBotDetails = useCallback(async (botId: string) => {
    const [nextMemories, nextSkills] = await Promise.all([
      fetchMemories(botId),
      fetchSkills(botId),
    ]);
    setMemories(nextMemories);
    setSkills(nextSkills);
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
    setPreviews((prev) => ({ ...prev, [botId]: lastUserFacingPreview(data.messages) }));
    await loadBotDetails(botId);
  }, [loadBotDetails]);

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
        const [nextSpaces, nextBots, nextArchived, status, nextRoutines] = await Promise.all([
          fetchSpaces(),
          fetchBots(undefined, 'active'),
          fetchBots(undefined, 'archived'),
          fetchSetupStatus().catch(() => null),
          fetchRoutines().catch(() => [] as Routine[]),
        ]);
        if (cancelled) return;
        setSpaces(nextSpaces);
        setBots(nextBots);
        setArchivedBots(nextArchived);
        setSetupStatus(status);
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

  function handleInstallWizardDismiss() {
    setInstallWizardDismissed(true);
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  function handleInstallWizardOpen() {
    setInstallWizardDismissed(false);
    try {
      localStorage.removeItem(INSTALL_DISMISS_KEY);
    } catch {
      /* ignore */
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

  async function handleToggleRoutine(id: string, enabled: boolean) {
    setError(null);
    try {
      await updateRoutine(id, { enabled });
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

  async function handleSaveMemory(key: string, content: string) {
    if (!selectedBotId) return;
    setError(null);
    try {
      await upsertMemory(selectedBotId, key, content);
      await loadBotDetails(selectedBotId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save memory');
    }
  }

  async function handleCreateSkill(name: string, body: string) {
    if (!selectedBotId) return;
    setError(null);
    try {
      await createSkill(selectedBotId, name, body);
      await loadBotDetails(selectedBotId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add skill');
    }
  }

  async function handleDeleteSkill(skillId: string) {
    if (!selectedBotId) return;
    setError(null);
    try {
      await deleteSkill(selectedBotId, skillId);
      await loadBotDetails(selectedBotId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete skill');
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
            <div className="chat-pill">
              <BotFace
                color={accent}
                size={26}
                botId={selectedBot.id}
                track
                presence={selectedBot.presence}
                title={presenceTooltip(selectedBot.presence)}
              />
              <span>{selectedBot.name}</span>
            </div>

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

      {selectedBot ? (
        <BotDetailsSheet
          bot={selectedBot}
          messages={visibleMessages}
          setupStatus={setupStatus}
          installWizardDismissed={installWizardDismissed}
          onInstallWizardDismiss={handleInstallWizardDismiss}
          onInstallWizardOpen={handleInstallWizardOpen}
          routines={botRoutines}
          routineBusyId={routineBusyId}
          lastWebhookSecret={lastWebhookSecret}
          memories={memories}
          skills={skills}
          onCreateRoutine={handleCreateRoutine}
          onToggleRoutine={handleToggleRoutine}
          onRunRoutine={handleRunRoutine}
          onSaveMemory={handleSaveMemory}
          onCreateSkill={handleCreateSkill}
          onDeleteSkill={handleDeleteSkill}
        />
      ) : null}
    </div>
  );
}
