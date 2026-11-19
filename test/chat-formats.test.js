// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The phone engine's hand-written chat formats (native/llama/engine/chat_formats.h),
// compiled and run here. The expected prompts are what each model's official
// template gives (rendered with Jinja), without the <bos> the tokenizer adds.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const HEADER = path.join(__dirname, '..', 'native', 'llama', 'engine', 'chat_formats.h');
const compiler = ['c++', 'g++', 'clang++'].find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);

// A small program: each case's roles and contents in, the prompt out (as JSON).
const DRIVER = `
#include "chat_formats.h"
#include <cstdio>
#include <iostream>
static void json(const std::string & s) {
  std::cout << '"';
  for (unsigned char c : s) {
    if (c == '"' || c == '\\\\') std::cout << '\\\\' << c;
    else if (c == '\\n') std::cout << "\\\\n";
    else std::cout << c;
  }
  std::cout << '"';
}
int main() {
  using V = std::vector<std::string>;
  std::cout << "[";
  json(chat_formats::gemma4(V{"system", "user", "assistant", "user"}, V{"  You are Najwa.  ", "Hi there\\n", "Hello! How can I help?", "Search the web?"}, true));
  std::cout << ",";
  json(chat_formats::gemma4(V{"user", "assistant", "user"}, V{"Hi there\\n", "Hello! How can I help?", "Search the web?"}, true));
  std::cout << ",";
  json(chat_formats::gemma4(V{"user", "assistant", "user"}, V{"Q", "<think>plan</think>Answer<|channel>thought\\nmore<channel|>", "Next"}, true));
  std::cout << ",";
  json(chat_formats::is_gemma4("{{ bos_token }}{{ '<|turn>' + role }}...{{ '<turn|>' }}") ? "yes" : "no");
  std::cout << ",";
  json(chat_formats::is_gemma4("{{ '<start_of_turn>' + role }}") ? "yes" : "no");
  std::cout << "]";
}
`;

test('Gemma 4: the prompt its official template writes, not ChatML', { skip: !compiler && 'no C++ compiler' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-chat-formats-'));
  fs.writeFileSync(path.join(dir, 'driver.cpp'), DRIVER);
  const exe = path.join(dir, 'driver');
  execFileSync(compiler, ['-std=c++17', `-I${path.dirname(HEADER)}`, path.join(dir, 'driver.cpp'), '-o', exe]);
  const [withSystem, plain, thinking, gemma4Template, gemma3Template] = JSON.parse(execFileSync(exe, { encoding: 'utf8' }));
  // google/gemma-4-E4B-it chat_template.jinja, add_generation_prompt=true (without "<bos>").
  assert.strictEqual(withSystem, '<|turn>system\nYou are Najwa.<turn|>\n<|turn>user\nHi there<turn|>\n<|turn>model\nHello! How can I help?<turn|>\n<|turn>user\nSearch the web?<turn|>\n<|turn>model\n');
  assert.strictEqual(plain, '<|turn>user\nHi there<turn|>\n<|turn>model\nHello! How can I help?<turn|>\n<|turn>user\nSearch the web?<turn|>\n<|turn>model\n');
  // Earlier replies go back without their thinking.
  assert.strictEqual(thinking, '<|turn>user\nQ<turn|>\n<|turn>model\nAnswer<turn|>\n<|turn>user\nNext<turn|>\n<|turn>model\n');
  assert.strictEqual(gemma4Template, 'yes');
  assert.strictEqual(gemma3Template, 'no');   // Gemma 3 stays with llama.cpp's own "gemma" format
});

test('the engine uses the Gemma 4 format before falling back to ChatML', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'native', 'llama', 'engine', 'balimda_engine.cpp'), 'utf8');
  const gemma = src.indexOf('chat_formats::is_gemma4(e.tmpl)');
  const chatml = src.indexOf('run("chatml")');
  assert.ok(gemma > 0 && chatml > gemma);
});
