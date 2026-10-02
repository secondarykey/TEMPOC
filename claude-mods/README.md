# TEMPOC for Claude Code

A Claude Code plugin (a "mod") that draws TEMPOC's bars in the band directly above the prompt, across its whole width: the 5-hour window on the left half, the 7-day window on the right. Each bar fills to how much you have used, with a tick where the window's elapsed time is. There is no text; the figures are in the bars' accessible description.

Close the bars with the band's × to give the room back; an hourglass button then appears in the status bar under the prompt, and pressing it brings the bars back. The choice is kept across sessions.

The bar turns Warning color once usage is ahead of elapsed time, and Danger color once it is more than 10 points ahead — the same defaults as the extension and the desktop app.

It runs inside Claude Code only: the terminal, and the Code tab of the Claude desktop app. It does not change the claude.ai website or the desktop app's chat.

## Install

In a Claude Code session:

```
/plugin marketplace add https://raw.githubusercontent.com/secondarykey/TEMPOC/main/claude-mods/.claude-plugin/marketplace.json
/plugin install tempoc@tempoc
```

## Where the figures come from

Claude Code reports the account's usage windows (`five_hour`, `seven_day`) with each API response, and this plugin reads them from there — it makes no request of its own. So:

- The amount used updates when Claude Code gets a response. Usage you spend elsewhere (claude.ai, another machine) shows up at the next response. Elapsed time follows the clock on its own.
- The last reading is kept between sessions, so a new session shows the bars before its first response.
- Nothing is shown off a subscription (an API key), where there are no usage windows.
- Per-model weekly limits and usage credits are not part of these figures.

Plugins of function hooks are an early-access Claude Code feature; the API may change between Claude Code releases.
