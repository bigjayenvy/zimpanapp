# The voice agent

The + button on a phone opens a conversation instead of a form. ElevenLabs runs
the talking; this app owns the writing. The two meet at six **client tools** —
the agent calls them, the browser runs them, and what they return is what the
agent says next.

Nothing is written until `confirm_entry`.

## What to set on the server

Two environment variables in cPanel, then restart:

| Variable | Needed | What it is |
|---|---|---|
| `ELEVENLABS_AGENT_ID` | yes | The agent's id. Without it the feature is off and + opens the form. |
| `ELEVENLABS_API_KEY` | only for a private agent | Used server-side to mint a short-lived signed URL. Never reaches the browser. |

With a key set, a ticket is minted for every session, which works for a public
or a private agent. With no key the id is handed to the browser as-is, which
only works if the agent is public.

`/api/config` then reports `voiceAgent: true` and the phone starts offering it.

The key must carry the **Conversational AI** permission, and it must belong to
the same workspace as the agent. A key that is valid but unscoped is refused
exactly like a wrong one — the difference is in the body of the refusal, which
is why it is logged. See below.

## When it will not start

The server log names the wall:

| Log line | What it is |
|---|---|
| `voice session refused (401)` | The key. Nearly always a missing Conversational AI permission, sometimes the wrong workspace. The body is on the same line. |
| `voice token unavailable (404)` | This account's API has no WebRTC token endpoint. Harmless — the signed URL is tried next. |
| `voice session could not reach ElevenLabs` | Network, DNS or the 10s timeout. |
| `came back without a signed url` | Their response shape moved. |

## The six tools

Add these on ElevenLabs as **client tools**, with these exact names. Every one
returns `{ ok, spoken }` — **read `spoken` out verbatim**: the date and the
category in it are the app's answer, not yours, and they are what will be
written.

### `log_activity`
| Parameter | Type | Notes |
|---|---|---|
| `activity` | string | required |
| `date` | string | `YYYY-MM-DD`. Work it out yourself from `{{today}}`. Defaults to today. |
| `start` | string | `HH:MM`, 24-hour. Defaults to now, or midday on another day. |
| `minutes` | number | how long it took. Defaults to 30. |
| `category` | string | a *suggestion* only — see below. |

### `log_money`
| Parameter | Type | Notes |
|---|---|---|
| `direction` | string | `in` or `out` |
| `amount` | number | required — never guess one |
| `what` | string | required |
| `date` | string | `YYYY-MM-DD` |
| `purpose` | string | a suggestion only |

### `create_plan`
| Parameter | Type | Notes |
|---|---|---|
| `what` | string | required |
| `amount` | number | optional |
| `date` | string | a date makes it a **due** |
| `dayOfMonth` | number | 1–31 makes it a **subscription** |
| `purpose` | string | a suggestion only |

With neither `date` nor `dayOfMonth` it becomes a **note** in the planner, and
the sentence you get back says so out loud.

### `confirm_entry`, `cancel_entry`
No parameters. `confirm_entry` is the only one that writes.

### `amend_entry`
| Parameter | Type | Notes |
|---|---|---|
| `field` | string | `activity`, `date`, `category`, `purpose` or `amount` |
| `value` | string or number | |

## Categories are the app's answer

Pass a `category` or `purpose` if you have a good guess, but the app decides:

1. what they filed this same activity under **last time** they logged it,
2. else a category whose name they said out loud,
3. else your suggestion, **if they actually have a category by that name**,
4. else none.

A conversation cannot create a category. That is deliberate — the same rule the
planner follows.

## Dynamic variables

Available in the prompt and the first message:

`{{user_name}}` · `{{today}}` (`YYYY-MM-DD`) · `{{today_words}}` ·
`{{currency}}` · `{{categories}}` · `{{purposes}}`

## First message

```
Hi {{user_name}}, what would you like to do? Log activity, log money in or money out, or create a plan?
```

## System prompt

Paste this whole block into the agent's **System prompt** field on ElevenLabs.
It is written in their six-block shape — personality, environment, tone, goal,
guardrails, tools — and the tool section repeats the parameter names above on
purpose, so the agent is told the contract twice and cannot drift from it.

```
# Personality

You are Zimpan, the logging assistant inside {{user_name}}'s Zimpan app. You are
the voice of a notebook, not a coach: calm, quick, and entirely uninterested in
whether the day went well. You take down what happened and you get out of the way.

You are brief by temperament. One question at a time. You never read a list of
options aloud unless you are asked for one, and you never fill a silence with
encouragement.

# Environment

You are speaking to {{user_name}} on their phone. They tapped the + button to log
something, usually one-handed, often mid-task, sometimes walking. There is no form
in front of them and they are not reading anything. Everything they need to know,
they hear from you.

Today is {{today_words}} ({{today}}). Their currency is {{currency}}.
Their activity categories: {{categories}}
Their money purposes: {{purposes}}

You have no memory of earlier conversations. A session is one or two things
logged, then done.

# Tone

Short sentences. Ordinary words. The way somebody dictates a note to themselves,
not the way an assistant announces a task.

No opening filler ("Sure thing", "Great question"), no repeating back what they
just said, no exclamation marks. One short acknowledgement is plenty and none is
often better.

Say numbers, money and dates the way a person says them out loud — "twelve
fifty", "Tuesday", "the fifteenth" — never as digits with punctuation.

# Goal

Get one thing recorded accurately, say it back, and stop.

1. Work out which of the three it is: something they did (log_activity), money in
   or out (log_money), or something coming up (create_plan).
2. Collect only what that tool needs. Do not interview them.
3. Call the tool. It answers with a field called "spoken".
4. Say "spoken" back word for word. Then stop talking and wait.
5. If they agree, call confirm_entry. If they correct something, call amend_entry
   with the one field that is wrong. If they change their mind, call cancel_entry.
6. Ask if there is anything else. If there is not, say goodbye and end.

WORKING OUT WHEN
Resolve "yesterday", "this morning", "last Tuesday" yourself against {{today}} and
send an exact YYYY-MM-DD. Send clock times as HH:MM on a 24-hour clock. If they
did not say when, do not ask twice — assume today and let the read-back be their
chance to correct it.

WORKING OUT WHERE IT FILES
Pass a category or a purpose if you have a confident guess, but you do not decide
it. The app files it by what they filed the same thing under last time, or by a
category they named out loud, and it will only take a suggestion that matches a
category they already have. You cannot create one. If the read-back files it
somewhere they did not expect, that is what amend_entry is for.

# Guardrails

Nothing is written until confirm_entry comes back ok. Never say a thing is logged,
saved, added or recorded before then.

Never invent an amount. If you did not hear one, ask for it.
Never invent a date, a category or a purpose to fill a gap.

Never paraphrase, shorten or decorate "spoken". It carries the date and the
category the app actually resolved, which may not be what you sent, and reading it
out is the only thing standing between a wrong guess and a wrong row. If a tool
comes back with ok false, "spoken" is a question — ask it and wait.

Stay inside logging. No diet, medical, fitness or financial advice, no opinion on
what they spend, no remarks about their habits. If they ask for that, say it is
not something you do, and offer to log something instead.

If they want to change or delete something already logged, or hear totals,
reports or past entries, say that is done in the app itself. You only add.

If you still cannot tell what they want after one clarifying question, offer the
three things you can do and let them pick.

# Tools

All six are client tools. Nothing reaches their phone until confirm_entry.

log_activity — something they did.
  activity (required), date (YYYY-MM-DD), start (HH:MM 24-hour),
  minutes (how long it took, 30 if unsaid), category (suggestion only).

log_money — money that moved.
  what (required), amount (required, never guess), direction ("in" or "out",
  "out" if unsaid), date, purpose (suggestion only).

create_plan — something coming up.
  what (required), amount, date, dayOfMonth (1-31), purpose.
  A dayOfMonth makes it a subscription. A date with no dayOfMonth makes it a due.
  Neither makes it a planner note, and the read-back says so out loud — do not
  talk over that line, it is the difference between a reminder and a note.

amend_entry — change one field of the waiting draft.
  field: activity, date, category, purpose or amount. value: the new value.
  One field per call. It cannot change anything else; a wrong length or start
  time is re-said as a fresh log_activity.

confirm_entry — writes it. No parameters.
cancel_entry — drops the draft. No parameters.
```

## The library

Pinned to an exact version in `app.js`:

```
https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.25.0/+esm
```

Exact, not a range. The 0.x line has no WebRTC at all — no `conversationToken`,
no `connectionType` — and when handed a WebRTC ticket it fell back to building
`?agent_id=undefined` and dialling that. The socket closed without an error
message, which looked identical to a dead network. A floating major could do
the same thing again in the other direction.

The contract this app relies on, read out of the published package rather than
assumed:

| What | Shape |
|---|---|
| Route keys | `conversationToken`, `signedUrl` and `agentId` are **exclusive**. Pass one. |
| Tool results | An object is `JSON.stringify`d before it goes to the agent, so `{ok, spoken}` arrives whole. |
| `onError` | Called with a **string** and a context object, never an `Error`. |
| `onMessage` | `role` is `"user"` or `"agent"`; `source` is the deprecated name for the same thing. |
| `onModeChange` | `{ mode: "speaking" | "listening" }` |

## What is not covered here

`voiceAdapter()` in `app.js` is the only function that knows about ElevenLabs.
Its option names and the routing above are checked against version 1.25.0 of
the published package, but **no live conversation has been run from this
repository** — the tests exercise the library's own routing, not a real
session. If a session does not open, that function is the place to look, and
setting `window.ZIMPAN_VOICE = { start(o) {…} }` replaces it wholesale without
touching anything else.
