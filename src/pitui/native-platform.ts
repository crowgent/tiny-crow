export type ModifierKey = "shift" | "command" | "control" | "option";

export interface NativeClipboard {
	getText(): Promise<string | null | undefined>;
	getImage(): Promise<Uint8Array | null | undefined>;
	getFilePaths?(): Promise<string[] | null | undefined>;
	setText?(text: string): Promise<void>;
}

type NativePlatformHelper = NativeClipboard & {
	enableVirtualTerminalInput?: () => boolean;
	isModifierPressed?: (name: ModifierKey) => boolean;
};

export function getNativePlatformHelper(): NativePlatformHelper | undefined {
	return undefined;
}

export function getNativeClipboard(): NativeClipboard | undefined {
	return undefined;
}
