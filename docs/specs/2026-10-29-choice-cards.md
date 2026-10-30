# Spec: Choice / action cards

**Status:** implemented (2026-10-29)  
**Roadmap:** closed — see [roadmap-next.md](../roadmap-next.md)

Ask-first `ask_choice` tool: agent proposes 2–5 options → user approves showing the card → user picks → durable transcript row (“Sua resposta”) → tool result resumes the turn. Mirrors approval UX; blocks composer until resolved. No Genie.

## Goals

1. **Tool:** `ask_choice` — every bot; Ask-first; **no** “Always allow” (like `create_bot`).
2. **UX:** Interactive choice cards below the transcript (like `ApprovalCards`); answered choices visible in `ChatTranscript`.
3. **Harness:** Turn blocks until the matching `toolCallId` gets a tool result; OpenAI-valid replay preserved.

## Out of scope

- Genie / MCP / presence `blocked` polish (separate roadmap item)
- Dismiss / “Dispensado” without picking (future)
- Lakebase persistence for pending choices (in-memory `ChoiceStore` for MVP; rehydrate from `choice_prompt` system rows later if needed)

## Design (chosen)

### Two-step gate

1. **Approval (Ask-first):** Model calls `ask_choice` → pending approval like `sql_query`. User **Once** or **Not approve** only (no Always allow).
2. **Choice (blocks turn):** On Once → `ChatService.beginPendingChoice` writes a system JSON notice and registers `ChoiceStore` pending row — **no** tool result yet.
3. **Resume:** `POST /api/chats/:chatId/choices/:choiceId` with `{ selectedOption }` → system `choice_answer` (“Sua resposta: …”) + tool message `{ ok, selected }` → `continueTurn`.

### System message shapes (`shared/chat/choice-notice.ts`)

| kind | Purpose |
| --- | --- |
| `choice_prompt` | `{ id, toolCallId, prompt, options[] }` — durable card in transcript |
| `choice_answer` | `{ choiceId, prompt, selectedOption }` — user-facing answer line |

Both are stripped from LLM history in `toLlmHistory` (UI-only, like handoff chips). The model learns the pick from the tool result.

### Tool args

```json
{ "prompt": "string", "options": ["…", "…"] }
```

- 2–5 unique non-empty strings (`normalizeOptions`).

### HTTP

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/bots/:botId/chat` | — | adds `pendingChoices[]` |
| POST | `/api/chats/:chatId/choices/:choiceId` | `{ selectedOption }` | `SendMessageResult` (same shape as message send) |

### Client wiring (`App.tsx`)

Marked block:

```tsx
{/* CHOICE_CARDS — pending ask_choice prompts (below approvals, above composer) */}
<ChoiceCards … />
```

Composer disabled when `pendingApprovals.length > 0 || pendingChoices.length > 0`.

### Presence

`syncBotPresenceAfterTurn` sets `waiting` when approvals **or** pending choices block the loop.

## Files

| Path | Role |
| --- | --- |
| `shared/chat/choice-notice.ts` | Parse/serialize + `PendingChoice` type |
| `server/chat/choices.ts` | In-memory pending choice store |
| `server/agents/tools/ask-choice.ts` | Tool definition + `planAskChoice` |
| `server/chat/service.ts` | Register tool; approval → prompt; `submitChoice` |
| `server/chat/routes.ts` | Choice POST + load pending on chat GET |
| `client/src/components/ChoiceCards.tsx` | Interactive picker (keys 1–5) |
| `client/src/components/ChoicePromptStatus.tsx` | Transcript prompt + answer rows |
| `client/src/components/ChatTranscript.tsx` | Render prompt + answered state |
| `client/src/App.tsx` | `CHOICE_CARDS` wiring |
| `client/src/lib/chat-api.ts` | `submitChoice`, `pendingChoices` on fetch |

## Registration notes

- **Not** in `DEFAULT_META_TOOL_NAMES` — always Ask-first.
- Listed in `buildCapabilityCatalog` / `tool-labels` when registered.
- Do **not** add to seed skill bodies in this change.

## Test plan

- [ ] `npm test` — `choice-notice`, `ask-choice`, `ChatService` ask_choice flow
- [ ] Manual: model calls `ask_choice` → approve Once → pick option → assistant continues; transcript shows prompt + “Sua resposta”

## Pointers

- Roadmap item 3: [roadmap-next.md](../roadmap-next.md)
- Approval pattern: `server/chat/approvals.ts`, `ApprovalCards.tsx`
