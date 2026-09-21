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

And in the sheet itself, after a conversation:

| What it says | What it means |
|---|---|
| Nothing was logged | The agent never called a tool. Its client tools are missing, are webhooks rather than client tools, or are on a branch that was never published. |
| Nothing was kept | The tools were called, so the wiring is good — but nothing was ever confirmed. |
| Zimpan was asked for *name* | The agent has a tool by a name this app does not answer to. Check the spelling against the six above. |

## Setting them up on ElevenLabs

This is the step that is easy to miss, and it fails silently. Registering the
tools in the browser only says what this app is *able* to run. The agent still
needs each one declared on its side, or the model has nothing to call — and an
agent with no tools holds a perfectly normal conversation, agrees with
everything, and says the entry is logged, because the prompt told it to say
that. Nothing is written and nothing looks wrong.

Three ways to get this wrong:

1. **Not added at all.** The agent talks; nothing is ever asked of the app.
2. **Added as a server tool (webhook).** ElevenLabs calls a URL instead of the
   browser. This app never sees it. They must be **client** tools.
3. **Added on a draft branch and never published.** The live agent has none of
   them. If your agent URL carries a `branch_id`, this is the likely one.

All three look identical from inside a conversation. The sheet now tells them
apart after the fact — see **When it will not start**.

### Adding one, in their dashboard

Agent → **Tools** → **Add tool** → **Client** (not Webhook, not Server). Then
for each tool: the **name** exactly as spelled below, the description, and one
parameter at a time with its own identifier, type, description and required
flag. Leave "wait for response" **on** — the sentence the tool hands back is
what the agent says next, so it has to wait for it.

The descriptions matter more than they look, and there are **two kinds**. The
tool's description is what the model reads when deciding whether to call
anything at all. Each parameter has its **own** description, and that is what
the model reads when deciding what to put in it.

Copying the tool's description into every parameter is the failure that looks
most like success: the tool gets called, it reports "Succeeded", and it arrives
with nothing in it, because nothing ever told the model that `activity` is the
thing the person did. Give every parameter its own line from the table below.

Mark as **required** only what the table marks required. A parameter the model
is forced to fill is a parameter it will invent - an optional one it has
nothing to say about is simply left out, which is what these tools expect.

| Tool | Description to paste |
|---|---|
| `log_activity` | Record something the person did: work, a meal, a workout, an errand. Call this as soon as you know what they did. Returns a sentence to read back word for word. |
| `log_money` | Record money that moved, in or out. Requires an amount. Returns a sentence to read back word for word. |
| `create_plan` | Put something upcoming on their planner: a subscription, a bill due, or a note. Returns a sentence to read back word for word. |
| `amend_entry` | Change one field of the entry that is waiting to be confirmed. |
| `confirm_entry` | Write the waiting entry. This is the only tool that saves anything. Call it when they agree. |
| `cancel_entry` | Discard the waiting entry. |

### The parameters, tool by tool

Every one is a **client** tool. `confirm_entry` and `cancel_entry` take no
parameters at all.

| Tool | Parameter | Type | Required | Description to paste |
|---|---|---|---|---|
| `log_activity` | `activity` | String | **yes** | What the person did, in their own words. "drive going home", "team standup", "lunch". Not a sentence, just the thing. |
| | `date` | String | no | The day it happened as YYYY-MM-DD. Work out "yesterday" or "Tuesday" yourself. Leave out for today. |
| | `start` | String | no | What time it started, as HH:MM on a 24-hour clock. "5pm" is 17:00. Leave out if they did not say. |
| | `minutes` | Number | no | How long it took, in minutes. From 5pm to 5:30pm is 30. Leave out if they did not say. |
| | `category` | String | no | Your guess at which of their categories it belongs to. Leave out if unsure; the app decides. |
| | `note` | String | no | What they ate, or what the workout was. Only when they have told you; never invent it. |
| `log_money` | `what` | String | **yes** | What the money was for, in their words. "lunch", "electricity bill", "client payment". |
| | `amount` | Number | **yes** | How much, as a number with no currency symbol. Never guess one. |
| | `direction` | String | no | "in" for money received, "out" for money spent. Leave out for spending. |
| | `date` | String | no | The day as YYYY-MM-DD. Leave out for today. |
| | `purpose` | String | no | Your guess at which of their purposes it belongs to. Leave out if unsure. |
| `create_plan` | `what` | String | **yes** | What is coming up, in their words. "Netflix", "electricity bill", "call the dentist". |
| | `amount` | Number | no | How much it costs, as a number. Leave out if there is no amount. |
| | `date` | String | no | A one-off date as YYYY-MM-DD. This makes it a due. Leave out for a subscription or a note. |
| | `dayOfMonth` | Number | no | The day of the month it is charged, 1 to 31. This makes it a subscription. Leave out otherwise. |
| | `purpose` | String | no | Your guess at which of their purposes it belongs to. Leave out if unsure. |
| `amend_entry` | `field` | String | **yes** | Which one thing to change: activity, date, category, purpose, note or amount. |
| | `value` | String | **yes** | What to change it to. |
| `confirm_entry` | — | — | — | No parameters. |
| `cancel_entry` | — | — | — | No parameters. |

### Making it hang up

The panel closes itself when the conversation ends. An ElevenLabs agent does
not end a call on its own, though: it says goodbye and keeps listening, so
nothing ever tells this app the conversation is over.

Turn on the built-in **End call** system tool on the agent. Then a goodbye
actually hangs up, the session closes, and the sheet goes with it.

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
| `note` | string | what was eaten, or what the workout was. See below. |

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

> **All six have to exist on the agent, not only in the app.** The browser
> registers what it can run; the agent still needs each tool declared on its
> side, or the model has nothing to call. An agent with none of them holds a
> perfectly normal conversation and writes nothing — it will even say the entry
> is logged, because the prompt told it to. The sheet now says so when a
> conversation ends having called nothing, but the fix is on ElevenLabs.
>
> Tools set on a **draft branch** are not on the live agent. Publish them.

### `amend_entry`
| Parameter | Type | Notes |
|---|---|---|
| `field` | string | `activity`, `date`, `category`, `purpose`, `note` or `amount` |
| `value` | string or number | |

## Meals and workouts are asked about

A meal logged as nothing but the word "lunch" is worth no calories at all: the
estimator strips the meal label and finds nothing left to read. A workout
nobody described is the same.

So when `log_activity` recognises one, what comes back in `spoken` is a
**question** rather than a confirmation — *What did you eat?*, *What kind of
workout was that?* — and the confirmation follows once it is answered. The
rules are the ones the form already uses, so the voice asks what the form
asks, in the same words, including the silent rule that stops an hour of
cooking being asked what it tasted like.

The note is wanted, not required. If they skip it, `confirm_entry` still
writes the row.

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

WHEN THE TOOL ASKS INSTEAD OF CONFIRMS
Sometimes "spoken" comes back as a question rather than a confirmation. That
happens on meals and workouts, where the app needs to know what was eaten or
what the workout was before it can estimate anything. Ask the question exactly
as given and wait. Send their answer with amend_entry, field "note" — never a
summary of it, and never one you made up. If they skip it, call confirm_entry
and the row goes in without one.

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
Never invent a date, a category, a purpose or a note to fill a gap. A guessed
meal becomes a calorie count they did not eat.

Never paraphrase, shorten or decorate "spoken". It carries the date and the
category the app actually resolved, which may not be what you sent, and reading it
out is the only thing standing between a wrong guess and a wrong row. If a tool
comes back with ok false, "spoken" is a question — ask it and wait.

You cannot record anything by yourself; only the tools below write anything.
Never describe an entry as added, logged or saved unless confirm_entry has come
back ok.

A tool answering with ok false is not a failure and not a reason to give up.
"spoken" is then a question - ask it, wait, and carry on where you left off.
Only if the tools are genuinely not available to you should you say "I cannot
save that from here", and then stop.

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
  minutes (how long it took, 30 if unsaid), category (suggestion only),
  note (what they ate, or what the workout was).

log_money — money that moved.
  what (required), amount (required, never guess), direction ("in" or "out",
  "out" if unsaid), date, purpose (suggestion only).

create_plan — something coming up.
  what (required), amount, date, dayOfMonth (1-31), purpose.
  A dayOfMonth makes it a subscription. A date with no dayOfMonth makes it a due.
  Neither makes it a planner note, and the read-back says so out loud — do not
  talk over that line, it is the difference between a reminder and a note.

amend_entry — change one field of the waiting draft.
  field: activity, date, category, purpose, note or amount. value: the new value.
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
