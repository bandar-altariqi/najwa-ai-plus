# Third-party notices

Najwa AI is © 2026 Bandar Altariqi and licensed under the [Najwa AI License](LICENSE).
It is built with the open-source components below. Each one remains under
its own license, and the Najwa AI License does not change or limit it.

| Component | Used for | License | Copyright |
|---|---|---|---|
| [llama.cpp / ggml](https://github.com/ggml-org/llama.cpp) | Native on-device AI engine (Android) | MIT | © 2023-2026 The ggml authors |
| [wllama](https://github.com/ngxson/wllama) | WebAssembly on-device AI engine | MIT | © 2024 Xuan Son Nguyen |
| [Electron](https://www.electronjs.org) | Desktop app | MIT | © Electron contributors, © 2013-2020 GitHub Inc. |
| [Capacitor](https://capacitorjs.com) (core, Android, iOS, App, Filesystem, Share) | Mobile app | MIT | © 2017-present Drifty Co. |
| [marked](https://github.com/markedjs/marked) | Formatting replies | MIT | © 2018+ MarkedJS, © 2011-2018 Christopher Jeffrey |
| [DOMPurify](https://github.com/cure53/DOMPurify) | Keeping formatted replies safe | Apache-2.0 or MPL-2.0 | © Cure53 and other contributors |
| [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) | Connecting to Claude | Apache-2.0 | © 2023 Anthropic, PBC |
| [OpenCL Headers](https://github.com/KhronosGroup/OpenCL-Headers) | Building GPU support (Android) | Apache-2.0 | © 2008-2020 The Khronos Group Inc. |
| [Google Play services Auth](https://developers.google.com/android/guides/overview) (`play-services-auth`) | Google sign-in for Drive sync (Android) | [Android Software Development Kit License](https://developer.android.com/studio/terms) | © Google LLC |
| [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance) (guides) | The agent's web best-practice guides (Plus, desktop) | Apache-2.0 | © Google LLC and the Modern Web Guidance contributors (Chrome, Edge, Firefox and MDN teams) |
| [Inter](https://github.com/rsms/inter) (font, variable weight) | English text in the interface | SIL Open Font License 1.1 | © 2016 The Inter Project Authors (https://github.com/rsms/inter) |
| [Source Serif 4](https://github.com/adobe-fonts/source-serif) (font, variable weight) | English text in replies | SIL Open Font License 1.1 | © 2014-2023 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source' |
| [Readex Pro](https://github.com/google/fonts/tree/main/ofl/readexpro) (font, variable weight) | Arabic text | SIL Open Font License 1.1 | © 2018 The Readex Pro Project Authors (https://github.com/ThomasJockin/readexpro) |

The full license texts come with each component. In the source tree they are in
`node_modules/<package>/LICENSE`. The Android build downloads llama.cpp and the
OpenCL headers together with their `LICENSE` files.

The Readex Pro font is bundled as the WOFF2 file Google Fonts serves for its
Arabic part, otherwise unmodified. It is licensed under the
SIL Open Font License, Version 1.1, which is included in full in the app as
`fonts/OFL.txt` (and in the source tree as `renderer/fonts/OFL.txt`). The font is
not sold on its own, and its name is unchanged.

Modern Web Guidance's guides are bundled in `skills/modern-web-guidance/guides/`,
unmodified. Its `SKILL.md` is rewritten for Najwa AI Plus (the agent reads the
bundled guides instead of running its command-line tool). The Apache License 2.0
text and the details of the changes come with it, in
`skills/modern-web-guidance/LICENSE` and `NOTICE.md`.

Inter and Source Serif 4 are bundled as the Latin WOFF2 files Google Fonts
serves (through Fontsource), otherwise unmodified, under the SIL Open Font
License, Version 1.1, included in full as `fonts/Inter-OFL.txt` and
`fonts/SourceSerif4-OFL.txt` (in the source tree under `renderer/fonts/`).
They are not sold on their own, and their names are unchanged.

## MIT License (text)

The MIT-licensed components above are provided under this license, with the
copyright lines shown in the table:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## AI models

Models you download inside Najwa AI (for example Llama, Qwen, Gemma and SmolLM2)
are made by their creators and come with their own licenses and usage policies.
Najwa AI does not include them. It only downloads them from Hugging Face when you
choose to.
