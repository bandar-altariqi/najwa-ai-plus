// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Chat formats llama.cpp's built-in list (llama_chat_apply_template) doesn't
// have yet, written out by hand. Without them a model would be prompted in
// ChatML, which it doesn't know: it then copies the markers as text and
// writes both sides of the conversation.
//
// No llama.cpp here, so this is checked on its own (test/chat-formats.test.js).

#pragma once

#include <string>
#include <vector>

namespace chat_formats {

inline std::string trim(const std::string & s) {
    const char * ws = " \t\n\r\f\v";
    const size_t a = s.find_first_not_of(ws);
    if (a == std::string::npos) return "";
    const size_t b = s.find_last_not_of(ws);
    return s.substr(a, b - a + 1);
}

// Gemma 4: its template (chat_template.jinja) uses <|turn>role ... <turn|>.
inline bool is_gemma4(const std::string & tmpl) {
    return tmpl.find("<|turn>") != std::string::npos && tmpl.find("<turn|>") != std::string::npos;
}

// A reply without a thinking block: Gemma 4's "<|channel>...<channel|>", and
// "<think>...</think>" from other models in the same chat.
inline std::string strip_thinking(std::string text) {
    const std::pair<const char *, const char *> blocks[] = { { "<|channel>", "<channel|>" }, { "<think>", "</think>" } };
    for (const auto & b : blocks) {
        for (;;) {
            const size_t start = text.find(b.first);
            if (start == std::string::npos) break;
            const size_t end = text.find(b.second, start);
            text.erase(start, end == std::string::npos ? std::string::npos : end + std::string(b.second).size() - start);
        }
    }
    return text;
}

// Gemma 4's chat, as its official template writes it for a plain chat with
// thinking off (google/gemma-4-E4B-it, chat_template.jinja):
//   <|turn>system\n{system}<turn|>\n        (only with a system prompt)
//   <|turn>user\n{message}<turn|>\n
//   <|turn>model\n{reply}<turn|>\n
//   <|turn>model\n                          (the reply starts here)
// The <bos> at the very start is added when the prompt is tokenized.
inline std::string gemma4(const std::vector<std::string> & roles, const std::vector<std::string> & contents, bool add_generation_prompt) {
    std::string out;
    std::string system;
    size_t i = 0;
    // System messages at the start (the app sends one) become the system turn.
    while (i < roles.size() && (roles[i] == "system" || roles[i] == "developer")) {
        const std::string t = trim(contents[i]);
        if (!t.empty()) system += (system.empty() ? "" : "\n\n") + t;
        i++;
    }
    if (!system.empty()) out += "<|turn>system\n" + system + "<turn|>\n";
    for (; i < roles.size(); i++) {
        const std::string & r = roles[i];
        const bool model = r == "assistant" || r == "model";
        // A system message later in the chat is shown to the model as the user's.
        const std::string role = model ? "model" : "user";
        const std::string text = trim(model ? strip_thinking(contents[i]) : contents[i]);
        out += "<|turn>" + role + "\n" + text + "<turn|>\n";
    }
    if (add_generation_prompt) out += "<|turn>model\n";
    return out;
}

}  // namespace chat_formats
