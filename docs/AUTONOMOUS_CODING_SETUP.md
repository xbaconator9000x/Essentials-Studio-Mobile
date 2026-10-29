# Essentials Studio Mobile — ChatGPT-first development queue

**No GitHub Copilot Pro, Copilot Pro+, Google Jules, ChatGPT Work subscription, paid AI API, external coding-agent API key, or special GitHub token is required for this repository's existing development queue.**

The queue is in `development/queue.json`. The **Development queue watchdog** GitHub Actions workflow checks it every five minutes, on pushes to main and after selected build/test completions. It validates dependencies, identifies ready tasks, and publishes a summary for the next development run. GitHub Issues are optional and currently disabled in the repository.

## What actually performs development?

The user's **existing ChatGPT Essentials Studio Mobile automation** is the implementation agent. On its own scheduled ChatGPT invocation it uses the already connected GitHub tools to read main, select eligible tasks, edit code, create or update pull requests, check CI, and record progress and acceptance evidence.

A GitHub Actions workflow **cannot wake or invoke this ChatGPT automation** on every new commit or CI result. The queue check being frequent does not make the ChatGPT coding agent run more frequently. ChatGPT automations follow their separate schedule and product usage limits. The repository does **not** impersonate ChatGPT, initiate paid inference calls, or promise continuously running autonomous coding.

## Workflows and safety

- The GitHub workflow uses the normal automatic `GITHUB_TOKEN` for permitted GitHub housekeeping only; no owner-generated token or paid subscription is required.
- It checks the durable queue, verifies the handoff test and publishes the next eligible tasks as a GitHub Actions summary.
- It does not call Copilot's Agent Tasks API, Jules, OpenAI's API, or any other paid model endpoint.
- The Android build, Rust tests, project data integrity and frontend regression checks continue to run via GitHub Actions.
- Implementation work must preserve original RPG Maker XP maps, event commands, Marshal attributes, Ruby scripts, and Pokémon Essentials PBS fields. Only merged code backed by actual passing tests and required device evidence counts as completed.
- A passing synthetic test or a successfully compiled Android APK alone does not prove physical device behavior or genuine Essentials v21.1 compatibility.
- Public binary publication remains subject to upstream licensing review.

## How to continue

Use the existing enabled **Essentials Studio Mobile watchdog** automation in ChatGPT, or open a normal chat and ask ChatGPT to implement the next eligible work batch from the latest GitHub queue.

The GitHub Actions handoff can be read at:
https://github.com/xbaconator9000x/Essentials-Studio-Mobile/actions/workflows/development-watchdog.yml

The free-agent alternatives previously evaluated were not configured as the main development system. PR #23's Copilot-paid API code and credential requirement were removed in a follow-up correction.
