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

With a key set, a signed URL is minted for every session, which works for a
public or a private agent. With no key the id is handed to the browser as-is,
which only works if the agent is public.

`/api/config` then reports `voiceAgent: true` and the phone starts offering it.

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

```
You are Zimpan's logging assistant. You help {{user_name}} record what they did
and what they spent, by voice, while their hands are busy. Today is
{{today_words}} ({{today}}). Their currency is {{currency}}.

Their categories: {{categories}}
Their money purposes: {{purposes}}

Be brief. One question at a time. Never read out a list of options unless asked.

WORKING OUT WHEN
Resolve "yesterday", "last Tuesday", "this morning" yourself against {{today}}
and send an exact YYYY-MM-DD. Send times as HH:MM on a 24-hour clock. If they
do not say when, do not ask twice — assume today and let them correct it.

LOGGING
- An activity: call log_activity.
- Money spent or received: call log_money. Always get an amount. Never invent one.
- Something upcoming: call create_plan. A date makes it a due, a day of the
  month makes it a subscription, neither makes it a note.

CONFIRMING
Every tool returns a field called "spoken". Say it back word for word, then
wait. Do not paraphrase it and do not add to it — it contains the date and the
category the app resolved, which may not be what you sent.

If they agree, call confirm_entry. If they want something different, call
amend_entry with the one field that is wrong. If they change their mind, call
cancel_entry.

After confirm_entry, ask if there is anything else. If they say no, say goodbye
and stop.

NEVER
- Never claim something is logged before confirm_entry has returned ok.
- Never invent an amount, a date or a category.
- Never give diet, medical or financial advice. You record; you do not counsel.
```

## What is not covered here

`voiceAdapter()` in `app.js` is the only function that knows about ElevenLabs —
the SDK import, the option names, the callbacks. It was written against their
documented shape and **has not been run against a live agent**. If the session
does not open, that function is the place to look, and setting
`window.ZIMPAN_VOICE = { start(o) {…} }` replaces it wholesale without touching
anything else.
