import type { ChatStore } from '../../shared/chat/types.js';
import type { Routine, RoutineStore } from '../../shared/routines/types.js';
import { canUseBot } from '../chat/access-policy.js';
import { routineAppIdentityAllowed, runWithRoutineAuth } from '../chat/databricks-auth.js';
import type { ChatService, SendMessageResult } from '../chat/service.js';
import { verifyWebhookSecret } from './webhook-auth.js';

export interface RoutineRunResult {
  routine: Routine;
  chat: SendMessageResult;
}

export class RoutineService {
  constructor(
    private readonly routines: RoutineStore,
    private readonly chats: ChatStore,
    private readonly chatService: ChatService,
    private readonly env: Record<string, string | undefined> = process.env
  ) {}

  /** Manual trigger — allowed even when the routine is disabled. */
  async runNow(routineId: string, ownerId: string): Promise<RoutineRunResult> {
    const routine = await this.routines.getRoutine(routineId);
    if (!routine || routine.ownerId !== ownerId) {
      throw new Error('Routine not found');
    }
    return this.enqueue(routine);
  }

  /** Job / webhook trigger — requires shared secret and enabled routine. */
  async runFromWebhook(routineId: string, secret: string): Promise<RoutineRunResult> {
    const auth = await this.routines.getRoutineAuth(routineId);
    if (!auth) {
      throw new Error('Routine not found');
    }
    if (!verifyWebhookSecret(secret, auth.webhookKeyHash)) {
      throw new Error('Invalid webhook secret');
    }
    if (!auth.routine.enabled) {
      throw new Error('Routine is disabled');
    }
    return this.enqueue(auth.routine);
  }

  private async enqueue(routine: Routine): Promise<RoutineRunResult> {
    const bot = await this.chats.getBot(routine.botId);
    if (!bot) {
      throw new Error('Bot not found');
    }
    if (!(await canUseBot(this.chats, bot, routine.ownerId))) {
      throw new Error('Bot access required for this routine');
    }
    const chat = await this.chats.getOrCreateChatForBot(routine.botId, routine.ownerId);
    const systemNote = `[routine:${routine.name}] scheduled run`;
    await this.chats.addMessage(chat.id, 'system', systemNote);
    const runAs = routine.runAs === 'app' && routineAppIdentityAllowed(this.env) ? 'app' : 'owner_approval';
    const result = await runWithRoutineAuth(runAs, () =>
      this.chatService.sendUserMessage(chat.id, routine.prompt, { routine: true })
    );
    const updated = await this.routines.markRoutineRun(routine.id);
    return { routine: updated, chat: result };
  }
}
