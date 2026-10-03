# TEMPOC for Claude Code

A Claude Code plugin (a "mod") that shows TEMPOC's bars in a band directly above the prompt: the 5-hour window on the left, the 7-day window on the right.

```
5h 53% ━━━━━━━━|━━━━━━━━━━ 7:20 (3h 6m)     7d 29% ━━━━|━━━━━━━━━━━━ 10/6 8:00 (3d 3h)   ⚙ ×
```

Each line reads: the window, the amount used, the bar, then the reset time with the time left in brackets. The bar fills to the amount used, and the tick on it is how far through the window's time you are. Hover a line for every figure, elapsed time included.

The bar turns Warning color once usage is ahead of elapsed time, and Danger color once it is more than 10 points ahead — the same defaults as the extension and the desktop app.

It runs inside Claude Code only: the terminal, and the Code tab of the Claude desktop app. It does not change the claude.ai website or the desktop app's Chat tab.

## Install

Installing takes two steps: register this repository as a marketplace (a catalog of plugins, named `tempoc`), then install the plugin from it (`usage-bar@tempoc`; the catalog also lists `hello`, a template, see below). The bars appear in the next session.

**In the terminal**, in a Claude Code session:

```
/plugin marketplace add secondarykey/TEMPOC
/plugin install usage-bar@tempoc
```

The second line opens the plugin's details in the `/plugin` panel; choose a scope there (*Install for you* puts it in every project).

**In the desktop app's Code tab**, use the plugin browser:

1. Click **+** below the prompt box and choose **Add plugins**.
2. Open **Add** at the top right and choose **Add marketplace**, then **Add from a repository**.
3. Type `secondarykey/TEMPOC` and pick **TEMPOC** from the suggestions.
4. Press **Add** next to **Usage bar** in the list.

From a shell, the same two steps are:

```
claude plugin marketplace add secondarykey/TEMPOC
claude plugin install usage-bar@tempoc
```

The terminal and the desktop app read the same settings, so a marketplace or plugin added in one shows up in the other.

To remove it, in the terminal:

```
/plugin uninstall usage-bar@tempoc
/plugin marketplace remove tempoc
```

or from a shell, `claude plugin uninstall usage-bar@tempoc` and `claude plugin marketplace remove tempoc`. Removing the marketplace also uninstalls the plugin and deletes its saved settings.

## Updating

Claude Code keeps the version it installed until the plugin is updated; restarting alone does not fetch a new one. How to update depends on where you run it.

**In the terminal**, open `/plugin`, go to **Installed**, pick **usage-bar @ tempoc** and choose **Update now**. From a shell, the same is:

```
claude plugin marketplace update tempoc
claude plugin update usage-bar@tempoc
```

To have new versions arrive on their own, turn on auto-update for `tempoc` in the **Marketplaces** tab of `/plugin` (it is off by default for every marketplace but Anthropic's official ones). Then each start of Claude Code in a terminal refreshes the catalog and updates the plugin.

**In the desktop app's Code tab**, neither works: the Update button in the plugin browser stays disabled for this plugin, even when the catalog already lists a newer version, and auto-update does not run when the desktop app starts Claude Code. Update from a terminal as above, or, with auto-update on, start `claude` in a terminal once. The terminal and the desktop app share the installed plugins, so the desktop app picks the new version up too.

The new version takes effect in the next session. The version in use is shown in the title of the settings pane (`TEMPOC v<version>`).

## Using it

| Control | Where | What it does |
|---|---|---|
| ⚙ | Right end of the band | Opens the settings |
| × | Right end of the band | Hides the band; an hourglass button appears in the status bar under the prompt |
| Hourglass | Status bar | Brings the band back |
| `/usage-bar` | Prompt | Opens the settings |

Whether the band is hidden is kept across sessions.

## Settings

The same items and defaults as in the extension and the desktop app:

| Setting | Default | Meaning |
|---|---|---|
| 5h / 7d (Color on / off) | Color on | Color the bar at all |
| 5h / 7d Warning | 0 | Points by which usage must exceed elapsed time to turn Warning color |
| 5h / 7d Danger | 10 | Points by which usage must exceed elapsed time to turn Danger color |
| Utilization Threshold: Warning | 98 | Usage percent that turns any bar Warning color |
| Utilization Threshold: Danger | 100 | Usage percent that turns any bar Danger color |

Changes take effect on Apply and are kept across sessions.

## Where the figures come from

Claude Code receives the account's usage windows (`five_hour`, `seven_day`) with each of its own API responses, and this plugin reads them from there. It makes no request of its own and sends nothing anywhere. So:

- The amount used updates when this Claude Code session gets a response. Usage you spend elsewhere (claude.ai, another session or machine) shows up at the next response, or, for another Claude Code session on the same machine, as soon as you come back to this one. Elapsed time follows the clock on its own.
- The last reading is kept between sessions, so a new session shows the bars before its first response.
- Nothing is shown off a subscription (an API key), where there are no usage windows.
- Per-model weekly limits and usage credits are not part of these figures.

## Known limits

- The band always takes one row above the prompt. Claude Code gives mods no place to draw a bar without taking room.
- The band blinks when it is redrawn: when you send a prompt, when you come back to the session from another one, when the amount used changes, when a bar changes color, and once an hour.

## Hello (template)

The catalog also lists `hello@tempoc`, the smallest whole mod, kept as a starting point for writing one: a **Hello** button in the status bar under the prompt that pops up `Hello ClaudeCodeMods`. Install it the same way (`claude plugin install hello@tempoc`); its source is in [`hello/`](hello/).

Mods are an early-access Claude Code feature; the API may change between Claude Code releases.
