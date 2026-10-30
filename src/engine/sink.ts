export interface EventSink {
  writeLine(text: string): void;
  writeOk(text: string): void;
  writeResult(text: string): void;
  writeError(text: string): void;
  token(text: string): void;
}

export class StringSink implements EventSink {
  private sinkLines: string[] = [];
  private responseBuffer = "";

  static new(): StringSink {
    return new StringSink();
  }

  transcript(): string {
    return this.sinkLines.join("\n");
  }

  responseText(): string {
    return this.responseBuffer;
  }

  lines(): readonly string[] {
    return this.sinkLines;
  }

  private push(text: string): void {
    if (text === "") {
      this.sinkLines.push("");
    } else {
      for (const line of text.split("\n")) this.sinkLines.push(line);
    }
  }

  writeLine(text: string): void {
    this.push(text);
  }

  writeOk(text: string): void {
    this.push(text);
  }

  writeResult(text: string): void {
    this.push(text);
  }

  writeError(text: string): void {
    this.push(`error: ${text}`);
  }

  token(text: string): void {
    this.responseBuffer += text;
  }
}

export interface RendererLike {
  writeLine(text: string, color: string): void;
  write(text: string, color: string): void;
}

export function rendererSink(renderer: RendererLike): EventSink {
  return {
    writeLine(text: string): void {
      try {
        renderer.writeLine(text, "white");
      } catch {
        /* rendering is best-effort */
      }
    },
    writeOk(text: string): void {
      try {
        renderer.writeLine(text, "white");
      } catch {
        /* rendering is best-effort */
      }
    },
    writeResult(text: string): void {
      try {
        renderer.writeLine(text, "darkGrey");
      } catch {
        /* rendering is best-effort */
      }
    },
    writeError(text: string): void {
      try {
        renderer.writeLine(`error: ${text}`, "red");
      } catch {
        /* rendering is best-effort */
      }
    },
    token(text: string): void {
      try {
        renderer.write(text, "white");
      } catch {
        /* rendering is best-effort */
      }
    },
  };
}
