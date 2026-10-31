export function crowBannerLines(): string[] {
  return [
    " ██████  ██████   ██████  ██      ██",
    "██       ██   ██ ██    ██ ██      ██",
    "██       ██████  ██    ██ ██  ██  ██",
    "██       ██   ██ ██    ██ ██  ██  ██",
    " ██████  ██   ██  ██████   ███  ███",
    "",
    "tiny crow",
    "minimal coding agent for your terminal",
  ];
}

export function centerText(text: string, width: number): string {
  if (width <= 0) return text;
  if (text.length >= width) return text;
  const left = Math.floor((width - text.length) / 2);
  return " ".repeat(left) + text;
}

export function centeredBanner(width: number): string[] {
  return crowBannerLines().map((line) => centerText(line, width));
}

export function setupGuideLines(provider: string, model: string): string[] {
  return [
    "No provider API key is configured yet, so live chat is not available.",
    `Current provider: ${provider}   Model: ${model}`,
    "",
    "To configure a provider here, open /provider and pick one.",
    "Or quit this screen and run:",
    "  tiny-crow --setup",
    "",
    "Or set the provider key in your environment or config, then start again.",
    "Type /quit to leave, /help to see commands.",
  ];
}

export function welcomeHintLines(): string[] {
  return [
    "Type a message to start.  /help lists commands.  /quit leaves.",
    "Ctrl-C aborts a running turn.  Ctrl-D on an empty line leaves.",
  ];
}
