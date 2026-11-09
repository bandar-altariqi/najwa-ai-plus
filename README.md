<div align="center">

<img src="build/icon.png" width="104" alt="Najwa AI icon">

# Najwa AI Plus

<sub>Najwa AI with a full agent harness · by Bandar Altariqi</sub>

### Najwa AI, plus an agent that works in your projects, safely.

</div>

## What Plus adds

Give a chat a **project folder** (📁 Project, at the top) and its replies work there as an agent: they look around, read, search, change files and run commands, step by step, as you allow. Everything else in Najwa AI stays as it is.

**The harness**
- **Tools:** list, read, find and search files; edit files (exact text replaced) or write them; run commands, with time limits, or in the background for dev servers; a to-do list you watch fill in.
- **Modes, per chat:** *Ask first* (every change and command), *Auto-edit* (files on its own, asks before commands), *Plan only* (reads and plans, changes nothing) and *Auto* (all on its own, except commands that could do harm, which always ask).
- **Rules:** "Always allow" a command (remembered by what it does, like `npm test` or `python3 -m pytest`), or allow edits for a chat.
- **Undo:** every change the agent makes is kept, so ⋯ → *Undo the agent's last change* puts files back, one change at a time.
- **Project instructions:** read from `NAJWA.md`, `AGENTS.md` or `CLAUDE.md`, so projects set up for other agents work as they are.
- **Long tasks:** up to 150 steps, with older tool results shortened as the work grows.
- **Any model that can use tools:** Ollama and LM Studio on your computer, or Claude and OpenAI with your own key.

**What other harnesses don't do**
- 📱 **Agent in your pocket:** the agent runs on your computer; its steps, diffs and questions reach your phone, and you can approve, deny or start work there.
- 🛡️ **Privacy firewall:** secrets (API keys, tokens, passwords, `.env` values) are hidden from cloud models as `«secret-1»`, and the model can still keep them where they are: the real value goes back in on your computer. Private files (`*.pem`, `.ssh/`, `secrets/`, and your own patterns) can only be read by models on your own computer or network.
- 🧑‍⚖️ **Second opinion:** another model (a small local one works well) checks each change and command against what you asked for, and its verdict is on the approval card. In modes that don't ask, its concerns make the agent ask you.
- 🧪 **Dry run:** a command that would change files runs first in a throwaway copy of the project; the card shows exactly which files it would change, with the diff and its output. Allowing applies those changes (without running it again), and they can be undone. Commands that reach outside the project (`git push`, `ssh`, `docker`, installs) are never tried in a copy.

The agent can only use files inside the project folder. Settings → Agent has the dry-run setting, the firewall, private files, commands always allowed and the second opinion's model.

<div align="center">

---

# Najwa AI

<sub>نجوى · a private conversation · formerly Balimda</sub>

### Your private AI, on every device you own.

Start a chat on your computer with a big model, continue the <b>same chat</b> on your phone with a small one,<br>
and finish it back at your desk. Or let your phone use your computer's big models from anywhere.<br>
Your chats, memory and assistants stay in sync, encrypted end to end.

[![Android](https://img.shields.io/badge/Android-3DDC84?logo=android&logoColor=white)](#download)
[![iPhone](https://img.shields.io/badge/iPhone-000000?logo=apple&logoColor=white)](#download)
[![Windows](https://img.shields.io/badge/Windows-0078D4?logo=windows&logoColor=white)](#download)
[![macOS](https://img.shields.io/badge/macOS-000000?logo=apple&logoColor=white)](#download)
[![Linux](https://img.shields.io/badge/Linux-FCC624?logo=linux&logoColor=black)](#download)
[![Works offline](https://img.shields.io/badge/works-offline-5b5bd6)](#run-ai-anywhere)
[![Your phone uses your PC's models](https://img.shields.io/badge/phone-uses%20your%20PC%27s%20models-5b5bd6)](#your-computers-brain-in-your-pocket)
[![Browses the web](https://img.shields.io/badge/AI-browses%20the%20web-5b5bd6)](#the-web-when-your-ai-needs-it)
[![Connectors (MCP)](https://img.shields.io/badge/connectors-GitHub%20%26%20MCP-5b5bd6)](#connectors-let-your-ai-work-with-github-and-more)
[![Free for personal use](https://img.shields.io/badge/free-for%20personal%20use-5b5bd6)](#license)
<br>
[![Works with Hermes Agent](https://img.shields.io/badge/works%20with-Hermes%20Agent-5b5bd6)](#your-hermes-agent-in-a-real-app)
[![Works with Ollama](https://img.shields.io/badge/works%20with-Ollama-5b5bd6)](#run-ai-anywhere)
[![Works with LM Studio](https://img.shields.io/badge/works%20with-LM%20Studio-5b5bd6)](#run-ai-anywhere)
[![Works with the OpenAI API (ChatGPT models)](https://img.shields.io/badge/works%20with-OpenAI%20API%20%28ChatGPT%20models%29-5b5bd6)](#run-ai-anywhere)
<br>
[![Business license available](https://img.shields.io/badge/business%20license-available-2b2a6e)](#for-businesses)
[![Support on Ko-fi](https://img.shields.io/badge/support-Ko--fi-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/bandaraltariqi)

**[Download](#download)** · **[Features](#features)** · **[User guide](docs/GUIDE.md)** · **[For businesses](#for-businesses)** · **[Support Najwa AI](#support-najwa-ai)** · **[Website](https://bandar9994.github.io/)** · **[Privacy](PRIVACY.md)**

<br>

<img src="docs/images/hero.png" alt="Najwa AI on a computer and a phone" width="100%">

</div>

<br>

## One chat. Every device. Any model.

Najwa AI keeps **the same conversation** on your phone and your computers, even when each device uses a different AI model. Nothing to copy, export or switch: open the chat on any device and keep going.

<div align="center">
<img src="docs/images/sync.png" alt="The same chat on a PC, using Qwen 3.5 27B, and on a phone, using Qwen 3 4B offline" width="100%">
</div>

| | Where you are | What happens |
|---|---|---|
| 💻 | **At your desk** | You start a chat with a large model on your PC, like Qwen 3.5 27B in Ollama. |
| 📱 | **On the go** | You open Najwa AI on your phone. The whole chat is already there, and the phone carries on with its own offline model, or with your PC's model over Wi-Fi or Tailscale. |
| 💻 | **Back home** | The PC shows everything you said on the phone and answers with the big model again. |

- **Every reply shows which model wrote it**, so you always know what answered.
- **Each device remembers its own model for each chat.** Your phone uses its model and your PC uses its own, automatically, with no switching.
- **The whole conversation goes along**, so a small phone model picks up right where the big model left off.
- **Nothing is lost.** Messages added on two devices before they synced are merged, and deleting a chat deletes it everywhere.
- **Memory and assistants follow you too**, so every device knows you just as well.

## Your computer's brain, in your pocket

Your phone can use **every model on your computer**: the big 27B model in Ollama or LM Studio, and even Claude or OpenAI on your computer's API keys. Turn on one switch on the computer, then pick a model under **On your computer** on the phone. That's it.

<div align="center">
<img src="docs/images/phones.png" alt="Najwa AI on Android, chatting with qwen3.5:27b running on the computer" width="100%">
<br><sub>A phone chatting with the computer's Qwen 3.5 27B, at 30 tokens a second · every chat, synced · code with syntax and copy</sub>
</div>

- **Nothing to set up on the phone.** It finds your computer through sync: no IP addresses, ports or server settings to type.
- **A small phone, a big brain.** Models far too big for a phone answer on it at your computer's full speed, and the phone's battery barely notices.
- **Every model the computer can use.** Ollama, LM Studio and other local servers, plus Claude and OpenAI with the computer's API keys, which never leave the computer. [Hermes Agent](#your-hermes-agent-in-a-real-app) too, approvals included.
- **Private.** The connection is encrypted with a key from your sync passphrase, so only your own devices can use it, and it never goes through anyone's server.
- **At home or away.** On your home Wi-Fi, or anywhere with [Tailscale](https://tailscale.com).
- **Replies that don't get lost.** If the Wi-Fi drops halfway through a reply, the computer keeps writing it, and the phone picks up exactly where it stopped once it's back.
- **Ready when you are.** The computer stays awake while it's sharing (its screen can still turn off), so it's there whenever you reach for your phone.
- **Pictures too.** Snap a photo on your phone and ask a vision model on your computer about it.

Setup takes a minute: see [Using the models on your PC from your phone](docs/GUIDE.md#using-the-models-on-your-pc-from-your-phone).

## Your Hermes Agent, in a real app

Use [Hermes Agent](https://github.com/NousResearch/hermes-agent) from your phone and computers, with a proper chat app instead of WhatsApp or Telegram.

<div align="center">
<img src="docs/images/hermes.png" alt="Hermes Agent asking for permission in Najwa AI on a computer, and the finished task on a phone" width="100%">
</div>

- **Watch it work.** Every tool Hermes runs shows up as it happens, then folds into "Used 4 tools".
- **You stay in control.** When Hermes wants to do something risky, you see the exact command and choose **Allow once**, **Allow for this chat**, **Always allow** or **Deny**. Nothing is approved automatically.
- **On your phone too.** Your phone reaches Hermes through your computer, approvals included, so Hermes never has to be opened to the network. Or connect the phone to Hermes directly.
- **Leave the app, keep the answer.** Hermes keeps working if you switch apps or lock your phone halfway through a reply. When you come back, the reply picks up where it stopped.
- **Your chats, kept and synced.** Hermes conversations are saved, searchable and synced like any other chat. Hermes keeps its own memory, so Najwa AI's isn't sent unless you turn that on.

Setup takes two minutes: see [Using Hermes Agent](docs/GUIDE.md#using-hermes-agent).

## The web, when your AI needs it

Ask about a website or something new, and your AI can look it up, on your phone and on your computer.

- **A browser for your AI.** Models that can use tools (Claude, OpenAI, and Ollama or LM Studio models with tool support) can search the web, open pages, click, type and take screenshots, then answer from what they found. Each step shows up as it happens ("Opening cloudpick.sa"), and screenshots the model took appear in the chat.
- **Its own private browser.** It runs hidden inside Najwa AI, separate from your own browser: none of your logins, no downloads, no camera, microphone or location, and a fresh start for every reply.
- **Links in your messages, read for you.** Paste a link and Najwa AI opens it and gives the page's text to any model, even one that can't browse. A chip under your message shows what it read.
- **Your choice.** Both can be turned off in Settings → General.

## Connectors: let your AI work with GitHub and more

Connect your services in **Settings → Connectors**, and models that can use tools work with them for you. Connectors use the Model Context Protocol (MCP), the standard many AI apps use, so GitHub's official connector works, and so do many others.

- **GitHub.** Ask *"What's open in my project?"*, *"Why did the build fail?"* or *"Fix the typo in the README and open a pull request"*. Your AI reads code, issues, pull requests and build results, and can make changes for you.
- **You decide how much it may do.** Reading happens by itself. Anything that changes something, like a commit, a pull request or a comment, shows you exactly what it will do, with **Allow once**, **Allow for this chat**, **Always allow** or **Deny**. Or turn on **Allow everything without asking** and give it a whole job: it works through it without stopping.
- **Your token, your limits.** A fine-grained GitHub token decides which repositories it can touch and what it may do. It stays on your device (encrypted on computers) and is never synced.
- **Any MCP connector.** Add one by its address, or on a computer run one as a program (for example, a connector for your files). When your phone uses your computer's models, it uses the computer's connectors too.

## Why Najwa AI?

Most AI apps send everything you type to someone else's servers, forget you the moment you close them, and live on one device. Najwa AI does the opposite.

<table>
<tr>
<td width="33%" valign="top">

### 🔒 Private by design
Run models on your own phone or computer, with no account and no internet. Najwa AI has no servers and collects nothing. When you sync, everything is encrypted on your device first. Najwa AI never loads images or links from a reply by itself, so a reply can't leak your chat to someone's server.

</td>
<td width="33%" valign="top">

### 🧠 It remembers you
Najwa AI learns lasting facts about you as you chat, keeps them up to date, and looks back through your earlier conversations so you never have to repeat yourself.

</td>
<td width="33%" valign="top">

### 📱💻 One conversation, every device
The same chat continues on your phone and your computer, even with a different model on each. Your phone can also use your computer's big models, so a small device gets a big brain.

</td>
</tr>
</table>

<br>

## Features

### Run AI anywhere

- **Offline on your phone.** Download a model once (Qwen, Llama, Gemma and more), then chat with no internet at all. Najwa AI runs models with native [llama.cpp](https://github.com/ggml-org/llama.cpp) and uses the **Adreno GPU** on Snapdragon phones for faster replies. Any `.gguf` model link works too.
- **On your computer.** Use [Ollama](https://ollama.com), [LM Studio](https://lmstudio.ai), llama.cpp, Jan, vLLM or any OpenAI-compatible server. Big models like Qwen 27B run at full speed on your own hardware.
- **Your Hermes Agent, in a real app.** Connect [Hermes Agent](https://github.com/NousResearch/hermes-agent) and chat with it from your phone and computers instead of WhatsApp or Telegram. You see each tool it runs as it works, and when it wants to do something risky, Najwa AI shows **Allow once**, **Allow for this chat**, **Always allow** or **Deny**. Hermes keeps its own memory, so Najwa AI's isn't sent unless you turn that on.
- **In the cloud, when you want it.** Anthropic Claude and OpenAI, with your own API key. Keys are stored on your device, encrypted with your system keychain on desktop.
- **Your phone, your computer's brain.** Turn on one switch on your computer, and your phone can chat with every model the computer has, including cloud models on the computer's API keys. The phone finds the computer through sync, with nothing to type, over an encrypted connection only your devices can use. It works on your home Wi-Fi, or anywhere with [Tailscale](https://tailscale.com). [More about it](#your-computers-brain-in-your-pocket).
- **The right model on each device.** Every chat remembers which model to use on each device: a small, fast model on the phone and a 27B model on the PC, in the same conversation.

### Tools for your AI

- **A browser.** Models that can use tools search the web, open pages, click, type and take screenshots, on your phone and computer, in a private browser inside Najwa AI. [More](#the-web-when-your-ai-needs-it)
- **Read links.** Paste a link and any model gets the page's text.
- **Connectors.** GitHub and any MCP service: your AI reads your project, checks builds and opens pull requests, asking before each change or, if you allow it, doing the whole job by itself. [More](#connectors-let-your-ai-work-with-github-and-more)

### Memory that grows with you

- **Remembers automatically.** Mention your name, your job, your family or what you like, and Najwa AI adds it to memory by itself. A short note tells you what it learned.
- **Keeps facts current.** Say *"I moved to Jeddah"* and the old city is replaced, not duplicated. Things that no longer apply are forgotten.
- **Stays short and sharp.** Memory is capped at 1,500 characters and tidies itself up when it grows, so it never crowds out your conversation. You can read and edit every word in Settings.
- **Recalls earlier chats.** Before replying, Najwa AI looks through your past conversations, in English and Arabic, for relevant details. Replies that used them say so, with links back to those chats.

### Never lose a thought

- **Every chat is saved as it happens**, even a reply that's still being written. Close the app mid-sentence and you're back where you left off, including your half-typed message.
- **Search across all your chats**, pin favourites, rename and export any chat to Markdown.
- **Back up everything** to a single file and restore it on any device.

### Seamless, encrypted sync

- **Continue any chat on any device**, even when each device uses a different model. See [One chat. Every device. Any model.](#one-chat-every-device-any-model)
- **Sign in with Google** and your chats, assistants and memory follow you between your phone and computers. Najwa AI uses a hidden app folder in your Drive and can't see your other files. Developers can use a private GitHub repository instead.
- **End-to-end encrypted.** Everything is encrypted on your device with AES-256-GCM, using a key made from your own passphrase, before it's uploaded. Google or GitHub only ever see scrambled data.
- **Nothing gets lost.** If the same chat or your memory changed on two devices before they synced, the changes are merged. Delete a chat once and it's gone everywhere.

### A great chat experience

- **Replies that are easy to read.** Text appears a sentence at a time (or word by word, or all at once, as you like), and the page stays still while you read instead of chasing the newest word. Stop, Regenerate, and Edit & resend are always there.
- **Pictures.** Add a photo or screenshot to a message and ask about it: with Claude, a vision model in Ollama or LM Studio, or on your phone with a vision model and its vision file (mmproj), fully offline.
- **Thinking models, tidied up.** Models that reason first (Qwen 3, DeepSeek-R1, Claude and others, on your phone, in Ollama or LM Studio, or in the cloud) show a collapsed "Thought process" you can open when you're curious.
- **Assistants** with their own instructions and their own model. Assistant, Code Buddy and Writing Coach come built in; create as many as you like.
- **Beautiful Markdown and code**, with one-tap copy for code blocks.
- **Arabic and English.** Right-to-left text lays out naturally, and automatic memory and the look-back through earlier chats understand Arabic.
- **See the speed.** Replies from local models show tokens per second, and on the phone whether they ran on the GPU or the CPU.
- **Light and dark themes**, and keyboard shortcuts on desktop.

<br>

<table>
<tr>
<td width="50%"><img src="docs/images/arabic.png" alt="An Arabic chat, laid out right to left"></td>
<td width="50%"><img src="docs/images/memory.png" alt="Memory settings"></td>
</tr>
<tr>
<td align="center"><sub>Arabic, right to left, in light mode</sub></td>
<td align="center"><sub>Memory you can see and edit</sub></td>
</tr>
</table>

<br>

## Download

| Platform | Download | Notes |
|---|---|---|
| **Android** | [Najwa-AI-android.apk](https://github.com/bandar9994/najwa-ai/releases/download/android-latest/Najwa-AI-android.apk) | Open it on your phone and allow installing from your browser. Later updates install over this one and keep your chats. Moving from an earlier build to the new app ID (`com.bandaraltariqi.najwa`) is a one-time reinstall: install this version, sign in to sync and enter your passphrase, and your chats come back through sync. If you don't use sync, export your chats to Markdown before you uninstall the old app. |
| **Windows** 10/11 | [Najwa-AI-Windows-Setup.exe](https://github.com/bandar9994/najwa-ai/releases/download/desktop-latest/Najwa-AI-Windows-Setup.exe) | If SmartScreen appears, choose **More info → Run anyway**. |
| **Mac** (M1 and newer) | [Najwa-AI-macOS-AppleSilicon.dmg](https://github.com/bandar9994/najwa-ai/releases/download/desktop-latest/Najwa-AI-macOS-AppleSilicon.dmg) | Drag Najwa AI to Applications. The first time, right-click it and choose **Open**. |
| **Mac** (Intel) | [Najwa-AI-macOS-Intel.dmg](https://github.com/bandar9994/najwa-ai/releases/download/desktop-latest/Najwa-AI-macOS-Intel.dmg) | Same as above. |
| **Linux** | [AppImage](https://github.com/bandar9994/najwa-ai/releases/download/desktop-latest/Najwa-AI-Linux.AppImage) · [.deb](https://github.com/bandar9994/najwa-ai/releases/download/desktop-latest/Najwa-AI-Linux.deb) | |
| **iPhone** | [Najwa-AI-iOS-unsigned.ipa](https://github.com/bandar9994/najwa-ai/releases/download/ios-latest/Najwa-AI-iOS-unsigned.ipa) | Not on the App Store yet. Sign it for your iPhone first: upload it to a signing service such as Signulous, or install it with Sideloadly or AltStore and your Apple ID. |

## Get started in three steps

1. **Install Najwa AI** on your phone, your computer, or both.
2. **Pick a model.** On the phone, open **Settings → Models & providers** and download one (Qwen 2.5 1.5B is a great start, and it speaks Arabic). On the computer, install [Ollama](https://ollama.com) and run `ollama pull qwen3:8b`, or paste a Claude or OpenAI key.
3. **Turn on sync** (optional) in **Settings → Sync** on each device with the same Google account and passphrase. Then turn on **Let my phone use this computer's models** on your computer if you'd like your phone to use it.

The **[user guide](docs/GUIDE.md)** covers everything else: the model list, GPU tips, sync, using your computer's models away from home, where your data lives, and keyboard shortcuts.

## Questions

<details>
<summary><b>I used Balimda. What changes?</b></summary>

Only the name. Balimda is now Najwa AI (نجوى, "a private conversation"). The new version installs over the old one on your phone and computer and keeps all your chats, memory, settings and keys. On a Mac, the new app is called Najwa AI, so you can delete the old Balimda app from Applications after you open it.
</details>

<details>
<summary><b>Is it really free?</b></summary>

Yes, for personal, non-commercial use. There are no accounts, subscriptions or ads. Cloud models (Claude, OpenAI) are billed by those companies to your own API key, and only if you choose to use them.
</details>

<details>
<summary><b>Can my company use Najwa AI?</b></summary>

Yes, with a commercial license. Any use by or for a company or organisation, including your staff using it for work, needs one. [Request a quote](https://github.com/bandar9994/najwa-ai/issues/new?template=commercial-license.yml).
</details>

<details>
<summary><b>Does it work without internet?</b></summary>

Yes. Models on your phone, and Ollama or LM Studio on your computer, work fully offline. You only need the internet to download a model, to sync, or to use cloud models.
</details>

<details>
<summary><b>Who can read my chats?</b></summary>

Only you. Chats are stored on your devices. Sync uploads them encrypted with a key made from your passphrase, which never leaves your devices. Messages go only to the model you pick: your phone, your own computer, or the cloud provider you chose. See the [privacy policy](PRIVACY.md).
</details>

<details>
<summary><b>Which phone do I need?</b></summary>

Any recent Android phone or iPhone. Small models (0.5B–1.5B) run on most phones; 3B–4B models want 6–8 GB of RAM. Snapdragon phones get GPU acceleration. For bigger models, let your phone use your computer's models.
</details>

<details>
<summary><b>Can I use my computer's models from my phone when I'm away from home?</b></summary>

Yes. Install [Tailscale](https://tailscale.com) (free) on the computer and the phone and sign in with the same account. Najwa AI finds the computer over Tailscale by itself. Najwa AI must be open on the computer.
</details>

<details>
<summary><b>Can the AI look at a website?</b></summary>

Yes. Paste the link and Najwa AI reads the page for the model. Models that can use tools (Claude, OpenAI, and many Ollama and LM Studio models) can also search the web and browse by themselves, including screenshots to see a page's design. They use a private browser hidden inside Najwa AI, with none of your logins. You can turn both off in Settings → General.
</details>

<details>
<summary><b>Can the AI work on my GitHub projects?</b></summary>

Yes. In **Settings → Connectors**, tap **Add GitHub** and paste a fine-grained token that you create on GitHub for the repositories you choose. Then ask a model that can use tools (Claude, OpenAI, and many Ollama and LM Studio models) to look at issues, read code, check builds or open pull requests. Anything that changes your project waits for you to tap **Allow**, unless you turn on **Allow everything without asking** for that connector.
</details>

<details>
<summary><b>What if I forget my sync passphrase?</b></summary>

It can't be recovered, because nobody else ever has it. Your chats are still on your devices: set up sync with a new passphrase and choose **Start over with this passphrase**, then **Set up again** with it on your other devices. Their chats are added back.
</details>

## For businesses

Want Najwa AI for your team, or inside a product or service? Najwa AI keeps your company's conversations on your own devices and servers: run models on your own hardware, or on cloud models with your own keys, with no third-party chat service in between.

Use by or for a company or organisation needs a **commercial license**. Tell us what you need and you'll get a quote:

<p align="center"><a href="https://github.com/bandar9994/najwa-ai/issues/new?template=commercial-license.yml"><b>→ Request a commercial license</b></a></p>

## Support Najwa AI

Najwa AI is made by one person, with no ads, no tracking and no subscriptions. If it's useful to you, you can support its development:

<p align="center"><a href="https://ko-fi.com/bandaraltariqi"><b>☕ Support Najwa AI on Ko-fi</b></a></p>

Telling a friend or starring this repository helps too.

## For developers

Najwa AI is one codebase for every platform: an Electron desktop app and a Capacitor Android app that share the same interface, storage, sync and model code. See **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** to build it and find your way around.

```bash
npm install
npm start   # run the desktop app
npm test    # run the tests
```

## License

**Najwa AI © 2026 Bandar Altariqi. All rights reserved.** Released under the [Najwa AI License](LICENSE):

- ✅ Use, study, change and share it **for personal, non-commercial purposes**.
- ✅ Keep the **Najwa AI** name, logo and icon, and credit **"Najwa AI by Bandar Altariqi"** with a link to this repository. Changed versions must say they were changed.
- ❌ **No rebranding**: no renaming, removing the brand, or publishing it under another name or author.
- ❌ **No commercial or organisational use** without a commercial license from Bandar Altariqi. That includes use by or for a company (even by its staff for work), selling it, paid products or services, ads and subscriptions. [Request a quote](https://github.com/bandar9994/najwa-ai/issues/new?template=commercial-license.yml).

Najwa AI is built on great open-source work, including llama.cpp, wllama, Electron, Capacitor, marked and DOMPurify. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). AI models belong to their creators and have their own licenses.

<div align="center">
<br>
<b>Najwa AI by Bandar Altariqi</b>
</div>
