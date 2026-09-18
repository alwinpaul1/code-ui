/**
 * Real AskUserQuestion tool inputs, taken verbatim from Claude Code transcripts
 * on this machine (`~/.claude/projects/<project>/<session>.jsonl`, `tool_use`
 * blocks named `AskUserQuestion`, captured 2026-09-18 from sessions of Claude
 * Code 2.1.26x–2.1.27x). This is exactly the JSON the host puts in
 * `agentStatus.interactivePrompt` for a question: Orca 1.4.205's Claude hook
 * reducer returns `JSON.stringify(tool_input)` unchanged for a question tool.
 *
 * The shape, as the tool's own schema states it: `questions` is 1–4 entries of
 * `{ question, header (≤12 chars), options (2–4 of { label (1–5 words),
 * description }), multiSelect }`. Newer builds add an optional `preview` on an
 * option, which the fixtures below keep where the real call had one. The
 * "Other" free-text row Claude's TUI draws under the options is NOT in the
 * input — it is the selector's own, which is why nothing here has to filter it.
 *
 * Test-only. Not imported by app code.
 */

/** One question, two options, no previews — the common case. */
export const ASK_USER_QUESTION_CONTEXT_RING = {
  questions: [
    {
      question:
        'Codex only reports context via /status, not continuously. How should the context indicator work?',
      header: 'Context ring',
      multiSelect: false,
      options: [
        {
          label: 'Tap to refresh',
          description:
            'A small context chip that runs /status on tap and shows "N% left (used/total)" once. Not live, but real data on demand.'
        },
        {
          label: 'Skip it for Codex',
          description:
            "Leave the context ring out for Codex since it can't stream live like Claude. Cleaner, no /status noise in the transcript."
        }
      ]
    }
  ]
}

/** One question, three options, each with a `preview`. Labels run past 20 chars. */
export const ASK_USER_QUESTION_WHICH_LOGO = {
  questions: [
    {
      question: 'Which mark do you want as white-on-black?',
      header: 'Which logo',
      multiSelect: false,
      options: [
        {
          label: 'The app icon',
          description:
            'The launcher / installer icon. Currently the white knot on brand red (#F11924). Would become the white knot on black, with the red dropped from the icon entirely.',
          preview:
            'LAUNCHER ICON\n\n  now                    ->   proposed\n  +-------------+             +-------------+\n  |             |             |             |\n  |   red bg    |             |   black bg  |\n  |  white knot |             |  white knot |\n  |             |             |             |\n  +-------------+             +-------------+\n   #F11924 + #FFF              #000 + #FFF\n\nAlso changes: adaptiveIcon.backgroundColor,\nthe splash tile, and the favicon.'
        },
        {
          label: 'The agent session chip',
          description:
            'The rounded pill in the chat header showing the running agent (the cream pill with the orange spinner and sparkle in your screenshot). Would become a dark pill with a white glyph.',
          preview:
            'CHAT HEADER CHIP\n\n  now\n  ( cream pill )\n   ^ orange spinner + orange sparkle\n   + dark text\n\n  proposed\n  ( black pill )\n   ^ white spinner + white sparkle\n   + white text\n\nOnly touches the chat header, not any icon\nthat ships in the APK.'
        },
        {
          label: 'The notification icon tint',
          description:
            'The small icon and header tint Android paints in the shade. Currently #F11924 (was terracotta #C96442 before today). Would become white/neutral.',
          preview:
            'NOTIFICATION SHADE\n\n  now       [knot]  Code UI\n            ^ glyph white, tint #F11924\n\n  proposed  [knot]  Code UI\n            ^ glyph white, tint neutral\n\nNote: Android forces the small icon to a\nflat silhouette; only the TINT is ours.'
        }
      ]
    }
  ]
}

/** One question, FOUR options, multiSelect — more than the shade can hold. */
export const ASK_USER_QUESTION_CLEANUP = {
  questions: [
    {
      question: 'Which of these should I delete?',
      header: 'Cleanup',
      multiSelect: true,
      options: [
        {
          label: 'Tier 1 caches (~45 GB) (Recommended)',
          description:
            'Gradle, uv, Homebrew, pnpm, Google, Whisper caches, Docker build cache, android/app/build dirs. All regenerate.'
        },
        {
          label: 'Unreal Engine 5.2 (48 GB)',
          description: '/Users/Shared/Epic Games. Reinstallable from Epic launcher.'
        },
        {
          label: 'Hugging Face models (22 GB)',
          description: 'Qwen 2/2.5, grounding-dino, pythia, JobBERT. Re-download on next use.'
        },
        {
          label: 'node_modules in old checkouts (~20 GB)',
          description:
            'code-ui-main, code-ui-pub, orca, NexOS worktrees, NexOS-mobile-driver. Keeps Code UI and Walletify intact.'
        }
      ]
    }
  ]
}

/** TWO questions in one call, the first with a 40-character label. */
export const ASK_USER_QUESTION_STACK_AND_LOOK = {
  questions: [
    {
      header: 'Stack',
      question: "How should the new Android app be built on top of Orca's relay?",
      multiSelect: false,
      options: [
        {
          label: 'Fork Orca mobile (Expo/RN) (Recommended)',
          description:
            "Reuse Orca's 13k-line relay/E2EE transport, terminal engine, and the nativeChat RPC renderer as-is. Replace every screen with a new Claude-app-style UI. beUI's agent components (message, tool-result, todo-list, approval-card, prompt-input) are re-implemented in Reanimated, using beUI as the motion/API blueprint. Keeps push notifications, QR pairing, and the mock server for dev."
        },
        {
          label: 'Web app + Capacitor with real beUI',
          description:
            'Vite/React app using actual beUI components, wrapped for Android with Capacitor. Requires porting the transport to browser crypto/storage and rewriting ~40k lines of session/chat logic. Weaker keyboard, notification, and terminal handling. Much longer.'
        },
        {
          label: 'Native Kotlin/Compose',
          description:
            'Re-implement relay pairing, E2EE v2, RPC framing, and terminal streaming from scratch. Highest fidelity to Android, highest risk, months of work.'
        }
      ]
    },
    {
      header: 'Look',
      question: 'Which visual direction for the UI layer?',
      multiSelect: false,
      options: [
        {
          label: 'Claude app: warm cream/ink, serif headings (Recommended)',
          description:
            'Cream and charcoal surfaces, serif display type, soft cards, collapsed tool-call rows like the Claude and Codex mobile apps. Light and dark both built.'
        },
        {
          label: 'Codex app: neutral white/black, sans-serif',
          description: 'Pure monochrome, tight sans type, minimal chrome. Light and dark both built.'
        },
        {
          label: "Keep Orca's graphite dark palette",
          description:
            "Reuse Orca's existing tokens and only restructure the screens and interaction model."
        }
      ]
    }
  ]
}

/**
 * Codex's `request_user_input` PreToolUse input, Codex 0.145 — the shape the
 * vendored hook listener test pins (`agent-hook-listener-hermes-codex-droid.test.ts`).
 * Orca's `jt()` treats `requestuserinput` exactly like `askuserquestion`, so
 * this too arrives on `interactivePrompt` as-is. Note the `id`, the absent
 * `multiSelect`, and that it offers ONE option — kept verbatim, which also
 * makes it the one-option degenerate case.
 */
export const CODEX_REQUEST_USER_INPUT = {
  questions: [
    {
      id: 'color_preference',
      header: 'Color',
      question: 'Which color do you prefer: red or blue?',
      options: [{ label: 'Blue', description: 'Choose blue.' }]
    }
  ]
}

/** What the host's 16,000-character clip does to a long prompt: the JSON is cut
 *  mid-string. Cut at the midpoint here so the fixture stays real-sized. */
export function clippedByHost(interactivePrompt: string): string {
  return interactivePrompt.slice(0, Math.floor(interactivePrompt.length / 2))
}
